// A fake Home Assistant for tests and screenshots: the WebSocket API calls the extension makes, GET /api/config, and
// the mobile_app registration and webhook endpoints. It serves fixture.json (a made-up home), listens on 127.0.0.1
// only, and logs every request it receives as one JSON line on stdout.
//
//   gjs -m tests/fake-ha/server.js [--fixture FILE] [--port-file FILE]
//
// The port is chosen by the system and written to --port-file once the server listens. Service calls change the
// fixture states the way Home Assistant would for the simple cases (toggle, turn_on, turn_off), so that a click in a
// nested Shell shows its effect.
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import Soup from 'gi://Soup?version=3.0';
import System from 'system';

const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

function parseArgs(argv) {
    const args = {fixture: GLib.build_filenamev([HERE, 'fixture.json']), portFile: null};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--fixture')
            args.fixture = argv[++i];
        else if (argv[i] === '--port-file')
            args.portFile = argv[++i];
        else
            throw new Error(`unknown argument: ${argv[i]}`);
    }
    return args;
}

const args = parseArgs(ARGV);
const fixture = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(args.fixture)[1]));
const states = fixture.states;
const subscriptions = new Set();  // {conn, id, ids}
const registrations = new Map();  // webhook_id -> registration
let lastContext = 0;

function log(entry) {
    print(JSON.stringify({time: new Date().toISOString(), ...entry}));
}

function respond(msg, status, body) {
    msg.set_status(status, null);
    if (body !== undefined)
        msg.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode(JSON.stringify(body)));
}

function requestJson(msg) {
    const bytes = msg.get_request_body().flatten().get_data();
    return bytes?.length ? JSON.parse(new TextDecoder().decode(bytes)) : null;
}

const authorized = msg => msg.get_request_headers().get_one('Authorization') === `Bearer ${fixture.token}`;

// --- WebSocket API -------------------------------------------------------------------------------------------------

function entityEvent(ids) {
    const a = {};
    for (const id of ids) {
        if (states[id])
            a[id] = {s: states[id].s, a: states[id].a, c: `ctx-${id}`, lc: 0};
    }
    return {a};
}

function setState(id, s, attributes = {}) {
    if (!states[id])
        return;
    states[id] = {s, a: {...states[id].a, ...attributes}};
    for (const sub of subscriptions) {
        if (sub.ids.includes(id))
            send(sub.conn, {id: sub.id, type: 'event', event: {c: {[id]: {'+': {s, a: attributes}}}}});
    }
}

// The effect of a service call on the fixture, for the services the tiles use.
function applyService({domain, service, target, service_data: data}) {
    const ids = [].concat(target?.entity_id ?? []);
    for (const id of ids) {
        const current = states[id]?.s;
        if (service === 'toggle')
            setState(id, current === 'on' ? 'off' : 'on');
        else if (service === 'turn_on')
            setState(id, 'on', data?.brightness !== undefined ? {brightness: data.brightness} : {});
        else if (service === 'turn_off')
            setState(id, 'off');
        else if (domain === 'cover' && service === 'set_cover_position')
            setState(id, data.position > 0 ? 'open' : 'closed', {current_position: data.position});
    }
}

function send(conn, message) {
    if (conn.get_state() === Soup.WebsocketState.OPEN)
        conn.send_text(JSON.stringify(message));
}

