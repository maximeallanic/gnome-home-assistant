// Home Assistant mobile_app integration: device registration and HTTP webhook.
// Webhook unknown to HA (410, or 2xx with an empty body as of HA 2026.9): a new registration, then the request is
// replayed, but only if the device is really gone (410, or `checkDeleted` confirms it). An empty body also arrives
// while HA restarts or when the config entry is disabled: then it is a passing error. The old file stays until the new
// registration succeeds.
// Token refused at registration (401, or 403 when HA banned the address): no more attempt with this token. Each attempt
// would count as a failed login in HA (notification, IP ban); new settings create a new instance.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {readRegistration, writeRegistration} from './registration.js';

export const APP_ID = 'io.github.maximeallanic.GnomeHomeAssistant';
export const APP_NAME = 'Hearth for Home Assistant';

export class MobileApp {
    // device: {name, app_version, manufacturer, model, os_name, os_version}.
    // checkDeleted: async (device_id) => true when HA is running and no longer knows the device.
    constructor({url, token, path, device, checkDeleted = null, session = new Soup.Session({timeout: 15})}) {
        this._base = url.replace(/\/+$/, '');
        this._url = url;
        this._token = token;
        this._path = path;
        this._device = device;
        this._checkDeleted = checkDeleted;
        this._session = session;
        this._cancellable = new Gio.Cancellable();
        this._registration = null;
        this._recreating = null;
        this._recreatedListeners = new Set();
        this._tokenRejected = false;
    }

    get webhookId() {
        return this._registration?.webhook_id ?? null;
    }

    get deviceId() {
        return this._registration?.device_id ?? null;
    }

    get tokenRejected() {
        return this._tokenRejected;
    }

    onRecreated(fn) {
        this._recreatedListeners.add(fn);
        return () => this._recreatedListeners.delete(fn);
    }

    async start() {
        this._registration = readRegistration(this._path, this._url);
        if (this._registration)
            return;
        if (GLib.file_test(this._path, GLib.FileTest.EXISTS))
            console.warn('[home-assistant] no usable mobile_app registration for this URL: registering a new device');
        await this._register();
    }

    async registerSensors(definitions) {
        for (const d of definitions)
            await this._webhook('register_sensor', d);
    }

    updateSensors(states) {
        return this._webhook('update_sensor_states', states);
    }

    fireEvent(type, data) {
        return this._webhook('fire_event', {event_type: type, event_data: data});
    }

    destroy() {
        this._cancellable.cancel();
        this._recreatedListeners.clear();
    }

    async _register() {
        if (this._tokenRejected)
            throw new Error('mobile_app registration: token already rejected by Home Assistant');
        const deviceId = GLib.uuid_string_random();
        const {status, body} = await this._http('/api/mobile_app/registrations', {
            device_id: deviceId,
            app_id: APP_ID,
            app_name: APP_NAME,
            app_version: this._device.app_version,
            device_name: this._device.name,
            manufacturer: this._device.manufacturer,
            model: this._device.model,
            os_name: this._device.os_name,
            os_version: this._device.os_version,
            supports_encryption: false,
            app_data: {push_websocket_channel: true},
        }, true);
        if (status === 401 || status === 403) {
            this._tokenRejected = true;
            throw new Error(`mobile_app registration rejected: HTTP ${status} (token rejected, no more attempts)`);
        }
        let webhook = null;
        try {
            webhook = JSON.parse(body).webhook_id;
        } catch (_e) {
            // Not JSON: handled below as a rejected registration.
        }
        if (status < 200 || status >= 300 || typeof webhook !== 'string' || !webhook)
            throw new Error(`mobile_app registration rejected: HTTP ${status}`);
        this._registration = {url: this._url, device_id: deviceId, webhook_id: webhook};
        writeRegistration(this._path, this._registration);
    }

    async _webhook(type, data) {
        for (let attempt = 0; ; attempt++) {
            if (this._recreating)
                await this._recreating;
            const id = this.webhookId;
            if (!id)
                throw new Error('mobile_app device not registered');
            const {status, body} = await this._http(`/api/webhook/${id}`, {type, data}, false);
            const unknown = status === 410 || (status >= 200 && status < 300 && body.trim() === '');
            if (unknown) {
                if (attempt === 0 && await this._deleted(status)) {
                    await this._recreate(id);
                    continue;
                }
                throw new Error(`webhook ${type}: device unknown to Home Assistant (HTTP ${status})`);
            }
            if (status < 200 || status >= 300)
                throw new Error(`webhook ${type}: HTTP ${status}`);
            return JSON.parse(body);
        }
    }

    async _deleted(status) {
        if (status === 410)
            return true;
        try {
            return (await this._checkDeleted?.(this._registration.device_id)) === true;
        } catch (e) {
            console.warn(`[home-assistant] device check: ${e.message}`);
            return false;
        }
    }

    // One recreation even when several requests in flight see the deletion. On failure the old registration stays:
    // the next request tries again.
    _recreate(old) {
        if (this._recreating)
            return this._recreating;
        if (this.webhookId !== old)
            return Promise.resolve();
        this._recreating = (async () => {
            console.warn('[home-assistant] device deleted in Home Assistant: registering again');
            await this._register();
            for (const fn of [...this._recreatedListeners])
                fn();
        })().finally(() => (this._recreating = null));
        return this._recreating;
    }

    _http(path, body, auth) {
        const msg = Soup.Message.new('POST', this._base + path);
        if (auth)
            msg.get_request_headers().append('Authorization', `Bearer ${this._token}`);
        msg.set_request_body_from_bytes('application/json',
            new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    resolve({status: msg.get_status(), body: new TextDecoder().decode(bytes.toArray())});
                } catch (e) {
                    reject(new Error(`Home Assistant unreachable: ${e.message}`));
                }
            });
        });
    }
}
