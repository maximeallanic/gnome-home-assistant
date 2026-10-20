// StateSource with a fake client: registries, compressed state events, to-do lists, resubscriptions, the grid.
import GLib from 'gi://GLib';
import {eq, runAsync} from './assert.js';
import {StateSource} from '../../extension/home-assistant@maximeallanic.github.io/state-source.js';
import {readGrid} from '../../extension/home-assistant@maximeallanic.github.io/grid.js';
import {DEFAULT_LABELS} from '../../extension/home-assistant@maximeallanic.github.io/config.js';

const NAMES = DEFAULT_LABELS;
const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));

// Fake client: same interface as HaClient, records calls and subscriptions.
class FakeClient {
    constructor() {
        this.state = 'stopped';
        this._listeners = new Set();
        this.calls = [];
        this.subs = [];
        this.refuse = () => false;   // msg -> true: subscribe rejected (like HA on an invalid or unknown id)
        this.registryDelay = 0;
        this.inFlight = 0;
        this.maxInFlight = 0;
        this.labels = [{label_id: 'gnome_topbar', name: 'gnome-topbar'}, {label_id: 'gnome_grid', name: 'gnome-grid'}];
        this.entities = [
            {entity_id: 'sensor.vehicle', name: '1 · Vehicle', original_name: null, icon: null, labels: ['gnome_topbar']},
            {entity_id: 'sensor.chores', name: '2 · Chores', original_name: null, icon: null,
                labels: ['gnome_topbar', 'gnome_grid']},
        ];
    }

