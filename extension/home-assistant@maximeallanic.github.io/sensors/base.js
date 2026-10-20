// Base of the sensor sources (the Source interface of companion.js): definitions, values, "changed" signal.
// Subclasses implement start() (may be async) and stop().
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

export const SensorSource = GObject.registerClass({
    Signals: {changed: {}},
}, class SensorSource extends GObject.Object {
    _init() {
        super._init();
        this._values = {};
        this._defs = [];
    }

    definitions() {
        return this._defs;
    }

    values() {
        return this._values;
    }

    // Declares a sensor; `missing`: a dependency is absent -> not declared, with a warning.
    _declare(def, missing = null) {
        if (missing) {
            console.warn(`[home-assistant] sensor ${def.unique_id} not declared: ${missing}`);
            return false;
        }
        this._defs.push(def);
        return true;
    }

    // Updates several values; emits "changed" when one of them changed.
    _set(values) {
        let changed = false;
        for (const [uid, v] of Object.entries(values)) {
            if (!this._defs.some(d => d.unique_id === uid))
                continue;
            if (JSON.stringify(this._values[uid]) !== JSON.stringify(v)) {
                this._values = {...this._values, [uid]: v};
                changed = true;
            }
        }
        if (changed)
            this.emit('changed');
    }
});

// unique_id is part of the protocol (stable, English); name is what HA shows (translated).
export function sensor(id, type, name, icon, extra = {}) {
    return {unique_id: id, type, name, icon, ...extra};
}

// UPower system D-Bus proxy, without blocking the Shell's main loop; null when unavailable.
export function upowerProxy(path, iface) {
    return new Promise(resolve => {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            'org.freedesktop.UPower', path, iface, null, (_o, res) => {
                try {
                    resolve(Gio.DBusProxy.new_for_bus_finish(res));
                } catch (e) {
                    console.warn(`[home-assistant] UPower unavailable (${path}): ${e.message}`);
                    resolve(null);
                }
            });
    });
}

// Asynchronous D-Bus call; unpacked values, or null on failure.
export function callProxy(proxy, method, timeout = 1000) {
    return new Promise(resolve => {
        proxy.call(method, null, Gio.DBusCallFlags.NONE, timeout, null, (p, res) => {
            try {
                resolve(p.call_finish(res).deepUnpack());
            } catch (_e) {
                resolve(null);
            }
        });
    });
}
