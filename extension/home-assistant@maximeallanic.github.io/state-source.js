// HA registries, states and to-do items kept up to date for the top bar entities and the grid with the entities its
// tiles name (chips ∪ grid). All asynchronous work goes through one queue: never two registry reads nor two
// resubscriptions at once. One generation per connection discards results that arrive after a disconnection or a stop().
import GLib from 'gi://GLib';
import {chips, trackedChipIds, domainOf} from './chips.js';
import {readGrid, trackedGridIds} from './grid.js';
import {fetchStateNames} from './state-names.js';

const BATCH_MS = 200;
const MAX_UPDATES = 50;  // beyond that, reading the whole registry costs less than N single reads

export class StateSource {
    // labels: () => {topbar, alert, grid}, the label names currently chosen in the preferences.
    constructor(client, labels) {
        this._client = client;
        this._labels = labels;
        this._listeners = new Set();
        this._timers = new Map();
        this._active = false;
        this._generation = 0;
        this._queue = Promise.resolve();
        this._entities = [];
        this._labelRegistry = [];
        this._states = {};
        this._tasks = {};
        this._stateNames = null;  // HA's translations of the state words, in the session language
        this._connected = false;
        this._entityUpdates = new Map();  // entity_id -> pending event; null = full reread
        // Ids HA has answered for (first event of their subscription received, or subscription refused): a missing
        // state there means "no state", no longer "not arrived yet". Kept across disconnections, like the states.
        this._answeredIds = new Set();
        this._forgetSubscriptions();
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    start() {
        this._active = true;
        this._stateUnsubscribe = this._client.onState(s => this._clientState(s));
        if (this._client.state === 'connected')
            this._clientState('connected');
    }

    stop() {
        this._active = false;
        this._generation++;
        this._stateUnsubscribe?.();
        this._stateUnsubscribe = null;
        this._cancelTimers();
        for (const end of [...this._registryEnds, this._entitiesEnd, ...this._todoEnds.values()])
            end?.();
        this._forgetSubscriptions();
        this._answeredIds = new Set();
    }

    // The label names changed in the preferences: what is tracked may change, nothing else to reread.
    labelsChanged() {
        this._schedule('sync', g => this._sync(g).then(() => this._emit()));
        this._emit();
    }

    // The client purges its own subscriptions when the connection drops: ours are forgotten without sending anything.
    _forgetSubscriptions() {
        this._registryEnds = [];
        this._entitiesEnd = null;
        this._subscribedKey = '';
        this._requestedIds = new Set();  // ids already asked from HA (subscription accepted or refused)
        this._todoEnds = new Map();
        this._namesKey = '';  // domains whose state translations were asked on this connection
    }

    _cancelTimers() {
        for (const id of this._timers.values())
            GLib.source_remove(id);
        this._timers.clear();
    }

    _emit() {
        if (!this._active)
            return;
        const d = {entities: this._entities, labels: this._labelRegistry, states: this._states,
            tasks: this._tasks, connected: this._connected, answered: this._answeredIds, stateNames: this._stateNames};
        for (const fn of [...this._listeners])
            fn(d);
    }

    _clientState(state) {
        if (!this._active)
            return;
        if (state === 'connected') {
            this._generation++;
            this._connected = true;
            this._forgetSubscriptions();
            this._enqueue(g => this._begin(g));
        } else if (this._connected && state !== 'connecting') {
            // Disconnected: the last data is kept (tiles dimmed, not removed), no subscription any more.
            this._generation++;
            this._connected = false;
            this._cancelTimers();
            this._forgetSubscriptions();
            this._emit();
        } else if (state === 'rejected' || state === 'disconnected') {
            this._connected = false;
            this._emit();
        }
    }

    // Runs fn after the work in progress, only if the connection that asked for it is still there.
    _enqueue(fn) {
        const generation = this._generation;
        this._queue = this._queue.then(() => {
            if (this._active && this._connected && generation === this._generation)
                return fn(generation);
            return null;
        }).catch(e => console.warn(`[home-assistant] ${e.message}`));
        return this._queue;
    }

    _schedule(key, fn) {
        if (this._timers.has(key))
            return;
        this._timers.set(key, GLib.timeout_add(GLib.PRIORITY_DEFAULT, BATCH_MS, () => {
            this._timers.delete(key);
            this._enqueue(fn);
            return GLib.SOURCE_REMOVE;
        }));
    }

    // Subscription accepted but the generation moved on meanwhile: given back at once.
    async _subscribe(msg, callback, generation) {
        const end = await this._client.subscribe(msg, callback);
        if (generation !== this._generation) {
            end();
            return null;
        }
        return end;
    }

    async _begin(generation) {
        // Registry events first, then the read: no change slips between the two.
        const callbacks = {
            entity_registry_updated: ev => this._noteEntity(ev),
            label_registry_updated: () => this._schedule('labels', g => this._readLabels(g)),
        };
        for (const [type, callback] of Object.entries(callbacks)) {
            try {
                const end = await this._subscribe({type: 'subscribe_events', event_type: type}, callback, generation);
                if (end)
                    this._registryEnds.push(end);
            } catch (e) {
                console.warn(`[home-assistant] subscription ${type}: ${e.message}`);
            }
        }
        await this._readRegistries(generation);
    }

    // Entity registry event: the entity is remembered (read alone later); without entity_id, everything is reread.
    _noteEntity(ev) {
        if (this._entityUpdates && ev?.entity_id) {
            if (ev.old_entity_id)
                this._entityUpdates.set(ev.old_entity_id, {action: 'remove'});
            this._entityUpdates.set(ev.entity_id, ev);
        } else {
            this._entityUpdates = null;
        }
        this._schedule('registries', g => this._applyEntities(g));
    }

    async _applyEntities(generation) {
        const updates = this._entityUpdates;
        this._entityUpdates = new Map();
        if (updates === null || updates.size > MAX_UPDATES)
            return this._readRegistries(generation);
        const entities = new Map(this._entities.map(e => [e.entity_id, e]));
        for (const [id, ev] of updates) {
            entities.delete(id);
            if (ev.action === 'remove')
                continue;
            try {
                entities.set(id, await this._client.call({type: 'config/entity_registry/get', entity_id: id}));
            } catch (_e) {
                // Not found (removed meanwhile): stays removed.
            }
            if (generation !== this._generation)
                return null;
        }
        this._entities = [...entities.values()];
        await this._sync(generation);
        this._emit();
        return null;
    }

    async _readLabels(generation) {
        const labels = await this._client.call({type: 'config/label_registry/list'});
        if (generation !== this._generation)
            return;
        this._labelRegistry = labels;
        await this._sync(generation);
        this._emit();
    }

    async _readRegistries(generation) {
        this._entityUpdates = new Map();  // what arrives during the read is applied afterwards
        const [labels, entities] = await Promise.all([
            this._client.call({type: 'config/label_registry/list'}),
            this._client.call({type: 'config/entity_registry/list'}),
        ]);
        if (generation !== this._generation)
            return;
        this._labelRegistry = labels;
        this._entities = entities;
        await this._sync(generation);
        this._emit();
    }

    _grid() {
        return readGrid(this._entities, this._labelRegistry, this._states, this._labels().grid, this._answeredIds,
            this._stateNames);
    }

    // Resubscribes when the set of tracked entities (chips ∪ grid) changed.
    async _sync(generation) {
        const grid = this._grid();
        const ids = [...new Set([
            ...trackedChipIds(chips(this._entities, this._labelRegistry, this._states, this._labels())),
            ...grid ? trackedGridIds(grid) : [],
        ])].sort();
        const key = ids.join(',');
        if (key !== this._subscribedKey) {
            this._subscribedKey = key;
            this._requestedIds = new Set(ids);
            this._entitiesEnd?.();
            this._entitiesEnd = null;
            for (const id of Object.keys(this._states)) {
                if (!ids.includes(id))
                    delete this._states[id];
            }
            for (const id of [...this._answeredIds]) {
                if (!ids.includes(id))
                    this._answeredIds.delete(id);
            }
            if (ids.length > 0) {
                // HA always sends a first event (a) after the result, even empty: that is its answer for ids.
                let first = true;
                try {
                    this._entitiesEnd = await this._subscribe({type: 'subscribe_entities', entity_ids: ids}, ev => {
                        if (first) {
                            first = false;
                            ids.forEach(id => this._answeredIds.add(id));
                        }
                        this._entitiesEvent(ev);
                    }, generation);
                } catch (e) {
                    console.warn(`[home-assistant] entity subscription: ${e.message}`);
                    this._subscribedKey = '';  // new attempt at the next change
                    // Refused: no state to wait for, what is missing is shown as missing (no pending grid).
                    ids.forEach(id => this._answeredIds.add(id));
                    this._emit();  // a render held back by _gridIncomplete() shows what there is
                }
            }
        }
        if (generation === this._generation)
            await this._syncTodos(ids.filter(id => domainOf(id) === 'todo'), generation);
        if (generation === this._generation)
            await this._syncStateNames(ids, generation);
    }

    // HA's translations of the state words of the tracked domains, asked again when a new domain appears. Without
    // them (older HA, refused call) states are shown as HA sends them, and the next change tries again.
    async _syncStateNames(ids, generation) {
        const domains = [...new Set(ids.map(domainOf))].sort();
        const key = domains.join(',');
        if (key === this._namesKey)
            return;
        this._namesKey = key;
        try {
            const names = await fetchStateNames(this._client, domains);
            if (generation !== this._generation)
                return;
            this._stateNames = names;
            // A subscription still waiting for its first event emits with the names; emitting before it would show
            // its entities as missing for a moment.
            if ([...this._requestedIds].every(id => this._answeredIds.has(id)))
                this._emit();
        } catch (e) {
            console.warn(`[home-assistant] state translations: ${e.message}`);
            if (generation === this._generation)
                this._namesKey = '';
        }
    }

    async _syncTodos(todos, generation) {
        for (const [id, end] of this._todoEnds) {
            if (!todos.includes(id)) {
                end?.();
                this._todoEnds.delete(id);
                delete this._tasks[id];
            }
        }
        for (const id of todos) {
            if (this._todoEnds.has(id))
                continue;
            try {
                const end = await this._subscribe({type: 'todo/item/subscribe', entity_id: id}, ev => {
                    this._tasks[id] = ev.items ?? [];
                    this._emit();
                }, generation);
                if (end)
                    this._todoEnds.set(id, end);
            } catch (e) {
                console.warn(`[home-assistant] subscription to ${id}: ${e.message}`);
            }
        }
    }

    // Compressed format of subscribe_entities: a (added), c (changed, +/-), r (removed).
    _entitiesEvent(ev) {
        for (const [id, e] of Object.entries(ev.a ?? {}))
            this._states[id] = {state: e.s, attributes: e.a ?? {}};
        for (const [id, diff] of Object.entries(ev.c ?? {})) {
            const state = this._states[id];
            if (!state)
                continue;
            const plus = diff['+'] ?? {};
            const attributes = {...state.attributes, ...plus.a ?? {}};
            for (const key of diff['-']?.a ?? [])
                delete attributes[key];
            this._states[id] = {state: plus.s ?? state.state, attributes};
        }
        for (const id of ev.r ?? [])
            delete this._states[id];
        this._schedule('sync', g => this._sync(g));
        if (!this._gridIncomplete())
            this._emit();
    }

    // The grid's state just arrived (or added a mini-tile) but its entities are not requested yet: their states are on
    // their way with the next subscription. Emitting now would show them all unavailable or not found, then right
    // 200 ms later; the render waits for the subscription, whose first event emits.
    _gridIncomplete() {
        const grid = this._grid();
        return Boolean(grid) && !grid.pending && trackedGridIds(grid).some(id => !this._requestedIds.has(id));
    }
}
