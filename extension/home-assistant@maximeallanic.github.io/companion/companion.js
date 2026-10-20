// mobile_app companion: declares the sensors of the sources, sends only what changes (batched over 1 s), keeps a single
// value per sensor while HA cannot be reached, and listens to HA's push channel (commands -> execute, anything else ->
// display). No Shell dependency: testable with gjs -m.
import GLib from 'gi://GLib';
import {COMMAND_EVENT, COMMAND_PREFIX, parseCommand} from './commands.js';
import {toModel} from './notification-model.js';
import {_} from '../i18n.js';

export const CONTACT_ID = 'last_contact';

// Built on demand: the name is translated, and the Shell binds the gettext domain only once the extension is enabled.
function contactSensor() {
    return {
        unique_id: CONTACT_ID, type: 'sensor', name: _('Last contact'), device_class: 'timestamp',
        entity_category: 'diagnostic', icon: 'mdi:clock-check-outline',
    };
}

export class Companion {
    // onReady: called each time the sensors have been declared to HA (first start, device recreated).
    constructor({mobileApp, client, sources, execute, display, isLocked, batchMs = 1000, contactPeriod = 60,
        now = () => new Date().toISOString(), log = msg => console.warn(msg), onReady = () => {}}) {
        this._ma = mobileApp;
        this._client = client;
        this._sources = sources;
        this._execute = execute;
        this._display = display;
        this._isLocked = isLocked;
        this._batchMs = batchMs;
        this._period = contactPeriod;
        this._now = now;
        this._log = log;
        this._onReady = onReady;
        this._active = false;
        this._ready = false;
        this._init = null;
        this._types = new Map();     // unique_id -> type
        this._sent = new Map();      // unique_id -> JSON of the last value HA received
        this._toSend = new Map();    // unique_id -> latest value HA has not received yet
        this._rejected = new Map();  // unique_id -> JSON of the last value HA refused (not sent again as is)
        this._sending = false;
        this._batchTimer = 0;
        this._cycle = 0;
        this._signals = [];
        this._stateEnd = null;
        this._recreatedEnd = null;
        this._channelEnd = null;
        this._channelWebhook = null;
    }

    start() {
        if (this._active)
            return;
        this._active = true;
        this._starts = [];
        for (const s of this._sources) {
            // start() may be asynchronous (D-Bus proxies): the declaration waits for it.
            this._starts.push(Promise.resolve(s.start())
                .catch(e => this._log(`[home-assistant] sensor source: ${e.message}`)));
            this._signals.push([s, s.connect('changed', () => this._collect(s))]);
        }
        this._stateEnd = this._client.onState(state => {
            if (state === 'connected')
                this._subscribeChannel();
            else
                this._channelEnd = this._channelWebhook = null;  // the client purged its subscriptions
        });
        this._recreatedEnd = this._ma.onRecreated(() => this._recreated());
        this._cycle = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._period, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._initialize();
    }

    stop() {
        if (!this._active)
            return;
        this._active = false;
        for (const [s, id] of this._signals) {
            s.disconnect(id);
            s.stop();
        }
        this._signals = [];
        this._stateEnd?.();
        this._recreatedEnd?.();
        this._stateEnd = this._recreatedEnd = null;
        this._channelEnd?.();
        this._channelEnd = this._channelWebhook = null;
        for (const id of [this._batchTimer, this._cycle].filter(x => x))
            GLib.source_remove(id);
        this._batchTimer = this._cycle = 0;
    }

    // Every sensor definition, the last-contact sensor included (also used to map unique ids to entity ids).
    definitions() {
        return [...this._sources.flatMap(s => s.definitions()), contactSensor()];
    }

    _values() {
        const v = Object.assign({}, ...this._sources.map(s => s.values()));
        v[CONTACT_ID] = {state: this._now()};
        return v;
    }

    // Start (or resume after a failure): registration, full declaration, full send, push channel.
    _initialize() {
        if (this._init || this._ready)
            return this._init;
        this._init = (async () => {
            try {
                await Promise.all(this._starts);
                await this._ma.start();
                // Recreated during the declaration: everything is declared again on the new device.
                do {
                    this._redeclare = false;
                    if (!this._active)
                        return;
                    await this._declare();
                } while (this._redeclare);
                if (!this._active)
                    return;
                this._ready = true;
                this._subscribeChannel();
                this._send();
                this._onReady();
            } catch (e) {
                this._log(`[home-assistant] companion: ${e.message}`);
            } finally {
                this._init = null;
            }
        })();
        return this._init;
    }

    // register_sensor definition carrying the current value (v may be absent: null state).
    _definition(d, v) {
        return {...d, ...v, icon: v?.icon ?? d.icon, state: v?.state ?? null};
    }

    async _declare() {
        const values = this._values();
        const defs = this.definitions().map(d => this._definition(d, values[d.unique_id]));
        this._types = new Map(defs.map(d => [d.unique_id, d.type]));
        await this._ma.registerSensors(defs);
        this._sent.clear();
        this._rejected.clear();
        for (const [uid, v] of Object.entries(values))
            this._toSend.set(uid, v);
    }

    _recreated() {
        if (!this._active)
            return;
        this._ready = false;
        this._redeclare = true;
        this._channelEnd?.();
        this._channelEnd = this._channelWebhook = null;
        this._initialize();
    }

    _collect(source) {
        for (const [uid, v] of Object.entries(source.values())) {
            // During a send, _sent is not up to date yet: any change stays queued. A value HA already refused is not
            // sent again as is: only when it changes, or after a new declaration.
            const json = JSON.stringify(v);
            if (!this._sending && (json === this._sent.get(uid) || json === this._rejected.get(uid)))
                this._toSend.delete(uid);
            else
                this._toSend.set(uid, v);
        }
        this._scheduleSend();
    }

