// Presence and activity: lock, activity, screen on, fullscreen, focused app, displays.
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SensorSource, sensor} from './base.js';
import {_} from '../i18n.js';

const IDLE_MS = 5 * 60 * 1000;
const POWER_SAVE_ON = 0;

export const PresenceSource = GObject.registerClass(
class PresenceSource extends SensorSource {
    start() {
        this._stopped = false;
        this._declare(sensor('locked', 'binary_sensor', _('Locked'), 'mdi:lock'));
        this._declare(sensor('active', 'binary_sensor', _('Active'), 'mdi:account', {device_class: 'occupancy'}));
        this._declare(sensor('screen_on', 'binary_sensor', _('Screen on'), 'mdi:monitor', {device_class: 'power'}));
        this._declare(sensor('fullscreen', 'binary_sensor', _('Fullscreen'), 'mdi:fullscreen'));
        this._declare(sensor('active_app', 'sensor', _('Active app'), 'mdi:application'));
        this._declare(sensor('displays', 'sensor', _('Displays'), 'mdi:monitor-multiple', {state_class: 'measurement'}));

        Main.sessionMode.connectObject('updated', () => this._lock(), this);
        this._monitor = global.backend.get_core_idle_monitor();
        this._idleId = this._monitor.add_idle_watch(IDLE_MS, () => this._activity(false));
        this._backId = 0;
        global.display.connectObject('in-fullscreen-changed', () => this._fullscreen(), this);
        Shell.WindowTracker.get_default().connectObject('notify::focus-app', () => this._app(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._displays(), this);

        // Display power saving: a D-Bus property of mutter (not exposed to GJS).
        this._displayConfig = null;
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig', 'org.gnome.Mutter.DisplayConfig',
            null, (_o, res) => {
                try {
                    this._displayConfig = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    console.warn(`[home-assistant] DisplayConfig unavailable: ${e.message}`);
                    return;
                }
                if (this._stopped)
                    return;
                this._displayConfig.connectObject('g-properties-changed', () => this._screenOn(), this);
                this._screenOn();
            });

        this._lock();
        this._activity(this._monitor.get_idletime() < IDLE_MS);
        this._fullscreen();
        this._app();
        this._displays();
    }

    stop() {
        this._stopped = true;
        Main.sessionMode.disconnectObject(this);
        global.display.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._displayConfig?.disconnectObject(this);
        for (const id of [this._idleId, this._backId].filter(x => x))
            this._monitor.remove_watch(id);
        this._idleId = this._backId = 0;
    }

    _lock() {
        const locked = Main.sessionMode.isLocked;
        this._set({locked: {state: locked, icon: locked ? 'mdi:lock' : 'mdi:lock-open-variant'}});
    }

    _activity(active) {
        if (!active && !this._backId && !this._stopped) {
            this._backId = this._monitor.add_user_active_watch(() => {
                this._backId = 0;
                this._activity(true);
            });
        }
        this._set({active: {state: active}});
    }

    _screenOn() {
        const mode = this._displayConfig?.get_cached_property('PowerSaveMode')?.unpack();
        if (mode !== undefined)
            this._set({screen_on: {state: mode === POWER_SAVE_ON}});
    }

    _fullscreen() {
        let full = false;
        for (let i = 0; i < global.display.get_n_monitors(); i++)
            full ||= global.display.get_monitor_in_fullscreen(i);
        this._set({fullscreen: {state: full}});
    }

    // No focused app: null, which HA shows as "unknown" (a state word would be one language only).
    _app() {
        const app = Shell.WindowTracker.get_default().focus_app;
        this._set({active_app: {state: app?.get_name() ?? null}});
    }

    _displays() {
        const manager = global.backend.get_monitor_manager();
        const monitors = manager.get_monitors().filter(m => m.is_active())
            .map(m => `${m.get_display_name()} (${m.get_connector()})`);
        const layout = Main.layoutManager.monitors
            .map(m => `${m.width}x${m.height}+${m.x}+${m.y}${m.geometry_scale !== 1 ? ` @${m.geometry_scale}` : ''}`);
        this._set({displays: {state: Main.layoutManager.monitors.length, attributes: {monitors, layout}}});
    }
});