function handle(conn, msg) {
    const ok = result => send(conn, {id: msg.id, type: 'result', success: true, result});
    const fail = (code, message) => send(conn, {id: msg.id, type: 'result', success: false, error: {code, message}});
    switch (msg.type) {
    case 'config/label_registry/list':
        return ok(fixture.labels);
    case 'config/entity_registry/list':
        return ok(fixture.entities);
    case 'config/entity_registry/get': {
        const entity = fixture.entities.find(e => e.entity_id === msg.entity_id);
        return entity ? ok(entity) : fail('not_found', 'Entity not found');
    }
    case 'config/device_registry/list':
        return ok([...registrations.values()].map(r => ({id: r.device_id, name: r.device_name,
            identifiers: [['mobile_app', r.device_id]]})));
    case 'get_config':
        return ok({...fixture.config, components: ['mobile_app', 'todo']});
    case 'get_services':
        return ok({notify: Object.fromEntries([...registrations.values()].map(r =>
            [`mobile_app_${r.device_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`, {}]))});
    case 'subscribe_events':
    case 'mobile_app/push_notification_channel':
        return ok(null);
    case 'unsubscribe_events':
        for (const sub of subscriptions) {
            if (sub.conn === conn && sub.id === msg.subscription)
                subscriptions.delete(sub);
        }
        return ok(null);
    case 'subscribe_entities': {
        const sub = {conn, id: msg.id, ids: msg.entity_ids ?? Object.keys(states)};
        subscriptions.add(sub);
        ok(null);
        return send(conn, {id: msg.id, type: 'event', event: entityEvent(sub.ids)});
    }
    case 'todo/item/subscribe':
        ok(null);
        return send(conn, {id: msg.id, type: 'event', event: {items: fixture.todo?.[msg.entity_id] ?? []}});
    case 'frontend/get_translations': {
        // Like Home Assistant: a language without translations is answered in English.
        const all = fixture.translations[msg.language] ?? fixture.translations.en;
        const wanted = [].concat(msg.integration ?? []);
        return ok({resources: Object.fromEntries(Object.entries(all).filter(([key]) =>
            msg.category === 'entity_component' && (wanted.length === 0 || wanted.includes(key.split('.')[1]))))});
    }
    case 'call_service':
        applyService(msg);
        return ok({context: {id: `ctx-${++lastContext}`}});
    case 'mobile_app/push_notification_confirm':
        return ok(null);
    default:
        return fail('unknown_command', `Unknown command: ${msg.type}`);
    }
}

function onWebsocket(_server, _msg, _path, conn) {
    let authenticated = false;
    conn.connect('message', (_c, _type, bytes) => {
        const msg = JSON.parse(new TextDecoder().decode(bytes.toArray()));
        if (!authenticated) {
            authenticated = msg.type === 'auth' && msg.access_token === fixture.token;
            log({ws: 'auth', ok: authenticated});
            send(conn, authenticated
                ? {type: 'auth_ok', ha_version: fixture.config.version}
                : {type: 'auth_invalid', message: 'Invalid access token'});
            if (!authenticated)
                conn.close(Soup.WebsocketCloseCode.NORMAL, null);
            return;
        }
        log({ws: msg.type, ...msg.type === 'call_service' ? {domain: msg.domain, service: msg.service,
            target: msg.target, data: msg.service_data} : {}});
        handle(conn, msg);
    });
    conn.connect('closed', () => {
        for (const sub of subscriptions) {
            if (sub.conn === conn)
                subscriptions.delete(sub);
        }
    });
    send(conn, {type: 'auth_required', ha_version: fixture.config.version});
}

// --- HTTP ----------------------------------------------------------------------------------------------------------

function onConfig(_server, msg) {
    log({http: 'GET /api/config', authorized: authorized(msg)});
    if (!authorized(msg))
        return respond(msg, 401, {message: 'Unauthorized'});
    return respond(msg, 200, fixture.config);
}

function onRegistration(_server, msg) {
    if (!authorized(msg))
        return respond(msg, 401, {message: 'Unauthorized'});
    const body = requestJson(msg);
    const webhookId = GLib.uuid_string_random().replaceAll('-', '');
    registrations.set(webhookId, body);
    log({http: 'POST /api/mobile_app/registrations', device_name: body.device_name, app_id: body.app_id});
    return respond(msg, 201, {webhook_id: webhookId, cloudhook_url: null, remote_ui_url: null, secret: null});
}

function onWebhook(_server, msg, path) {
    const id = path.split('/').pop();
    if (!registrations.has(id))
        return respond(msg, 410);
    const {type, data} = requestJson(msg);
    log({http: 'POST /api/webhook', type, data});
    if (type === 'update_sensor_states')
        return respond(msg, 200, Object.fromEntries(data.map(s => [s.unique_id, {success: true}])));
    return respond(msg, 200, type === 'register_sensor' ? {success: true} : {});
}

const server = new Soup.Server({});
server.add_websocket_handler('/api/websocket', null, null, onWebsocket);
server.add_handler('/api/config', onConfig);
server.add_handler('/api/mobile_app/registrations', onRegistration);
server.add_handler('/api/webhook', onWebhook);
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const port = server.get_uris()[0].get_port();
if (args.portFile)
    GLib.file_set_contents(args.portFile, `${port}\n`);
log({listening: `http://127.0.0.1:${port}`});

const loop = new GLib.MainLoop(null, false);
for (const signal of [2, 15]) {
    GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
}
loop.run();
System.exit(0);
