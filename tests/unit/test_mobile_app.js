// MobileApp against a local fake Home Assistant (Soup.Server): registration, webhook, device deleted in HA, token
// refused. Also the registration file (0600, ignored for another URL).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {eq, runAsync} from './assert.js';
import {tempDir, cleanTempDirs} from './tmpdir.js';
import {readRegistration, writeRegistration, deleteRegistration}
    from '../../extension/home-assistant@maximeallanic.github.io/companion/registration.js';
import {MobileApp} from '../../extension/home-assistant@maximeallanic.github.io/companion/mobile-app.js';

// Fake HA: each registration creates a webhook; clearing `valid` simulates the device deleted in HA.
const fake = {registrations: [], webhooks: [], valid: new Set(), mode: 'empty', authorization: [], confirmed: true, checked: []};
// Check over the WebSocket (by the extension): is the device really gone from HA?
const checkDeleted = async deviceId => (fake.checked.push(deviceId), fake.confirmed);
let n = 0;
const server = new Soup.Server();
function reply(msg, status, body) {
    msg.set_status(status, null);
    if (body !== undefined)
        msg.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode(JSON.stringify(body)));
}
const register = (_s, msg) => {
    fake.authorization.push(msg.get_request_headers().get_one('Authorization'));
    const body = JSON.parse(new TextDecoder().decode(msg.get_request_body().flatten().get_data()));
    fake.registrations.push(body);
    const id = `wh${++n}`;
    fake.valid.add(id);
    reply(msg, 201, {webhook_id: id, secret: null, cloudhook_url: null, remote_ui_url: null});
};
server.add_handler('/api/mobile_app/registrations', register);
server.add_handler('/api/webhook', (_s, msg, path) => {
    const id = path.split('/').pop();
    const body = JSON.parse(new TextDecoder().decode(msg.get_request_body().flatten().get_data()));
    fake.webhooks.push({id, ...body});
    if (!fake.valid.has(id)) {
        // HA 2026.9: unknown webhook -> 200 with an empty body; 410 kept for other versions.
        reply(msg, fake.mode === '410' ? 410 : 200);
        return;
    }
    if (body.type === 'error_test')
        reply(msg, 500, {});
    else if (body.type === 'update_sensor_states')
        reply(msg, 200, Object.fromEntries(body.data.map(s => [s.unique_id, {success: true}])));
    else if (body.type === 'register_sensor')
        reply(msg, 201, {success: true});
    else
        reply(msg, 200, {});
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const url = `http://127.0.0.1:${server.get_uris()[0].get_port()}`;
const device = {name: 'Computer', app_version: '0.1.0', manufacturer: 'ACME', model: 'Laptop 13', os_name: 'Debian GNU/Linux',
    os_version: '14'};

function mode(path) {
    return Gio.File.new_for_path(path).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
        .get_attribute_uint32('unix::mode') & 0o777;
}

runAsync('mobile-app', async () => {
    const dir = tempDir();
    const path = `${dir}/sub/registration.json`;

    // registration.js
    eq(readRegistration(path, url), null, 'absent');
    writeRegistration(path, {url, device_id: 'd', webhook_id: 'w'});
    eq(readRegistration(path, url), {url, device_id: 'd', webhook_id: 'w'}, 'read back');
    eq(readRegistration(path, 'https://other.example'), null, 'other URL ignored');
    eq(mode(path), 0o600, 'file is 0600');
    eq(mode(`${dir}/sub`), 0o700, 'directory is 0700');
    GLib.file_set_contents(path, `{"url": "${url}", "device_id": "d"}`);
    eq(readRegistration(path, url), null, 'incomplete');
    deleteRegistration(path);
    deleteRegistration(path);
    eq(GLib.file_test(path, GLib.FileTest.EXISTS), false, 'deleted (twice without error)');

    // First start registers
    const a = new MobileApp({url, token: 'token', path, device});
    await a.start();
    eq(fake.registrations.length, 1, 'first start registers');
    const e = fake.registrations[0];
    eq([e.device_name, e.app_id, e.app_name, e.os_name, e.supports_encryption, e.app_data.push_websocket_channel,
        e.manufacturer, e.model, typeof e.device_id], ['Computer', 'io.github.maximeallanic.GnomeHomeAssistant',
        'Hearth for Home Assistant', 'Debian GNU/Linux', false, true, 'ACME', 'Laptop 13', 'string'], 'registration body');
    eq(fake.authorization[0], 'Bearer token', 'token sent');
    eq(a.webhookId, 'wh1', 'webhook kept');
    eq(readRegistration(path, url), {url, device_id: e.device_id, webhook_id: 'wh1'}, 'registration written');
    eq(mode(path), 0o600, 'registration is 0600');

    // Reuses the registration
    const b = new MobileApp({url, token: 'token', path, device, checkDeleted});
    await b.start();
    eq(fake.registrations.length, 1, 'registration reused');
    eq(b.webhookId, 'wh1', 'same webhook');

    // registerSensors / updateSensors / fireEvent
    const defs = [{unique_id: 'a', type: 'sensor', name: 'A', state: 1, icon: 'mdi:a'},
        {unique_id: 'b', type: 'binary_sensor', name: 'B', state: false, icon: 'mdi:b'}];
    await b.registerSensors(defs);
    eq(fake.webhooks.map(w => [w.id, w.type, w.data.unique_id]), [['wh1', 'register_sensor', 'a'],
        ['wh1', 'register_sensor', 'b']], 'registerSensors');
    const states = [{unique_id: 'a', type: 'sensor', state: 2, icon: 'mdi:a'}];
    await b.updateSensors(states);
    eq(fake.webhooks.at(-1), {id: 'wh1', type: 'update_sensor_states', data: states}, 'updateSensors');
    await b.fireEvent('gnome_home_assistant_command', {command: 'volume', result: 'ok', detail: ''});
    eq(fake.webhooks.at(-1), {id: 'wh1', type: 'fire_event',
        data: {event_type: 'gnome_home_assistant_command', event_data: {command: 'volume', result: 'ok', detail: ''}}}, 'fireEvent');

    // HTTP error -> rejection
    let rejection = null;
    await b._webhook('error_test', {}).catch(err => (rejection = err.message));
    eq(rejection?.includes('500'), true, 'HTTP 500 -> rejection');
    eq(rejection.includes('wh1'), false, 'webhook_id not in the error message');

    // Empty body but the device still in HA (HA restarting, entry disabled) -> passing error: no new registration,
    // the file is kept.
    fake.mode = 'empty';
    fake.confirmed = false;
    fake.valid.clear();
    let regs0 = fake.registrations.length;
    rejection = null;
    await b.updateSensors(states).catch(err => (rejection = err.message));
    eq(rejection !== null, true, 'empty, not confirmed -> rejection');
    eq(fake.registrations.length, regs0, 'empty, not confirmed -> no new registration');
    eq(readRegistration(path, url)?.webhook_id, 'wh1', 'empty, not confirmed -> file kept');
    eq(fake.checked.at(-1), e.device_id, 'check on the registered device_id');
    fake.valid.add('wh1');
    fake.confirmed = true;

    // Device deleted in HA (empty body confirmed, then 410) -> new registration, onRecreated, request replayed
    for (const m of ['empty', '410']) {
        fake.mode = m;
        fake.valid.clear();
        const before = fake.registrations.length;
        let recreated = 0;
        b.onRecreated(() => recreated++);
        await Promise.all([b.updateSensors(states), b.updateSensors(states)]);
        eq(fake.registrations.length, before + 1, `${m} -> a single new registration`);
        eq(recreated >= 1, true, `${m} -> onRecreated`);
        const fresh = `wh${n}`;
        eq(b.webhookId, fresh, `${m} -> new webhook`);
        eq(fake.webhooks.slice(-2).map(w => [w.id, w.type]), [[fresh, 'update_sensor_states'],
            [fresh, 'update_sensor_states']], `${m} -> requests replayed`);
        eq(readRegistration(path, url).webhook_id, fresh, `${m} -> file updated`);
        eq(fake.registrations.at(-1).device_id !== e.device_id, true, `${m} -> new device`);
    }
    eq(new Set(fake.registrations.map(x => x.device_id)).size, fake.registrations.length, 'distinct device_ids');

    // Unreadable file -> new registration
    GLib.file_set_contents(path, '{');
    const c = new MobileApp({url, token: 'token', path, device: {...device, name: 'Компьютер (test)'}, checkDeleted});
    const before = fake.registrations.length;
    await c.start();
    eq(fake.registrations.length, before + 1, 'unreadable file -> new registration');
    eq(fake.registrations.at(-1).device_name, 'Компьютер (test)', 'configurable name, any script');
    eq(readRegistration(path, url)?.webhook_id, c.webhookId, 'file written again');

    // Token refused at registration -> rejection, nothing written
    const other = `${dir}/other.json`;
    server.add_handler('/api/mobile_app/registrations', (_s, msg) => reply(msg, 401, {message: 'refused'}));
    rejection = null;
    await new MobileApp({url, token: 'bad', path: other, device}).start().catch(err => (rejection = err.message));
    eq(rejection?.includes('401'), true, 'registration refused -> rejection');
    eq(GLib.file_test(other, GLib.FileTest.EXISTS), false, 'nothing written');
    // Token refused (401, or 403 from a banned address): no more requests with this token, even to recreate.
    for (const status of [401, 403]) {
        let attempts = 0;
        server.add_handler('/api/mobile_app/registrations', (_s, msg) => (attempts++, reply(msg, status, {})));
        const r = new MobileApp({url, token: 'bad', path: other, device});
        eq(r.tokenRejected, false, `${status}: not rejected before trying`);
        await r.start().catch(() => {});
        eq(r.tokenRejected, true, `${status}: token marked rejected`);
        rejection = null;
        await r.start().catch(err => (rejection = err.message));
        eq([attempts, rejection?.includes('already rejected')], [1, true], `${status}: no second request`);
        r.destroy();
    }

    // New registration failing for a while (HA answers 500) -> rejection, old file kept; at the next update, a new
    // attempt, only one even with two concurrent updates, and onRecreated called after the success.
    server.add_handler('/api/mobile_app/registrations', (_s, msg) => reply(msg, 500, {}));
    const previous = c.webhookId;
    let recreatedC = 0;
    c.onRecreated(() => recreatedC++);
    fake.valid.clear();
    rejection = null;
    await c.updateSensors(states).catch(err => (rejection = err.message));
    eq(rejection?.includes('500'), true, 'new registration refused -> rejection');
    eq(readRegistration(path, url)?.webhook_id, previous, 'new registration refused -> old file kept');
    eq(recreatedC, 0, 'new registration refused -> no onRecreated');
    server.add_handler('/api/mobile_app/registrations', register);
    regs0 = fake.registrations.length;
    await Promise.all([c.updateSensors(states), c.updateSensors(states)]);
    eq(fake.registrations.length, regs0 + 1, 'new registration tried once');
    eq(recreatedC, 1, 'new registration retried -> onRecreated');
    eq([fake.webhooks.at(-1).id, fake.webhooks.at(-1).type], [c.webhookId, 'update_sensor_states'], 'new registration retried');
    eq(readRegistration(path, url)?.webhook_id, c.webhookId, 'new file after success');
    eq(fake.webhooks.some(w => w.id === 'null'), false, 'never a "null" webhook');

    a.destroy();
    b.destroy();
    c.destroy();
}, cleanTempDirs);
