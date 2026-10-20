// Home Assistant in GNOME Shell: entities carrying the top bar label become chips in the top bar, the entity carrying
// the grid label becomes a Quick Settings tile with a grid of mini-tiles, and, when the user opts in, the computer is
// registered as a Home Assistant mobile_app device (sensors, commands, notifications).
// Also active on the lock screen (the companion keeps reporting): chips and tile are hidden there.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {normalizeUrl, readLabels} from './config.js';
import {lookupToken, isCancelled} from './credentials.js';
import {HaClient} from './ha-client.js';
import {StateSource} from './state-source.js';
import {chips} from './chips.js';
import {Icons} from './icons.js';
import {HomeIndicator} from './indicator.js';
import {GridTile} from './grid-menu.js';
import {readGrid, gridSnapshot} from './grid.js';
import {Shortcuts} from './shortcuts.js';
import {CompanionController} from './companion/controller.js';
import {_} from './i18n.js';

const CONNECTION_KEYS = ['url', 'credentials-revision'];
const COMPANION_KEYS = ['companion-enabled', 'device-name'];
const LABEL_KEYS = ['topbar-label', 'alert-label', 'grid-label'];
const SETTLE_MS = 1000;  // settings written on every key press are applied once they settle

export default class HomeAssistantExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._labels = readLabels(this._settings);
        this._icons = new Icons({shippedDir: `${this.path}/icons`,
            downloads: () => this._settings.get_boolean('download-icons')});
        this._indicator = new HomeIndicator(this._icons);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._listeners = [];
        this._last = null;
        this._grid = null;
        this._gridModel = null;
        this._generation = 0;
        this._timers = new Map();
        Main.sessionMode.connectObject('updated', () => this._render(), this);
        this._settings.connectObject('changed', (_s, key) => this._settingChanged(key), this);
        this._startShortcuts();
        this._configure();
    }

    _settingChanged(key) {
        if (CONNECTION_KEYS.includes(key))
            this._settle('connection', () => this._configure());
        else if (COMPANION_KEYS.includes(key))
            this._settle('companion', () => this._restartCompanion());
        else if (LABEL_KEYS.includes(key))
            this._settle('labels', () => this._labelsChanged());
    }

    _settle(name, fn) {
        if (this._timers.has(name))
            GLib.source_remove(this._timers.get(name));
        this._timers.set(name, GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._timers.delete(name);
            fn();
            return GLib.SOURCE_REMOVE;
        }));
    }

    // Reads the URL and the token (keyring), then starts, reconfigures or stops the connection.
    async _configure() {
        const generation = ++this._generation;
        this._lookup?.cancel();
        const lookup = new Gio.Cancellable();
        this._lookup = lookup;
        const url = normalizeUrl(this._settings.get_string('url'));
        let token = null;
        if (url) {
            try {
                token = await lookupToken(url, lookup);
            } catch (e) {
                if (isCancelled(e))
                    return;
                console.warn(`[home-assistant] keyring unavailable: ${e.message}`);
            }
        }
        if (generation !== this._generation || !this._settings)
            return;
        if (!url || !token) {
            this._stopConnection();
            this._askForSetup();
            this._render();
            return;
        }
        this._setupNotification?.destroy();
        this._credentials = {url, token};
        this._rejectionShown = false;
        if (this._client) {
            this._stopCompanion();
            this._client.reconfigure(this._credentials);
            this._startCompanion();
        } else {
            this._startConnection();
        }
    }

    _startConnection() {
        this._client = new HaClient(this._credentials);
        this._listeners.push(this._client.onState(state => {
            if (state === 'rejected' && !this._rejectionShown) {
                this._rejectionShown = true;
                this._notifyWithSettings(_('Home Assistant refused the access token'),
                    _('Create a new long-lived access token and enter it in the extension settings.'));
            }
        }));
        // The grid tile goes before the background apps tile. Hidden while no entity carries the grid label.
        this._grid = new GridTile({client: this._client, icons: this._icons});
        const qs = Main.panel.statusArea.quickSettings;
        qs.menu.insertItemBefore(this._grid, qs._backgroundApps?.quickSettingsItems?.at(-1) ?? null);
        this._source = new StateSource(this._client, () => this._labels);
        this._listeners.push(this._source.onChange(d => {
            this._last = d;
            this._render();
        }));
        this._source.start();
        this._startShortcuts();
        this._startCompanion();
        this._client.start();
    }

    _stopConnection() {
        this._stopCompanion();
        this._listeners.forEach(end => end());
        this._listeners = [];
        this._source?.stop();
        this._source = null;
        this._client?.stop();
        this._client = null;
        this._grid?.destroy();
        this._grid = null;
        this._last = null;
        this._gridModel = null;
        this._credentials = null;
        this._startShortcuts();
    }

    // Without a client (not configured), a shortcut still shows the "crossed-out house" bubble.
    _startShortcuts() {
        this._shortcuts?.destroy();
        this._shortcuts = new Shortcuts({
            settings: this._settings,
            client: this._client ?? null,
            getGrid: () => this._gridModel,
            icons: this._icons,
            onTileState: this._grid ? cb => this._grid.onTileState(cb) : null,
        });
    }

    _startCompanion() {
        if (!this._client || !this._settings.get_boolean('companion-enabled'))
            return;
        this._companion = new CompanionController({settings: this._settings, client: this._client,
            url: this._credentials.url, token: this._credentials.token, extension: this});
        this._companion.start();
    }

    _stopCompanion() {
        this._companion?.stop();
        this._companion = null;
    }

    _restartCompanion() {
        this._stopCompanion();
        this._startCompanion();
    }

    _labelsChanged() {
        this._labels = readLabels(this._settings);
        this._source?.labelsChanged();
    }

    // Not configured yet: one notification per session, whose button opens the preferences.
    _askForSetup() {
        if (this._setupAsked)
            return;
        this._setupAsked = true;
        this._setupNotification = this._notifyWithSettings(_('Connect Home Assistant'),
            _('Enter the address of your Home Assistant and an access token to show it in the top bar.'));
    }

    _notifyWithSettings(title, body) {
        if (!this._messageSource) {
            this._messageSource = new MessageTray.Source({title: _('Home Assistant'),
                icon: new Gio.FileIcon({file: Gio.File.new_for_path(`${this.path}/icons/home-assistant-symbolic.svg`)})});
            this._messageSource.connect('destroy', () => (this._messageSource = null));
            Main.messageTray.add(this._messageSource);
        }
        const n = new MessageTray.Notification({source: this._messageSource, title, body});
        n.addAction(_('Open Settings'), () => this.openPreferences());
        this._messageSource.addNotification(n);
        return n;
    }

    // Lock screen: no chip, no tile (no information shown and no action possible there).
    _render() {
        if (!this._indicator)
            return;
        const locked = Main.sessionMode.isLocked;
        this._grid?.setLocked(locked);
        if (locked || !this._client) {
            this._indicator.clear();
            return;
        }
        const d = this._last;
        if (!d) {
            this._indicator.render([], false);  // connecting: crossed-out house until HA answers
            return;
        }
        this._indicator.render(chips(d.entities, d.labels, d.states, this._labels, d.stateNames), d.connected);
        // Grid pending (HA has not answered for its state yet): nothing new to show or publish. Once HA has answered, a
        // missing state is an error shown (and the shortcuts' grid is replaced, without tiles).
        const grid = readGrid(d.entities, d.labels, d.states, this._labels.grid, d.answered, d.stateNames);
        if (grid?.pending)
            return;
        this._gridModel = grid;
        this._grid.render(grid, d.states, d.tasks, d.connected, d.stateNames);
        // prefs.js does not talk to HA: it reads the mini-tiles and their choices in "grid-snapshot".
        const snapshot = JSON.stringify(gridSnapshot(grid));
        if (snapshot !== this._settings.get_string('grid-snapshot'))
            this._settings.set_string('grid-snapshot', snapshot);
    }

    // The extension declares the unlock-dialog session mode for the optional mobile_app companion only: Home Assistant
    // must keep receiving the "locked" and "active" sensors while the screen is locked, and the commands allowed there
    // (volume, lock, screen off...) must keep working. On the lock screen the chips and the grid are hidden and the
    // keyboard shortcuts are released (shortcuts.js). disable() is therefore only called at logout, when the
    // extension is turned off, or when GNOME Shell disables every extension.
    disable() {
        this._generation++;
        this._lookup?.cancel();
        this._lookup = null;
        for (const id of this._timers.values())
            GLib.source_remove(id);
        this._timers.clear();
        Main.sessionMode.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._stopConnection();  // restarts the shortcuts without a client: destroyed just after
        this._shortcuts?.destroy();
        this._shortcuts = null;
        this._messageSource?.destroy();
        this._messageSource = null;
        this._setupNotification = null;
        this._setupAsked = false;
        this._icons?.destroy();
        this._icons = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