    onState(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    setState(e) {
        this.state = e;
        if (e !== 'connected')
            this.subs.forEach(a => (a.active = false));
        for (const fn of this._listeners)
            fn(e);
    }

    call(msg) {
        this.calls.push(msg);
        if (msg.type === 'config/label_registry/list')
            return Promise.resolve(this.labels);
        if (msg.type === 'config/entity_registry/list') {
            this.inFlight++;
            this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
            return wait(this.registryDelay).then(() => {
                this.inFlight--;
                return this.entities;
            });
        }
        if (msg.type === 'config/entity_registry/get') {
            const e = this.entities.find(x => x.entity_id === msg.entity_id);
            return e ? Promise.resolve(e) : Promise.reject(new Error('Entity not found'));
        }
        return Promise.resolve(null);
    }

    subscribe(msg, fn) {
        if (this.refuse(msg))
            return Promise.reject(new Error('refused'));
        const sub = {msg, fn, active: true};
        this.subs.push(sub);
        return Promise.resolve(() => {
            sub.active = false;
        });
    }

    active(type) {
        return this.subs.filter(a => a.active && a.msg.type === type);
    }

    emit(type, ev) {
        for (const a of this.active(type))
            a.fn(ev);
    }

    reads() {
        return this.calls.filter(m => m.type === 'config/entity_registry/list').length;
    }
}

// The grid entity (sensor.chores also carries the grid label) brings the entities of its tiles into the subscription.
const TILES = [{id: 'charger', entity: 'switch.charger', details: ['todo.chores_list']}];

runAsync('state-source', async () => {
    const c = new FakeClient();
    const s = new StateSource(c, () => NAMES);
    let last = null;
    let changes = 0;
    s.onChange(d => {
        last = d;
        changes++;
    });
    s.start();

    // Connection: registries read, then subscription to the top bar entities
    c.setState('connected');
    await wait(300);
    eq(c.reads(), 1, 'registry read');
    eq(c.active('subscribe_events').map(a => a.msg.event_type).sort(),
        ['entity_registry_updated', 'label_registry_updated'], 'registry subscriptions');
    eq(c.active('subscribe_entities').map(a => a.msg.entity_ids.sort()),
        [['sensor.chores', 'sensor.vehicle']], 'connection reads the registries then subscribes');

    // Compressed format: a, then c (+ and -), then r
    c.emit('subscribe_entities', {a: {
        'sensor.vehicle': {s: '', a: {icon: 'mdi:car'}},
        'sensor.chores': {s: '3', a: {tiles: TILES, old: 1}},
    }});
    eq(last.states['sensor.chores'], {state: '3', attributes: {tiles: TILES, old: 1}}, 'add a');
    c.emit('subscribe_entities', {c: {'sensor.chores': {'+': {s: '4', a: {new: 2}}, '-': {a: ['old']}}}});
    eq(last.states['sensor.chores'], {state: '4', attributes: {tiles: TILES, new: 2}}, 'change c');
    eq(last.connected, true, 'connected');

    // Grid tiles known -> subscribed again with their entities, plus the to-do subscription
    await wait(300);
    eq(c.active('subscribe_entities').map(a => a.msg.entity_ids.sort()),
        [['sensor.chores', 'sensor.vehicle', 'switch.charger', 'todo.chores_list']], 'changed grid = new subscription');
    eq(c.active('todo/item/subscribe').map(a => a.msg.entity_id), ['todo.chores_list'], 'todo suivi');
    c.emit('todo/item/subscribe', {items: [{uid: 'u1', summary: 'A', status: 'needs_action'}]});
    eq(last.tasks['todo.chores_list'].map(t => t.uid), ['u1'], 'tasks received');

    c.emit('subscribe_entities', {r: ['switch.charger']});
    eq('switch.charger' in last.states, false, 'retrait r');

    // Burst of registry updates: a single reread
    const readsBefore = c.reads();
    const subsBefore = c.subs.filter(a => a.msg.type === 'subscribe_entities').length;
    for (let i = 0; i < 5; i++) {
        c.emit('subscribe_events', {action: 'update'});
        await wait(10);
    }
    await wait(600);
    eq(c.reads() - readsBefore, 1, 'burst = one reread');
    eq(c.subs.filter(a => a.msg.type === 'subscribe_entities').length - subsBefore <= 1, true, 'burst = one new subscription');

    // Entity removed from the registry
    c.entities = c.entities.filter(e => e.entity_id !== 'sensor.vehicle');
    c.emit('subscribe_events', {action: 'remove'});
    await wait(600);
    eq(last.entities.map(e => e.entity_id), ['sensor.chores'], 'entity removed from the registry');
    eq(c.active('subscribe_entities').map(a => a.msg.entity_ids.sort()),
        [['sensor.chores', 'switch.charger', 'todo.chores_list']], 'subscription without the removed entity');

    // Reconnection: connected false, then everything is done again
    c.setState('disconnected');
    eq(last.connected, false, 'disconnection reported');
    eq(last.entities.map(e => e.entity_id), ['sensor.chores'], 'disconnection keeps the entities (greyed out)');
    eq(last.states['sensor.chores']?.state, '4', 'disconnection keeps the states');
    const readsBefore2 = c.reads();
    c.setState('connected');
    await wait(600);
    eq(c.reads(), readsBefore2 + 1, 'reconnection reads the registry again');
    eq(c.active('subscribe_entities').length, 1, 'reconnection subscribes again');
    // Like HA: the subscription first sends the full state (with the tiles attribute).
    c.emit('subscribe_entities', {a: {'sensor.chores': {s: '4', a: {tiles: TILES}}}});
    await wait(300);
    eq(c.active('todo/item/subscribe').length, 1, 'reconnection subscribes the to-dos again');

    // stop(): nothing more
    s.stop();
    eq(c.subs.filter(a => a.active).length, 0, 'stop unsubscribes everything');
    const n = changes;
    c.emit('subscribe_entities', {a: {'sensor.chores': {s: '9', a: {}}}});
    c.setState('disconnected');
    c.setState('connected');
    await wait(400);
    eq(changes, n, 'stop() -> no more onChange');

    // subscribe_entities refused -> new attempt at the next change
    const c2 = new FakeClient();
    c2.refuse = m => m.type === 'subscribe_entities';
    const s2 = new StateSource(c2, () => NAMES);
    s2.start();
    c2.setState('connected');
    await wait(300);
    eq(c2.active('subscribe_entities').length, 0, 'subscribe refused');
    c2.refuse = () => false;
    c2.emit('subscribe_events', {action: 'update'});
    await wait(600);
    eq(c2.active('subscribe_entities').length, 1, 'new attempt after refusal');
    s2.stop();

    // to-do refused, then corrected -> the right one is tracked, without error
    const c3 = new FakeClient();
    c3.refuse = m => m.type === 'todo/item/subscribe' && m.entity_id === 'todo.a_typo';
    const s3 = new StateSource(c3, () => NAMES);
    s3.start();
    c3.setState('connected');
    await wait(300);
    c3.emit('subscribe_entities', {a: {'sensor.chores': {s: '1', a: {tiles: [{id: 't', entity: 'switch.charger',
        details: ['todo.a_typo', 'todo.z_other']}]}}}});
    await wait(400);
    eq(c3.active('todo/item/subscribe').map(a => a.msg.entity_id), ['todo.z_other'], 'a refused to-do does not block the others');
    c3.emit('subscribe_entities', {c: {'sensor.chores': {'+': {a: {tiles: [{id: 't', entity: 'switch.charger',
        details: ['todo.good']}]}}}}});
    await wait(400);
    eq(c3.active('todo/item/subscribe').map(a => a.msg.entity_id), ['todo.good'], 'corrected to-do tracked');
    s3.stop();

    // Registry reads never concurrent, a single entity subscription in the end
    const c4 = new FakeClient();
    c4.registryDelay = 500;
    const s4 = new StateSource(c4, () => NAMES);
    s4.start();
    c4.setState('connected');
    await wait(100);
    for (let i = 0; i < 6; i++) {
        c4.emit('subscribe_events', {action: 'update'});
        await wait(150);
    }
    await wait(2500);
    eq(c4.maxInFlight, 1, 'registry reads serialised');
    eq(c4.active('subscribe_entities').length, 1, 'a single entity subscription');
    s4.stop();

    // A registry event with an entity_id -> only that entity is read again, not the whole registry
    const c5 = new FakeClient();
    const s5 = new StateSource(c5, () => NAMES);
    let d5 = null;
    s5.onChange(d => (d5 = d));
    s5.start();
    c5.setState('connected');
    await wait(300);
    c5.entities = [...c5.entities, {entity_id: 'sensor.new', name: '3 · New', original_name: null, icon: null, labels: ['gnome_topbar']}];
    c5.emit('subscribe_events', {action: 'create', entity_id: 'sensor.new'});
    await wait(500);
    eq(c5.reads(), 1, 'create: no full reread');
    eq(c5.calls.filter(m => m.type === 'config/entity_registry/get').map(m => m.entity_id), ['sensor.new'], 'create: only that entity read');
    eq(d5.entities.map(e => e.entity_id).sort(), ['sensor.chores', 'sensor.new', 'sensor.vehicle'], 'create applied');
    eq(c5.active('subscribe_entities').map(a => a.msg.entity_ids.sort()), [['sensor.chores', 'sensor.new', 'sensor.vehicle']],
        'create: new subscription');
    c5.entities = c5.entities.map(e => (e.entity_id === 'sensor.chores' ? {...e, labels: []} : e));
    c5.emit('subscribe_events', {action: 'update', entity_id: 'sensor.chores', changes: {labels: ['gnome_topbar']}});
    c5.emit('subscribe_events', {action: 'remove', entity_id: 'sensor.vehicle'});
    await wait(500);
    eq(c5.reads(), 1, 'update and remove: no full reread');
    eq(d5.entities.map(e => e.entity_id).sort(), ['sensor.chores', 'sensor.new'], 'remove applied');
    eq(d5.entities.find(e => e.entity_id === 'sensor.chores').labels, [], 'update applied');
    // Rename: the old id goes away
    c5.entities = c5.entities.map(e => (e.entity_id === 'sensor.new' ? {...e, entity_id: 'sensor.renamed'} : e));
    c5.emit('subscribe_events', {action: 'update', entity_id: 'sensor.renamed', old_entity_id: 'sensor.new', changes: {}});
    await wait(500);
    eq(d5.entities.map(e => e.entity_id).sort(), ['sensor.chores', 'sensor.renamed'], 'rename applied');
    eq(c5.reads(), 1, 'rename: no full reread');
    s5.stop();

    // Grid: the entity carrying the grid label is subscribed without the top bar label, then its tiles (entity, details, to-do)
    const c6 = new FakeClient();
    c6.labels = [{label_id: 'gnome_grid', name: 'gnome-grid'}];
    c6.entities = [{entity_id: 'sensor.home_grid', name: 'Home', original_name: null, icon: null, labels: ['gnome_grid']}];
    const s6 = new StateSource(c6, () => NAMES);
    // First connection: every emitted grid is either pending or complete — never "unreadable", never a tile whose
    // entity is only missing because its subscription has not been sent yet.
    const views6 = [];
    s6.onChange(d => views6.push(readGrid(d.entities, d.labels, d.states, NAMES.grid, d.answered)));
    s6.start();
    c6.setState('connected');
    await wait(300);
    eq(c6.active('subscribe_entities').map(a => a.msg.entity_ids.sort()), [['sensor.home_grid']], 'grille_abonnee');
    c6.emit('subscribe_entities', {a: {'sensor.home_grid': {s: 'ok', a: {
        tiles: [{id: 't', entity: 'light.office', details: ['todo.chores_list']}]}}}});
    await wait(300);
    eq(c6.active('subscribe_entities').map(a => a.msg.entity_ids.sort()),
        [['light.office', 'sensor.home_grid', 'todo.chores_list']], 'grille_tuiles_suivies');
    eq(c6.active('todo/item/subscribe').map(a => a.msg.entity_id), ['todo.chores_list'], 'grille_todo_suivi');
    // The new subscription's first event (HA always sends one, possibly empty) brings the tile states and renders.
    c6.emit('subscribe_entities', {a: {'sensor.home_grid': {s: 'ok', a: {
        tiles: [{id: 't', entity: 'light.office', details: ['todo.chores_list']}]}},
    'light.office': {s: 'on', a: {}}}});
    eq(views6.map(g => g.pending ? 'pending' : `${g.errors.join('+')}|${g.tiles.map(t => `${t.look}${t.missing ? '!' : ''}`)}`),
        ['pending', '|active'], 'first_connect_no_flash');
    const state6 = () => {
        const g = views6.at(-1);
        return g.pending ? 'pending' : `${g.errors.join('+')}|${g.tiles.map(t => t.look)}`;
    };
    // State removed mid-session (template.reload dropping the sensor): an error, not the old grid frozen
    c6.emit('subscribe_entities', {r: ['sensor.home_grid']});
    eq(state6(), 'no-state+unreadable|', 'grid_state_removed_mid_session_is_error');
    await wait(300);
    eq(c6.active('subscribe_entities').map(a => a.msg.entity_ids.sort()), [['sensor.home_grid']],
        'grid_state_removed_tiles_unsubscribed');
    // Recovery: the state comes back (HA sends it as an addition), tiles are subscribed again, then shown
    const n6 = views6.length;
    c6.emit('subscribe_entities', {a: {'sensor.home_grid': {s: 'ok', a: {
        tiles: [{id: 't', entity: 'light.office', details: ['todo.chores_list']}]}}}});
    eq(views6.length, n6, 'grid_recovery_held_until_tiles_subscribed');
    await wait(300);
    c6.emit('subscribe_entities', {a: {'sensor.home_grid': {s: 'ok', a: {
        tiles: [{id: 't', entity: 'light.office', details: ['todo.chores_list']}]}}, 'light.office': {s: 'on', a: {}}}});
    eq(state6(), '|active', 'grid_recovery_when_state_returns');
    s6.stop();

    // Fresh session, grid entity in the registry but HA has no state for it: pending only until HA answers
    const c7 = new FakeClient();
    c7.labels = [{label_id: 'gnome_grid', name: 'gnome-grid'}];
    c7.entities = [{entity_id: 'sensor.home_grid', name: 'Home', original_name: null, icon: null, labels: ['gnome_grid']}];
    const s7 = new StateSource(c7, () => NAMES);
    const views7 = [];
    s7.onChange(d => views7.push(readGrid(d.entities, d.labels, d.states, NAMES.grid, d.answered)));
    s7.start();
    c7.setState('connected');
    await wait(300);
    eq(views7.map(g => g.pending), [true], 'no_state_pending_before_first_event');
    c7.emit('subscribe_entities', {a: {}});  // HA's first event: nothing for this id
    eq(views7.at(-1).errors, ['no-state', 'unreadable'], 'no_state_error_after_first_event');
    s7.stop();

    // Refused subscription: nothing will come, so the grid is not left pending
    const c8 = new FakeClient();
    c8.labels = c7.labels;
    c8.entities = c7.entities;
    c8.refuse = m => m.type === 'subscribe_entities';
    const s8 = new StateSource(c8, () => NAMES);
    let d8 = null;
    s8.onChange(d => (d8 = d));
    s8.start();
    c8.setState('connected');
    await wait(300);
    eq(readGrid(d8.entities, d8.labels, d8.states, NAMES.grid, d8.answered).errors, ['no-state', 'unreadable'],
        'refused_subscription_not_pending');
    s8.stop();

    // Label names changed in the preferences: what is tracked follows, without reading the registry again.
    const c9 = new FakeClient();
    c9.labels = [{label_id: 'gnome_topbar', name: 'gnome-topbar'}, {label_id: 'barre', name: 'Barre'}];
    c9.entities = [
        {entity_id: 'sensor.a', name: 'A', original_name: null, icon: null, labels: ['gnome_topbar']},
        {entity_id: 'sensor.b', name: 'B', original_name: null, icon: null, labels: ['barre']},
    ];
    let names9 = NAMES;
    const s9 = new StateSource(c9, () => names9);
    s9.start();
    c9.setState('connected');
    await wait(300);
    eq(c9.active('subscribe_entities').map(a => a.msg.entity_ids), [['sensor.a']], 'default label tracked');
    names9 = {...NAMES, topbar: 'barre'};
    s9.labelsChanged();
    await wait(600);
    eq(c9.active('subscribe_entities').map(a => a.msg.entity_ids), [['sensor.b']], 'renamed label tracked');
    eq(c9.reads(), 1, 'label change: no registry reread');
    s9.stop();

});
