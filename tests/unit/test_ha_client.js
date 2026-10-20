// HaClient against a local fake Home Assistant (Soup.Server + WebSocket): authentication, calls, subscriptions,
// disconnections, network changes.
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {eq, runAsync} from './assert.js';
import {HaClient, nextDelay, websocketUrl} from '../../extension/home-assistant@maximeallanic.github.io/ha-client.js';

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));
async function until(cond, ms, name) {
    const end = GLib.get_monotonic_time() + ms * 1000;
    while (!cond()) {
        if (GLib.get_monotonic_time() > end)
            eq('timed out', 'condition true', name);
        await wait(20);
    }
}

// Fake Home Assistant
const fake = {connections: 0, received: [], socket: null};
const server = new Soup.Server();
server.add_websocket_handler('/api/websocket', null, null, (_s, _m, _p, conn) => {
    fake.connections++;
    fake.socket = conn;
    const send = o => conn.send_text(JSON.stringify(o));
    conn.connect('message', (_c, _t, bytes) => {
        const msg = JSON.parse(new TextDecoder().decode(bytes.toArray()));
        fake.received.push(msg);
        if (msg.type === 'auth' && msg.access_token === 'mute')
            return;  // HA stuck during authentication
        if (msg.type === 'auth' && msg.access_token === 'slow') {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                if (conn.get_state() === Soup.WebsocketState.OPEN)
                    send({type: 'auth_ok'});
                return GLib.SOURCE_REMOVE;
            });
        } else if (msg.type === 'auth')
            send({type: msg.access_token === 'good' ? 'auth_ok' : 'auth_invalid'});
        else if (msg.type === 'ping_test')
            send({id: msg.id, type: 'result', success: true, result: 42});
        else if (msg.type === 'failure_test')
            send({id: msg.id, type: 'result', success: false, error: {code: 'x', message: 'failed'}});
        else if (msg.type === 'subscribe_events') {
            send({id: msg.id, type: 'result', success: true, result: null});
            send({id: msg.id, type: 'event', event: {n: 1}});
        } else if (msg.type === 'unsubscribe_events')
            send({id: msg.id, type: 'result', success: true, result: null});
    });
    send({type: 'auth_required'});
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const url = `http://127.0.0.1:${server.get_uris()[0].get_port()}`;

class FakeNetwork {
    constructor() {
        this.network_available = true;
        this._callbacks = new Map();
        this._n = 0;
    }

    connect(_signal, fn) {
        this._callbacks.set(++this._n, fn);
        return this._n;
    }

    disconnect(id) {
        this._callbacks.delete(id);
    }

    emit() {
        for (const fn of this._callbacks.values())
            fn(this, this.network_available);
    }
}

runAsync('ha-client', async () => {
    eq(nextDelay(1), 2, 'delay doubled');
    eq(nextDelay(40), 60, 'delay capped');
    eq(nextDelay(60), 60, 'delay at cap');
    eq(websocketUrl('https://ha.example:8123/'), 'wss://ha.example:8123/api/websocket', 'wss url');
    eq(websocketUrl('http://192.0.2.1/ha'), 'ws://192.0.2.1/ha/api/websocket', 'ws url with path');

    // Connection, call, failed call, subscription
    const c = new HaClient({url, token: 'good', network: new FakeNetwork()});
    const states = [];
    c.onState(e => states.push(e));
    c.start();
    await until(() => c.state === 'connected', 2000, 'connection');
    eq(await c.call({type: 'ping_test'}), 42, 'call');
    let error = null;
    await c.call({type: 'failure_test'}).catch(e => (error = e.message));
    eq(error, 'failed', 'failed call');
    const events = [];
    const unsubscribe = await c.subscribe({type: 'subscribe_events'}, ev => events.push(ev));
    await until(() => events.length === 1, 1000, 'event received');
    eq(events[0], {n: 1}, 'event content');
    await unsubscribe();
    eq(fake.received.some(m => m.type === 'unsubscribe_events'), true, 'unsubscribe sent');

    // Closed by the server -> reconnected within 2 s
    const before = fake.connections;
    fake.socket.close(Soup.WebsocketCloseCode.GOING_AWAY, null);
    await until(() => states.includes('disconnected'), 1000, 'disconnected seen');
    await until(() => fake.connections > before && c.state === 'connected', 2000, 'reconnection');

    // A call pending during stop() (extension disabled) is rejected with .stopping, so the user is not notified; a call
    // pending during a real disconnection is rejected without it.
    let lostRejection = null;
    const pending1 = c.call({type: 'silence_test'}).catch(e => (lostRejection = e));
    fake.socket.close(Soup.WebsocketCloseCode.GOING_AWAY, null);
    await pending1;
    eq(lostRejection?.stopping ?? false, false, 'disconnection: rejection without stopping');
    await until(() => c.state === 'connected', 3000, 'reconnected after disconnection');
    let stopRejection = null;
    const pending2 = c.call({type: 'silence_test'}).catch(e => (stopRejection = e));
    c.stop();
    await pending2;
    eq(stopRejection?.stopping, true, 'stop: rejection marked stopping');

    // stop(): no more connections
    c.stop();
    eq(c.state, 'stopped', 'stopped');
    const n = fake.connections;
    await wait(3000);
    eq(fake.connections, n, 'stop() cleans up');

    // Token rejected: no new attempt
    const r = new HaClient({url, token: 'bad', network: new FakeNetwork()});
    r.start();
    await until(() => r.state === 'rejected', 2000, 'rejected');
    const n2 = fake.connections;
    await wait(3000);
    eq(fake.connections, n2, 'no new attempt after rejection');
    r.reconfigure({url, token: 'good'});
    await until(() => r.state === 'connected', 2000, 'reconfigure reconnects');
    r.stop();

    // Network back -> reconnected at once, without waiting for the delay
    const network = new FakeNetwork();
    const w = new HaClient({url, token: 'good', network, initialDelay: 8});
    w.start();
    await until(() => w.state === 'connected', 2000, 'connection w');
    network.network_available = false;
    fake.socket.close(Soup.WebsocketCloseCode.GOING_AWAY, null);
    await until(() => w.state === 'disconnected', 1000, 'w disconnected');
    await wait(300);
    network.network_available = true;
    network.emit();
    await until(() => w.state === 'connected', 1000, 'network back');

    // Network changed while the socket looks open (other Wi-Fi, NAT lost) -> forced reconnection
    const beforeChange = fake.connections;
    network.emit();
    await until(() => fake.connections > beforeChange && w.state === 'connected', 3000, 'network change -> reconnection');
    w.stop();

    // Authentication without answer -> dropped after the timeout, then a new attempt
    const m = new HaClient({url, token: 'mute', network: new FakeNetwork(), authTimeout: 0.5});
    const statesM = [];
    m.onState(e => statesM.push(e));
    const beforeM = fake.connections;
    m.start();
    await until(() => statesM.includes('disconnected'), 2000, 'no authentication answer -> disconnected');
    await until(() => fake.connections >= beforeM + 2, 4000, 'no authentication answer -> new attempt');
    m.stop();

    // Late auth_ok of an abandoned connection (reconfigured during authentication): ignored
    const t = new HaClient({url, token: 'slow', network: new FakeNetwork()});
    const statesT = [];
    t.onState(e => statesT.push(e));
    t.start();
    await until(() => fake.received.filter(x => x.access_token === 'slow').length > 0 && t.state === 'connecting', 2000, 'slow auth sent');
    await wait(50);
    t.reconfigure({url, token: 'mute'});
    await wait(800);
    eq(statesT.includes('connected'), false, 'late auth_ok ignored');
    t.stop();

});
