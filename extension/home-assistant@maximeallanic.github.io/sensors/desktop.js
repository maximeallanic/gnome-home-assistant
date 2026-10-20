// Desktop settings read as sensors: volume, mute, global brightness, keyboard backlight, Do Not Disturb, Caffeine,
// colour scheme, media. The same objects let actions.js drive them (desktop.mixer, .keyboard, .player()...).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {SensorSource, sensor, upowerProxy, callProxy} from './base.js';
import {_} from '../i18n.js';

const CAFFEINE_SCHEMA = 'org.gnome.shell.extensions.caffeine';
const CAFFEINE_DIRS = [
    GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'caffeine@patapon.info', 'schemas']),
    '/usr/share/gnome-shell/extensions/caffeine@patapon.info/schemas',
];
const MEDIA_STATES = {Playing: 'playing', Paused: 'paused'};
const MEDIA_ICONS = {playing: 'mdi:play', paused: 'mdi:pause', stopped: 'mdi:stop'};

// Mpris.MprisSource has no destroy() in the Shell: one instance for the Shell's lifetime (the module stays cached
// between disable and enable), otherwise its D-Bus proxies pile up.
let sharedMpris = null;
function mpris() {
    sharedMpris ??= new Mpris.MprisSource();
    return sharedMpris;
}

// Settings of the installed Caffeine extension (null when absent). cli-toggle follows the real state and drives it.
export function caffeineSettings() {
    for (const dir of CAFFEINE_DIRS) {
        if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
            continue;
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(dir,
                Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup(CAFFEINE_SCHEMA, false);
            if (schema)
                return new Gio.Settings({settings_schema: schema});
        } catch (e) {
            console.warn(`[home-assistant] unreadable Caffeine schema: ${e.message}`);
        }
    }
    return null;
}

