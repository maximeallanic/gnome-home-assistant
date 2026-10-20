// Generic Home Assistant WebSocket client: authentication, calls, subscriptions, progressive reconnection.
// Nothing about chips or tiles here. Subscriptions are not replayed: a consumer subscribes again when the state goes
// back to 'connected'.
// States: 'stopped', 'connecting', 'connected', 'disconnected' (a reconnection is scheduled), 'rejected' (token refused:
// no retry until reconfigure()).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {_} from './i18n.js';

const MAX_DELAY = 60;

export function nextDelay(seconds) {
    return Math.min(seconds * 2, MAX_DELAY);
}

export function websocketUrl(url) {
    return `${url.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/websocket`;
}

export class HaClient {
    // authTimeout: seconds left to HA to answer the authentication before the connection is dropped.
    constructor({url, token, network = Gio.NetworkMonitor.get_default(), initialDelay = 1, authTimeout = 15}) {
        this._url = url;
        this._token = token;
        this._network = network;
        this._initialDelay = initialDelay;
        this._delay = initialDelay;
        this._authTimeout = authTimeout;
        this._authTimer = 0;
        this._session = new Soup.Session({timeout: 20});
        this._conn = null;
        this._cancellable = null;
        this._retryTimer = 0;
        this._networkId = 0;
        this._nextId = 1;
        this._pending = new Map();
        this._subscriptions = new Map();
        this._listeners = new Set();
        this.state = 'stopped';
    }

    onState(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    start() {
        if (this.state !== 'stopped')
            return;
        this._networkId = this._network.connect('network-changed', (_m, available) => {
            if (!available)
                return;
            if (this.state === 'disconnected') {
                this._cancelRetry();
                this._connect();
            } else if (this.state === 'connected') {
                // Wi-Fi changed, NAT lost, resume: the socket may look open but be dead.
                this._close();
                this._setState('disconnected');
                this._connect();
            }
        });
        this._connect();
    }

    stop() {
        this._cancelRetry();
        if (this._networkId) {
            this._network.disconnect(this._networkId);
            this._networkId = 0;
        }
        this._stopping = true;
        this._close();
        this._stopping = false;
        this._setState('stopped');
    }

    reconfigure({url, token}) {
        this.stop();
        this._url = url;
        this._token = token;
        this._delay = this._initialDelay;
        this.start();
    }

    call(msg) {
        if (this.state !== 'connected')
            return Promise.reject(new Error(_('Home Assistant not connected')));
        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            this._pending.set(id, {resolve, reject});
            this._send({...msg, id});
        });
    }

    async subscribe(msg, fn) {
        if (this.state !== 'connected')
            throw new Error(_('Home Assistant not connected'));
        const id = this._nextId;
        this._subscriptions.set(id, fn);
        try {
            await this.call(msg);
        } catch (e) {
            this._subscriptions.delete(id);
            throw e;
        }
        return async () => {
            if (!this._subscriptions.delete(id) || this.state !== 'connected')
                return;
            await this.call({type: 'unsubscribe_events', subscription: id}).catch(e => {
                if (this.state === 'connected')  // otherwise the connection was closed on purpose (stop)
                    console.warn(`[home-assistant] unsubscribing ${id}: ${e.message}`);
            });
        };
    }

    _setState(state) {
        if (state === this.state)
            return;
        this.state = state;
        for (const fn of [...this._listeners])
            fn(state);
    }

    _connect() {
        this._setState('connecting');
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        const msg = Soup.Message.new('GET', websocketUrl(this._url));
        this._session.websocket_connect_async(msg, null, null, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            if (cancellable.is_cancelled())
                return;
            let conn;
            try {
                conn = s.websocket_connect_finish(res);
            } catch (e) {
                console.warn(`[home-assistant] cannot connect to Home Assistant: ${e.message}`);
                this._lost();
                return;
            }
            this._conn = conn;
            conn.max_incoming_payload_size = 64 * 1024 * 1024;  // HA registries go well past the 128 KiB default
            conn.keepalive_interval = 30;
            conn.keepalive_pong_timeout = 10;  // no pong -> "closed": a silently dead socket is detected
            // A dropped connection (reconfiguration, network change) may still deliver a message: ignored.
            conn.connect('message', (_c, _type, bytes) => {
                if (this._conn === conn)
                    this._receive(bytes);
            });
            this._authTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._authTimeout * 1000, () => {
                this._authTimer = 0;
                if (this._conn === conn && this.state === 'connecting') {
                    console.warn('[home-assistant] Home Assistant does not answer the authentication');
                    this._close();
                    this._lost();
                }
                return GLib.SOURCE_REMOVE;
            });
            conn.connect('closed', () => {
                if (this._conn === conn) {
                    this._conn = null;
                    this._lost();
                }
            });
        });
    }

    _receive(bytes) {
        let msg;
        try {
            msg = JSON.parse(new TextDecoder().decode(bytes.toArray()));
        } catch (e) {
            console.warn(`[home-assistant] unreadable Home Assistant message: ${e.message}`);
            return;
        }
        switch (msg.type) {
        case 'auth_required':
            this._send({type: 'auth', access_token: this._token});
            break;
        case 'auth_ok':
            this._cancelAuthTimer();
            this._delay = this._initialDelay;
            this._setState('connected');
            break;
        case 'auth_invalid':
            console.warn('[home-assistant] Home Assistant rejected the access token');
            this._cancelRetry();
            this._close();
            this._setState('rejected');
            break;
        case 'result': {
            const pending = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            if (!pending)
                break;
            if (msg.success)
                pending.resolve(msg.result);
            else
                pending.reject(new Error(msg.error?.message ?? _('Home Assistant error')));
            break;
        }
        case 'event':
            this._subscriptions.get(msg.id)?.(msg.event);
            break;
        }
    }

    _send(o) {
        this._conn?.send_text(JSON.stringify(o));
    }

    // Connection lost or impossible: purge and schedule a new attempt (unless stopped or the token was refused).
    _lost() {
        this._purge();
        if (this.state === 'stopped' || this.state === 'rejected')
            return;
        this._setState('disconnected');
        this._cancelRetry();
        const delay = this._delay;
        this._delay = nextDelay(this._delay);
        this._retryTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._retryTimer = 0;
            this._connect();
            return GLib.SOURCE_REMOVE;
        });
    }

    _close() {
        this._cancelAuthTimer();
        this._cancellable?.cancel();
        this._cancellable = null;
        const conn = this._conn;
        this._conn = null;
        if (conn && conn.get_state() === Soup.WebsocketState.OPEN)
            conn.close(Soup.WebsocketCloseCode.NORMAL, null);
        this._purge();
    }

    _purge() {
        for (const {reject} of this._pending.values()) {
            // stopping: closed on purpose (extension disabled), the caller has nothing to tell the user.
            reject(Object.assign(new Error(_('Home Assistant connection lost')), {stopping: Boolean(this._stopping)}));
        }
        this._pending.clear();
        this._subscriptions.clear();
    }

    _cancelAuthTimer() {
        if (this._authTimer) {
            GLib.source_remove(this._authTimer);
            this._authTimer = 0;
        }
    }

    _cancelRetry() {
        if (this._retryTimer) {
            GLib.source_remove(this._retryTimer);
            this._retryTimer = 0;
        }
    }
}
