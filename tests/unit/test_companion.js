// Companion with a fake MobileApp, a fake client and fake sources: incremental sends, batching, push channel,
// commands, notifications, recreation of the device.
import GLib from 'gi://GLib';
import {eq, runAsync} from './assert.js';
import {Companion} from '../../extension/home-assistant@maximeallanic.github.io/companion/companion.js';

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));

class FakeMobileApp {
    constructor() {
        this.webhookId = 'wh';
        this.calls = [];
        this.failing = false;
        this._recreated = new Set();
    }

    async start() {
        this.calls.push(['start']);
    }

    async registerSensors(defs) {
        this.calls.push(['register', defs.map(d => [d.unique_id, d.state])]);
        if (this.duringRegister)
            await this.duringRegister();
    }

    async updateSensors(states) {
        this.calls.push(['update', states.map(e => [e.unique_id, e.state])]);
        if (this.delay)
            await wait(this.delay);
        if (this.failing)
            throw new Error('HA unreachable');
        return Object.fromEntries(states.map(e => [e.unique_id, {success: true}]));
    }

    async fireEvent(type, data) {
        this.calls.push(['event', type, data]);
    }

    onRecreated(fn) {
        this._recreated.add(fn);
        return () => this._recreated.delete(fn);
    }

    recreate() {
        this.webhookId = 'wh2';
        [...this._recreated].forEach(fn => fn());
    }

    updates() {
        return this.calls.filter(a => a[0] === 'update').map(a => a[1]);
    }
}

class FakeClient {
    constructor() {
        this.state = 'connected';
        this.listeners = new Set();
        this.subscriptions = [];
        this.calls = [];
    }

    onState(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    setState(state) {
        this.state = state;
        if (state !== 'connected')
            this.subscriptions.forEach(a => (a.active = false));
        [...this.listeners].forEach(fn => fn(state));
    }

    async subscribe(msg, fn) {
        const a = {msg, fn, active: true};
        this.subscriptions.push(a);
        return async () => (a.active = false);
    }

    async call(msg) {
        this.calls.push(msg);
        return null;
    }

    push(ev) {
        this.subscriptions.filter(a => a.active).at(-1).fn(ev);
    }

    activeMessages() {
        return this.subscriptions.filter(a => a.active).map(a => a.msg);
    }
}

class FakeSource {
    constructor(defs) {
        this._defs = defs;
        this.v = Object.fromEntries(defs.map(d => [d.unique_id, {state: 0, icon: d.icon}]));
        this._callbacks = new Map();
        this._n = 0;
        this.started = false;
    }

    definitions() {
        return this._defs;
    }

    values() {
        return this.v;
    }

    connect(_s, fn) {
        this._callbacks.set(++this._n, fn);
        return this._n;
    }

    disconnect(id) {
        this._callbacks.delete(id);
    }

    start() {
        this.started = true;
    }

    stop() {
        this.started = false;
    }