export const DesktopSource = GObject.registerClass(
class DesktopSource extends SensorSource {
    // Asynchronous: the companion waits for the end (keyboard backlight through D-Bus) before declaring the sensors.
    async start() {
        this._stopped = false;
        this.mixer = Volume.getMixerControl();
        this._declare(sensor('volume', 'sensor', _('Volume'), 'mdi:volume-high',
            {unit_of_measurement: '%', state_class: 'measurement'}));
        this._declare(sensor('muted', 'binary_sensor', _('Muted'), 'mdi:volume-off'));
        this.mixer.connectObject('default-sink-changed', () => this._output(),
            'state-changed', () => this._output(), this);
        this._output();

        this._declare(sensor('brightness', 'sensor', _('Brightness'), 'mdi:brightness-6',
            {unit_of_measurement: '%', state_class: 'measurement'}),
        Main.brightnessManager?.globalScale ? null : 'no global brightness');
        Main.brightnessManager?.connectObject('changed', () => this._scaleChanged(), this);
        this._scaleChanged();

        this.notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._declare(sensor('do_not_disturb', 'binary_sensor', _('Do Not Disturb'), 'mdi:bell-off'));
        this.notifications.connectObject('changed::show-banners', () => this._dnd(), this);
        this._dnd();

        this.caffeine = caffeineSettings();
        if (this._declare(sensor('caffeine', 'binary_sensor', _('Caffeine'), 'mdi:coffee'),
            this.caffeine ? null : 'Caffeine extension not installed')) {
            this.caffeine.connectObject('changed::cli-toggle', () => this._caffeine(), this);
            this._caffeine();
        }

        this.interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._declare(sensor('theme', 'sensor', _('Theme'), 'mdi:theme-light-dark'));
        this.interfaceSettings.connectObject('changed::color-scheme', () => this._theme(), this);
        this._theme();

        this._declare(sensor('media', 'sensor', _('Media'), 'mdi:music'));
        this._mpris = mpris();
        this._players = new Set();
        this._mpris.connectObject('player-added', (_s, p) => this._track(p),
            'player-removed', (_s, p) => this._untrack(p), this);
        this._mpris.players.forEach(p => this._track(p));
        this._media();

        this.keyboard = null;
        this.keyboardMax = 0;
        const keyboard = await upowerProxy('/org/freedesktop/UPower/KbdBacklight',
            'org.freedesktop.UPower.KbdBacklight');
        const max = keyboard ? (await callProxy(keyboard, 'GetMaxBrightness'))?.[0] ?? 0 : 0;
        if (this._stopped)
            return;
        if (this._declare(sensor('keyboard_backlight', 'sensor', _('Keyboard backlight'), 'mdi:keyboard-outline',
            {unit_of_measurement: '%', state_class: 'measurement'}), max > 0 ? null : 'no UPower keyboard backlight')) {
            this.keyboard = keyboard;
            this.keyboardMax = max;
            keyboard.connectObject('g-signal', (_p, _s, signal, params) => {
                if (signal === 'BrightnessChanged' || signal === 'BrightnessChangedWithSource')
                    this._keyboard(params.deepUnpack()[0]);
            }, this);
            const level = (await callProxy(keyboard, 'GetBrightness'))?.[0];
            if (level !== undefined && !this._stopped)
                this._keyboard(level);
        }
    }

    stop() {
        this._stopped = true;
        for (const o of [this.mixer, this._stream, Main.brightnessManager, this._scale, this.keyboard,
            this.notifications, this.caffeine, this.interfaceSettings, this._mpris, ...this._players ?? []])
            o?.disconnectObject(this);
        this._players?.clear();
        this._stream = this._scale = null;
    }

    // MPRIS player to drive: the one playing, else the first paused, else the first.
    player() {
        const l = [...this._players];
        return l.find(p => p.status === 'Playing') ?? l.find(p => p.status === 'Paused') ?? l[0] ?? null;
    }

    _output() {
        this._stream?.disconnectObject(this);
        this._stream = this.mixer.get_default_sink();
        this._stream?.connectObject('notify::volume', () => this._volume(), 'notify::is-muted', () => this._volume(),
            this);
        this._volume();
    }

    _volume() {
        const s = this._stream;
        if (!s)
            return;
        this._set({
            volume: {state: Math.round(100 * s.volume / this.mixer.get_vol_max_norm())},
            muted: {state: s.is_muted, icon: s.is_muted ? 'mdi:volume-off' : 'mdi:volume-high'},
        });
    }

    _scaleChanged() {
        this._scale?.disconnectObject(this);
        this._scale = Main.brightnessManager?.globalScale ?? null;
        this._scale?.connectObject('notify::value', () => this._brightness(), this);
        this._brightness();
    }

    _brightness() {
        if (this._scale)
            this._set({brightness: {state: Math.round(100 * this._scale.value)}});
    }

    _keyboard(raw) {
        this._set({keyboard_backlight: {state: Math.round(100 * raw / this.keyboardMax)}});
    }

    _dnd() {
        const dnd = !this.notifications.get_boolean('show-banners');
        this._set({do_not_disturb: {state: dnd, icon: dnd ? 'mdi:bell-off' : 'mdi:bell'}});
    }

    _caffeine() {
        const on = this.caffeine.get_boolean('cli-toggle');
        this._set({caffeine: {state: on, icon: on ? 'mdi:coffee' : 'mdi:coffee-off'}});
    }

    _theme() {
        const dark = this.interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        this._set({theme: {state: dark ? 'dark' : 'light', icon: dark ? 'mdi:weather-night' : 'mdi:white-balance-sunny'}});
    }

    _track(p) {
        if (this._players.has(p))
            return;
        this._players.add(p);
        p.connectObject('changed', () => this._media(), this);
        this._media();
    }

    _untrack(p) {
        p.disconnectObject(this);
        this._players.delete(p);
        this._media();
    }

    _media() {
        const p = this.player();
        const state = MEDIA_STATES[p?.status] ?? 'stopped';
        this._set({media: {
            state,
            icon: MEDIA_ICONS[state],
            attributes: {title: p?.trackTitle ?? '', artist: (p?.trackArtists ?? []).join(', '),
                player: p?.app?.get_name() ?? ''},
        }});
    }
});
