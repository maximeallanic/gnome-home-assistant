// Wires the companion together for the extension: mobile_app device, sensor sources, commands, notifications, and the
// `companion-snapshot` key the preferences read to generate the Home Assistant package.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MobileApp} from './mobile-app.js';
import {REGISTRATION_PATH} from './registration.js';
import {Companion} from './companion.js';
import {NotificationDisplay} from './notifications.js';
import {createExecutor} from './actions.js';
import {slugify} from './ha-package.js';
import {PresenceSource} from '../sensors/presence.js';
import {DesktopSource} from '../sensors/desktop.js';
import {SystemSource} from '../sensors/system.js';
import {_, C_} from '../i18n.js';

function readText(path) {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]).trim();
    } catch (_e) {
        return '';
    }
}

// What the mobile_app registration says about this computer (shown on the device page in Home Assistant).
function deviceInfo(name, version) {
    const os = readText('/etc/os-release');
    const field = key => new RegExp(`^${key}="?([^"\n]*)"?$`, 'm').exec(os)?.[1] ?? '';
    return {
        name,
        app_version: String(version ?? '1'),
        manufacturer: readText('/sys/class/dmi/id/sys_vendor') || C_('device manufacturer', 'unknown'),
        model: readText('/sys/class/dmi/id/product_name') || C_('device model', 'unknown'),
        os_name: field('NAME') || 'Linux',
        os_version: field('VERSION_ID') || field('VERSION_CODENAME') || C_('OS version', 'unknown'),
    };
}

// The device name chosen in the preferences, else the computer's host name.
export function deviceName(settings) {
    return settings.get_string('device-name').trim() || GLib.get_host_name();
}

export class CompanionController {
    constructor({settings, client, url, token, extension}) {
        this._settings = settings;
        this._client = client;
        this._name = deviceName(settings);
        this._mobileApp = new MobileApp({url, token, path: REGISTRATION_PATH,
            device: deviceInfo(this._name, extension.metadata['version-name'] ?? extension.metadata.version),
            checkDeleted: id => this._deviceDeleted(id)});
        let recreatedShown = false;
        this._mobileApp.onRecreated(() => {
            if (!recreatedShown) {
                recreatedShown = true;
                Main.notify(_('Home Assistant'), _('This computer was registered again in Home Assistant'));
            }
        });
        const desktop = new DesktopSource();
        this._display = new NotificationDisplay({
            fireEvent: (type, data) => this._mobileApp.fireEvent(type, data),
            icon: new Gio.ThemedIcon({name: 'go-home-symbolic'}),
        });
        this._companion = new Companion({
            mobileApp: this._mobileApp,
            client,
            sources: [new PresenceSource(), desktop, new SystemSource()],
            execute: createExecutor(desktop),
            display: m => (m.type === 'clear' ? this._display.clear(m.tag) : this._display.show(m)),
            isLocked: () => Main.sessionMode.isLocked,
            onReady: () => this._publish(),
        });
        // The entity ids are read over the WebSocket: published again whenever it (re)connects.
        this._stateEnd = client.onState(state => {
            if (state === 'connected')
                this._publish();
        });
    }

    start() {
        this._companion.start();
    }

    stop() {
        this._stateEnd?.();
        this._stateEnd = null;
        this._companion.stop();
        this._mobileApp.destroy();
        this._display.destroy();
        this._stopped = true;
    }

    // Unknown webhook: is the device really gone from HA? Only if HA is RUNNING and no device carries the mobile_app
    // identifier of our device_id (otherwise: HA starting, config entry disabled...).
    async _deviceDeleted(deviceId) {
        if (this._client.state !== 'connected')
            return false;
        const config = await this._client.call({type: 'get_config'});
        if (config?.state !== 'RUNNING')
            return false;
        const devices = await this._client.call({type: 'config/device_registry/list'});
        return !devices.some(d => d.identifiers?.some(([domain, id]) => domain === 'mobile_app' && id === deviceId));
    }

    // Entity id of every sensor of this device, and the notify service that reaches it, for the preferences.
    async _publish() {
        const deviceId = this._mobileApp.deviceId;
        const webhook = this._mobileApp.webhookId;
        if (!deviceId || this._client.state !== 'connected')
            return;
        try {
            const [devices, entries, services] = await Promise.all([
                this._client.call({type: 'config/device_registry/list'}),
                this._client.call({type: 'config/entity_registry/list'}),
                this._client.call({type: 'get_services'}),
            ]);
            if (this._stopped)
                return;
            const device = devices.find(d => d.identifiers?.some(([domain, id]) => domain === 'mobile_app' &&
                id === deviceId));
            const entities = {};
            for (const def of this._companion.definitions()) {
                const entry = entries.find(x => x.device_id === device?.id && x.platform === 'mobile_app' &&
                    (x.unique_id === `${webhook}_${def.unique_id}` || x.unique_id === def.unique_id));
                if (entry)
                    entities[def.unique_id] = entry.entity_id;
            }
            const candidate = `mobile_app_${slugify(this._name)}`;
            const notifyVerified = Object.hasOwn(services?.notify ?? {}, candidate);
            const snapshot = JSON.stringify({deviceName: this._name, notifyService: candidate, notifyVerified,
                entities});
            if (snapshot !== this._settings.get_string('companion-snapshot'))
                this._settings.set_string('companion-snapshot', snapshot);
        } catch (e) {
            console.warn(`[home-assistant] reading the companion entity ids: ${e.message}`);
        }
    }
}