    change(uid, state) {
        this.v = {...this.v, [uid]: {...this.v[uid], state}};
        [...this._callbacks.values()].forEach(fn => fn(this));
    }
}

const def = (uid, type = 'sensor') => ({unique_id: uid, type, name: uid, icon: 'mdi:x'});

function mount({locked = false, execute = async () => {}, period = 60} = {}) {
    const ma = new FakeMobileApp();
    const client = new FakeClient();
    const src = new FakeSource([def('volume'), def('muted', 'binary_sensor')]);
    const executed = [];
    const shown = [];
    const log = [];
    const c = new Companion({
        mobileApp: ma, client, sources: [src],
        execute: async cmd => (executed.push(cmd), execute(cmd)),
        display: m => shown.push(m),
        isLocked: () => locked,
        contactPeriod: period,
        now: () => '2026-10-03T12:00:00+00:00',
        log: msg => log.push(msg),
    });
    return {ma, client, src, c, executed, shown, log};
}

runAsync('companion', async () => {
    // Declares, then sends everything
    let m = mount();
    m.c.start();
    await wait(100);
    eq(m.src.started, true, 'source started');
    eq(m.ma.calls.slice(0, 3).map(a => a[0]), ['start', 'register', 'update'], 'declares, then sends everything');
    eq(m.ma.calls[1][1].map(d => d[0]), ['volume', 'muted', 'last_contact'], 'definitions + last contact');
    eq(m.ma.calls[1][1][0][1], 0, 'definition with initial state');
    eq(m.ma.updates()[0].map(e => e[0]).sort(), ['last_contact', 'muted', 'volume'], 'full send');

    // Push channel once connected
    eq(m.client.activeMessages(), [{type: 'mobile_app/push_notification_channel', webhook_id: 'wh', support_confirm: true}],
        'push channel subscribed');

    // 1 s batching, only what changed
    const n0 = m.ma.updates().length;
    for (let i = 1; i <= 10; i++) {
        m.src.change('volume', i * 10);
        await wait(50);
    }
    await wait(100);
    eq(m.ma.updates().length, n0, 'nothing before 1 s');
    await wait(800);
    eq(m.ma.updates().slice(n0), [[['volume', 100]]], '1 s batch, latest value, only what changed');
    m.src.change('volume', 100);
    await wait(1200);
    eq(m.ma.updates().slice(n0).filter(e => e.some(x => x[0] === 'volume')).length, 1, 'same value not sent again');
    m.c.stop();

    // Back to the previous value during a send (volume 0 -> 55 -> 0): HA must end at 0.
    m = mount();
    m.c.start();
    await wait(100);
    m.ma.delay = 400;
    m.src.change('volume', 55);
    await wait(1150);  // envoi de 55 en vol
    m.src.change('volume', 0);
    await wait(2000);
    const lastVolumes = m.ma.updates().flat().filter(x => x[0] === 'volume').map(x => x[1]);
    eq(lastVolumes.at(-1), 0, 'back to the previous value during a send');
    m.c.stop();

    // A send longer than 1 s: the latest value of a burst goes as soon as it ends, without waiting 60 s.
    m = mount();
    m.c.start();
    await wait(100);
    m.ma.delay = 1500;
    m.src.change('volume', 10);
    await wait(1200);  // the send of 10 is in flight until about 2.5 s
    m.src.change('volume', 20);
    await wait(3000);
    eq(m.ma.updates().flat().filter(x => x[0] === 'volume').map(x => x[1]).at(-1), 20, 'slow send: latest value sent');
    m.c.stop();

    // Outage: one value per sensor when back
    m = mount();
    m.c.start();
    await wait(100);
    m.ma.failing = true;
    for (let i = 1; i <= 5; i++) {
        m.src.change('volume', i);
        await wait(250);
    }
    await wait(1100);
    m.ma.failing = false;
    m.ma.calls.length = 0;
    m.src.change('muted', 1);
    await wait(1200);
    const back = m.ma.updates();
    eq(back.length >= 1, true, 'send when back');
    eq(back[0].filter(e => e[0] === 'volume'), [['volume', 5]], 'outage: one value per sensor when back');
    m.c.stop();

    // Resumed by the 60 s cycle (1 s here) without a new change; last_contact sent
    m = mount({period: 1});
    m.c.start();
    await wait(100);
    m.ma.failing = true;
    m.src.change('volume', 7);
    await wait(1100);
    m.ma.failing = false;
    m.ma.calls.length = 0;
    await wait(2300);  // timeout_add_seconds(1) fires between 1 and 2 s
    eq(m.ma.updates().some(e => e.some(x => x[0] === 'volume' && x[1] === 7)), true, 'resumed at the cycle');
    eq(m.ma.updates().some(e => e.some(x => x[0] === 'last_contact')), true, 'periodic last contact');
    m.c.stop();

    // Reconnection -> new channel subscription
    m = mount();
    m.c.start();
    await wait(100);
    m.client.setState('disconnected');
    eq(m.client.activeMessages().length, 0, 'no channel while offline');
    m.client.setState('connected');
    await wait(50);
    eq(m.client.activeMessages().length, 1, 'push channel after reconnection');

    // Command routed
    m.client.push({message: 'command_volume', data: {level: 30}, hass_confirm_id: 'c1'});
    await wait(50);
    eq(m.executed, [{name: 'volume', params: {level: 30}}], 'command routed');
    eq(m.client.calls.at(-1), {type: 'mobile_app/push_notification_confirm', webhook_id: 'wh', confirm_id: 'c1'},
        'confirmation sent');
    eq(m.ma.calls.at(-1), ['event', 'gnome_home_assistant_command', {command: 'volume', result: 'ok', detail: ''}], 'ok event');
    eq(m.shown, [], 'a command is never displayed');

    // Invalid command
    m.client.push({message: 'command_volume', data: {level: 400}, hass_confirm_id: 'c2'});
    await wait(50);
    eq(m.executed.length, 1, 'invalid one not executed');
    eq(m.ma.calls.at(-1).slice(0, 2), ['event', 'gnome_home_assistant_command'], 'error event');
    eq(m.ma.calls.at(-1)[2].result, 'error', 'error result');
    eq(m.ma.calls.at(-1)[2].command, 'volume', 'name of the failed command');

    // Notification displayed
    m.client.push({message: 'hello', title: 'T', data: {tag: 'a'}, hass_confirm_id: 'c3'});
    await wait(50);
    eq(m.shown.map(x => [x.type, x.title, x.body, x.tag]), [['show', 'T', 'hello', 'a']], 'notification displayed');
    m.client.push({message: 'clear_notification', data: {tag: 'a'}});
    await wait(50);
    eq(m.shown.at(-1), {type: 'clear', tag: 'a'}, 'clear passed on');
    m.c.stop();

    // Execution failure -> error with detail
    m = mount({execute: async () => {
        throw new Error('unknown application');
    }});
    m.c.start();
    await wait(100);
    m.client.push({message: 'command_launch_app', data: {app: 'x.desktop'}});
    await wait(50);
    eq(m.ma.calls.at(-1), ['event', 'gnome_home_assistant_command', {command: 'launch_app', result: 'error', detail: 'unknown application'}],
        'failed execution');
    m.c.stop();

    // Command refused while locked
    m = mount({locked: true});
    m.c.start();
    await wait(100);
    m.client.push({message: 'command_open_url', data: {url: 'https://a.b'}});
    await wait(50);
    eq(m.executed, [], 'refused one not executed');
    eq(m.ma.calls.at(-1)[2].result, 'refused', 'command refused while locked');

    // Recreated -> declares again, sends everything, subscribes with the new webhook
    m.ma.calls.length = 0;
    m.ma.recreate();
    await wait(1200);
    eq(m.ma.calls.filter(a => a[0] === 'register').length, 1, 'recreated -> declared again');
    eq(m.ma.updates().some(e => e.length === 3), true, 'recreated -> everything sent');
    eq(m.client.activeMessages(), [{type: 'mobile_app/push_notification_channel', webhook_id: 'wh2', support_confirm: true}],
        'recreated -> channel on the new webhook');

    // A send in flight during a recreation: replayed by MobileApp on the new device before the declaration, HA answers
    // not_registered -> no "rejected" warning, everything is sent again after the declaration.
    const warnings = m.log;
    warnings.length = 0;
    m.ma.updateSensors = async states => {
        m.ma.calls.push(['update', states.map(e => [e.unique_id, e.state])]);
        m.ma.updateSensors = FakeMobileApp.prototype.updateSensors;
        m.ma.recreate();
        return Object.fromEntries(states.map(e => [e.unique_id, {success: false, error: {code: 'not_registered', message: 'x'}}]));
    };
    m.src.change('volume', 42);
    await wait(2500);
    eq(warnings.filter(a => a.includes('rejected')), [], 'recreation in flight: no spurious warning');
    eq(m.ma.updates().at(-1).some(e => e[0] === 'volume' && e[1] === 42), true, 'recreation in flight: value sent again');

    // stop() cleans up
    m.c.stop();
    eq(m.src.started, false, 'source stopped');
    eq(m.client.activeMessages().length, 0, 'no subscription left');
    eq(m.client.listeners.size, 0, 'no client listener left');
    m.ma.calls.length = 0;
    m.src.change('volume', 99);
    m.client.setState('disconnected');
    m.client.setState('connected');
    await wait(2200);
    eq(m.ma.calls, [], 'stop() cleans up');

    // Recreated during the first declaration -> a new full declaration on the new device
    m = mount();
    m.ma.duringRegister = async () => {
        m.ma.duringRegister = null;
        m.ma.recreate();
        await wait(50);
    };
    m.c.start();
    await wait(300);
    eq(m.ma.calls.filter(a => a[0] === 'register').length, 2, 'recreated during declaration -> declared again');
    eq(m.client.activeMessages().map(x => x.webhook_id), ['wh2'], 'recreated during declaration -> channel on the new webhook');
    m.c.stop();

    // Source with an asynchronous start (D-Bus): its definitions are awaited before the declaration
    m = mount();
    const slow = new FakeSource([]);
    slow.start = () => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        slow._defs = [def('keyboard_backlight')];
        slow.v = {keyboard_backlight: {state: 25}};
        r();
        return GLib.SOURCE_REMOVE;
    }));
    slow.stop = () => {};
    const c2 = new Companion({mobileApp: m.ma, client: m.client, sources: [m.src, slow], execute: async () => {},
        display: () => {}, isLocked: () => false, log: () => {}});
    c2.start();
    await wait(400);
    eq(m.ma.calls.find(a => a[0] === 'register')?.[1].map(d => d[0]).includes('keyboard_backlight'), true,
        'asynchronous source awaited before the declaration');
    c2.stop();

    // HA unreachable at start -> initialisation retried at the next cycle
    m = mount({period: 1});
    m.ma.start = async () => {
        m.ma.calls.push(['start']);
        if (m.ma.calls.length === 1)
            throw new Error('HA unreachable');
    };
    m.client.state = 'disconnected';
    m.c.start();
    await wait(2300);
    eq(m.ma.calls.filter(a => a[0] === 'start').length, 2, 'start retried');
    eq(m.ma.calls.some(a => a[0] === 'register'), true, 'declared after recovery');
    m.c.stop();

    // Token refused at registration -> no retry at the cycle (each attempt is a failed login in HA)
    m = mount({period: 1});
    m.ma.start = async () => {
        m.ma.calls.push(['start']);
        m.ma.tokenRejected = true;
        throw new Error('mobile_app registration rejected: HTTP 401');
    };
    m.client.state = 'rejected';
    m.c.start();
    await wait(2300);
    eq(m.ma.calls.filter(a => a[0] === 'start').length, 1, 'token refused -> registration not retried');
    eq(m.log.filter(j => j.includes('401')).length, 1, 'token refused -> logged once');
    m.c.stop();

    // HA restarted: WebSocket accepted before mobile_app is loaded -> the subscription fails, retried at the cycle
    m = mount({period: 1});
    let channelAttempts = 0;
    const normalSubscribe = m.client.subscribe.bind(m.client);
    m.client.subscribe = async (msg, fn) => {
        if (++channelAttempts === 1)
            throw new Error('Unknown command.');
        return normalSubscribe(msg, fn);
    };
    m.c.start();
    await wait(100);
    eq(m.client.activeMessages().length, 0, 'channel fails at first attempt');
    eq(m.log.some(j => j.includes('Unknown command.')), true, 'channel failure logged');
    await wait(2300);
    eq(m.client.activeMessages().map(x => x.webhook_id), ['wh'], 'channel subscribed again at the cycle after a failure');
    await wait(2300);
    eq(channelAttempts, 2, 'no new subscription once the channel is open');
    m.c.stop();

    // Value refused by HA (invalid_format): sent once, logged once, sent again when it changes.
    m = mount();
    m.c.start();
    await wait(100);
    m.ma.updateSensors = async states => {
        m.ma.calls.push(['update', states.map(e => [e.unique_id, e.state])]);
        return Object.fromEntries(states.map(e => [e.unique_id, e.unique_id === 'volume' && e.state === 13
            ? {success: false, error: {code: 'invalid_format', message: 'bad'}} : {success: true}]));
    };
    m.ma.calls.length = 0;
    m.log.length = 0;
    m.src.change('volume', 13);
    await wait(3500);
    eq(m.ma.updates(), [[['volume', 13]]], 'refused value sent once');
    eq(m.log.filter(j => j.includes('rejected')).length, 1, 'refusal logged once');
    m.src.change('volume', 13);
    await wait(1200);
    eq(m.ma.updates().length, 1, 'same refused value not sent again');
    m.src.change('volume', 14);
    await wait(1200);
    eq(m.ma.updates().at(-1), [['volume', 14]], 'new value sent after a refusal');
    m.c.stop();

    // Sensor deleted in HA (not_registered, device intact): declared again with its value, without a send loop.
    m = mount();
    m.c.start();
    await wait(100);
    let unknown = true;
    m.ma.updateSensors = async states => {
        m.ma.calls.push(['update', states.map(e => [e.unique_id, e.state])]);
        return Object.fromEntries(states.map(e => [e.unique_id, e.unique_id === 'volume' && unknown
            ? {success: false, error: {code: 'not_registered', message: 'x'}} : {success: true}]));
    };
    m.ma.registerSensors = async defs => {
        m.ma.calls.push(['register', defs.map(d => [d.unique_id, d.state])]);
        unknown = false;
    };
    m.ma.calls.length = 0;
    m.log.length = 0;
    m.src.change('volume', 21);
    await wait(3500);
    eq(m.ma.calls.map(a => a[0]), ['update', 'register'], 'not_registered -> one new declaration, no send loop');
    eq(m.ma.calls[1][1], [['volume', 21]], 'not_registered -> only this sensor declared again, with its value');
    eq(m.log, [], 'not_registered -> no "rejected" warning');
    m.c.stop();

});
