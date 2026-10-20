// Runs the commands validated by commands.js. Throws Error(detail) on failure; the companion reports it as an "error"
// result of the gnome_home_assistant_command event. Never a shell command line.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {_, format} from '../i18n.js';

const POWER_SAVE = {on: 0, off: 3};

function resolveToggle(state, current) {
    return state === 'toggle' ? !current : state === 'on';
}

function dbusCall(bus, name, path, iface, method, params) {
    return new Promise((resolve, reject) => {
        bus.call(name, path, iface, method, params, null, Gio.DBusCallFlags.NONE, 2000, null, (b, res) => {
            try {
                resolve(b.call_finish(res));
            } catch (e) {
                reject(new Error(e.message));
            }
        });
    });
}

// desktop: a started DesktopSource (mixer, keyboard, notifications, caffeine, interfaceSettings, player()).
export function createExecutor(desktop) {
    const output = () => {
        const s = desktop.mixer.get_default_sink();
        if (!s)
            throw new Error(_('no audio output'));
        return s;
    };
    const volumeOf = s => Math.round(100 * s.volume / desktop.mixer.get_vol_max_norm());
    const setVolume = level => {
        const s = output();
        s.volume = Math.max(0, Math.min(100, level)) / 100 * desktop.mixer.get_vol_max_norm();
        s.push_volume();
        if (level > 0 && s.is_muted)
            s.change_is_muted(false);
    };

    const ACTIONS = {
        volume: ({level}) => setVolume(level),
        volume_up: ({step}) => setVolume(volumeOf(output()) + step),
        volume_down: ({step}) => setVolume(volumeOf(output()) - step),
        mute: ({state}) => {
            const s = output();
            s.change_is_muted(resolveToggle(state, s.is_muted));
        },
        brightness: ({level}) => {
            const scale = Main.brightnessManager?.globalScale;
            if (!scale)
                throw new Error(_('global brightness unavailable'));
            scale.value = level / 100;
        },
        keyboard_backlight: async ({level}) => {
            if (!desktop.keyboard)
                throw new Error(_('no keyboard backlight'));
            await dbusCall(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower/KbdBacklight',
                'org.freedesktop.UPower.KbdBacklight', 'SetBrightness',
                new GLib.Variant('(i)', [Math.round(level * desktop.keyboardMax / 100)]));
        },
        do_not_disturb: ({state}) => {
            const n = desktop.notifications;
            n.set_boolean('show-banners', !resolveToggle(state, !n.get_boolean('show-banners')));
        },
        caffeine: ({state}) => {
            const c = desktop.caffeine;
            if (!c)
                throw new Error(_('Caffeine extension not installed'));
            c.set_boolean('cli-toggle', resolveToggle(state, c.get_boolean('cli-toggle')));
        },
        theme: ({theme}) => desktop.interfaceSettings.set_string('color-scheme',
            theme === 'dark' ? 'prefer-dark' : 'default'),
        screen: async ({state}) => {
            await dbusCall(Gio.DBus.session, 'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
                'org.freedesktop.DBus.Properties', 'Set', new GLib.Variant('(ssv)',
                    ['org.gnome.Mutter.DisplayConfig', 'PowerSaveMode', new GLib.Variant('i', POWER_SAVE[state])]));
        },
        lock: () => {
            if (!Main.screenShield)
                throw new Error(_('screen lock unavailable'));
            Main.screenShield.lock(true);
        },
        media: ({action}) => {
            const p = desktop.player();
            if (!p)
                throw new Error(_('no media player'));
            ({play_pause: () => p.playPause(), next: () => p.next(), previous: () => p.previous()})[action]();
        },
        open_url: ({url}) => Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1)),
        launch_app: ({app}) => {
            const info = Gio.DesktopAppInfo.new(app);
            if (!info)
                throw new Error(format(_('unknown app: %s'), app));
            info.launch([], global.create_app_launch_context(0, -1));
        },
    };

    return async ({name, params}) => {
        const action = ACTIONS[name];
        if (!action)
            throw new Error(format(_('unhandled command: %s'), name));
        await action(params);
    };
}