    _scheduleSend() {
        if (this._batchTimer || !this._toSend.size)
            return;
        this._batchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._batchMs, () => {
            this._batchTimer = 0;
            this._send();
            return GLib.SOURCE_REMOVE;
        });
    }

    _tick() {
        if (!this._ready) {
            // Token refused at registration: no new attempt (already logged, the client warns the user). New settings
            // create a new companion.
            if (!this._ma.tokenRejected)
                this._initialize();
            return;
        }
        // Push channel refused (HA restarted: WebSocket opened before mobile_app was loaded): tried again on every
        // cycle until it is open. No effect when the channel is open or being subscribed.
        this._subscribeChannel();
        this._toSend.set(CONTACT_ID, {state: this._now()});
        this._send();
    }

    async _send() {
        if (!this._ready || this._sending || !this._toSend.size)
            return;
        // A value without a declared definition: HA cannot take it, keeping it would resend forever.
        for (const uid of [...this._toSend.keys()].filter(u => !this._types.has(u))) {
            this._log(`[home-assistant] sensor ${uid} not declared: value dropped`);
            this._toSend.delete(uid);
        }
        if (!this._toSend.size)
            return;
        this._sending = true;
        const batch = [...this._toSend];
        let succeeded = false;
        try {
            const answer = await this._ma.updateSensors(batch.map(([uid, v]) => ({
                unique_id: uid, type: this._types.get(uid), state: v.state,
                ...v.attributes ? {attributes: v.attributes} : {}, ...v.icon ? {icon: v.icon} : {},
            })));
            // Stopped, or device recreated during the send: the new declaration sends everything again.
            if (!this._active || !this._ready)
                return;
            const unknown = [];
            for (const [uid, v] of batch) {
                const error = answer?.[uid]?.success === false ? answer[uid].error ?? {} : null;
                if (error?.code === 'not_registered') {
                    // Sensor deleted in HA while the device exists: declared again below, with its value.
                    unknown.push([uid, v]);
                } else if (error) {
                    // Final refusal of this value: out of the queue, sent again only if it changes.
                    this._log(`[home-assistant] sensor ${uid} rejected: ${error.message ?? error.code ?? '?'}`);
                    this._rejected.set(uid, JSON.stringify(v));
                    this._dequeue(uid, v);
                } else {
                    this._rejected.delete(uid);
                    this._sent.set(uid, JSON.stringify(v));
                    this._dequeue(uid, v);
                }
            }
            if (unknown.length) {
                const defs = new Map(this.definitions().map(d => [d.unique_id, d]));
                // register_sensor carries the state: HA receives the value with the declaration.
                await this._ma.registerSensors(unknown.map(([uid, v]) => this._definition(defs.get(uid), v)));
                if (!this._active || !this._ready)
                    return;
                for (const [uid, v] of unknown) {
                    this._rejected.delete(uid);
                    this._sent.set(uid, JSON.stringify(v));
                    this._dequeue(uid, v);
                }
            }
            succeeded = true;
        } catch (e) {
            this._log(`[home-assistant] sending sensors: ${e.message}`);
        } finally {
            this._sending = false;
        }
        // Changes that arrived during the send (the batch timer may have fired meanwhile): sent within the second.
        // After a failure, no immediate retry: next change or next 60 s cycle.
        if (succeeded && this._active)
            this._scheduleSend();
    }

    // Removes uid from the queue unless a different value arrived during the send.
    _dequeue(uid, v) {
        const next = this._toSend.get(uid);
        if (next === v || JSON.stringify(next) === JSON.stringify(v))
            this._toSend.delete(uid);
    }

    async _subscribeChannel() {
        const webhook = this._ma.webhookId;
        if (!this._active || !this._ready || this._client.state !== 'connected' || this._channelWebhook === webhook)
            return;
        this._channelWebhook = webhook;
        try {
            const end = await this._client.subscribe(
                {type: 'mobile_app/push_notification_channel', webhook_id: webhook, support_confirm: true},
                ev => this._receive(ev, webhook));
            if (this._active && this._channelWebhook === webhook)
                this._channelEnd = end;
            else
                end();
        } catch (e) {
            if (this._channelWebhook === webhook)
                this._channelWebhook = null;
            this._log(`[home-assistant] push channel: ${e.message}`);
        }
    }

    async _receive(ev, webhook) {
        if (!this._active)
            return;
        if (ev?.hass_confirm_id) {
            this._client.call({type: 'mobile_app/push_notification_confirm', webhook_id: webhook,
                confirm_id: ev.hass_confirm_id}).catch(e => this._log(`[home-assistant] push confirmation: ${e.message}`));
        }
        const cmd = parseCommand(ev?.message, ev?.data, this._isLocked());
        if (cmd === null) {
            const model = toModel(ev?.message, ev?.title, ev?.data, _('Home Assistant'));
            if (model.type !== 'ignore')
                this._display(model);
            return;
        }
        const command = cmd.name ?? ev.message.slice(COMMAND_PREFIX.length);
        let result = 'ok';
        let detail = '';
        if (cmd.error || cmd.refused) {
            result = cmd.error ? 'error' : 'refused';
            detail = cmd.error ?? cmd.refused;
        } else {
            try {
                await this._execute(cmd);
            } catch (e) {
                result = 'error';
                detail = e.message;
            }
        }
        if (result !== 'ok')
            this._log(`[home-assistant] command ${command}: ${result} (${detail})`);
        this._ma.fireEvent(COMMAND_EVENT, {command, result, detail})
            .catch(e => this._log(`[home-assistant] ${COMMAND_EVENT} event: ${e.message}`));
    }
}
