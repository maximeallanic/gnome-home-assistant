// Global keyboard shortcuts for the grid mini-tiles. Each entry of the `shortcuts`
// key binds an accelerator to a mini-tile id and optionally one of its choices. Grabbed the way the Shell grabs
// accelerators for D-Bus clients (ui/shellDBus.js _grabAcceleratorForSender): global.display.grab_accelerator, then
// Main.wm.allowKeybinding for the action modes where it may fire — never the lock screen.
// Feedback is the Shell's OSD bubble: the mini-tile icon with HA's name and text, kept up to date while it changes.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    conflictKey, readShortcuts, resolveShortcut, shortcutBlocked, shortcutLabel, tileForShortcut,
} from './shortcut-model.js';
import {serviceRequest} from './menu-lines.js';
import {_} from './i18n.js';

const MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP;
const OFFLINE_ICON = 'mdi:home-off';  // shipped in icons/, same "crossed-out house" as the indicator
const DEFAULT_ICON = 'go-home-symbolic';
const ERROR_ICON = 'dialog-error-symbolic';
// After the call is accepted, the bubble follows the mini-tile for this long after its last change.
const FOLLOW_US = 2 * GLib.USEC_PER_SEC;

export class Shortcuts {
    // client: HaClient or null (not configured: every shortcut shows the offline bubble);
    // onTileState: GridTile.onTileState or null.
    constructor({settings, client, getGrid, icons, onTileState = null}) {
        this._settings = settings;
        this._client = client;
        this._getGrid = getGrid;
        this._icons = icons;
        this._destroyed = false;
        this._bindings = new Map();  // Meta keybinding action -> {tile, choice, accel}
        this._iconCache = new Map();
        this._follow = null;  // {id, label, icon, until}
        this._showSeq = 0;
        this._unsubscribe = onTileState ? onTileState(tile => this._tileChanged(tile)) : null;
        this._settingsId = settings.connect('changed::shortcuts', () => this._grabAll());
        this._activatedId = global.display.connect('accelerator-activated',
            (_display, action) => this._activate(action));
        // The lock screen keeps Quick Settings, whose menu runs in POPUP mode: nothing is grabbed while locked.
        Main.sessionMode.connectObject('updated', () => this._grabAll(), this);
        this._grabAll();
    }

    _grabAll() {
        this._ungrabAll();
        if (Main.sessionMode.isLocked)
            return;
        const conflicts = [];
        for (const binding of readShortcuts(this._settings.get_string('shortcuts'))) {
            const action = global.display.grab_accelerator(binding.accel, Meta.KeyBindingFlags.NONE);
            if (action === Meta.KeyBindingAction.NONE) {
                // The entry, not the accelerator: of two entries with one accelerator, only the refused one is flagged.
                conflicts.push(conflictKey(binding));
                continue;
            }
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), MODES);
            this._bindings.set(action, binding);
        }
        if (conflicts.length > 0)
            console.warn(`[home-assistant] shortcuts already taken: ${conflicts.map(c => JSON.parse(c)[2]).join(' ')}`);
        if (JSON.stringify(conflicts) !== JSON.stringify(this._settings.get_strv('shortcut-conflicts')))
            this._settings.set_strv('shortcut-conflicts', conflicts);
    }

    _ungrabAll() {
        for (const action of this._bindings.keys()) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(action);
        }
        this._bindings.clear();
    }

    _activate(action) {
        const binding = this._bindings.get(action);
        if (!binding || Main.sessionMode.isLocked)
            return;  // another client's accelerator, or locked (nothing should be grabbed then)
        if (this._client?.state !== 'connected') {
            this._follow = null;
            this._show(OFFLINE_ICON, null);
            return;
        }
        const grid = this._getGrid();
        const service = resolveShortcut(binding, grid);
        if (!service)
            return;  // mini-tile or choice gone from the grid, or nothing to do: no call
        const pressed = tileForShortcut(binding, grid);
        const {id} = pressed;
        this._follow = null;
        // Unavailable (or unknown to HA): what a click could not press, the shortcut does not either. The bubble
        // shows the tile as it is — its name, "Not found" if HA does not know it — and no text that reads as done.
        if (shortcutBlocked(binding, grid)) {
            this._show(pressed.icon, shortcutLabel(pressed, _('Not found')));
            return;
        }
        this._client.call(serviceRequest(service.domain, service.service, service.entityId, service.data ?? {}))
            .then(() => {
                if (this._destroyed)
                    return;
                // The text of the moment: states may have arrived while HA was answering.
                const tile = tileForShortcut(binding, this._getGrid());
                if (!tile)
                    return;
                this._follow = {id, label: shortcutLabel(tile, _('Not found')), icon: tile.icon,
                    until: GLib.get_monotonic_time() + FOLLOW_US};
                this._show(tile.icon, this._follow.label);
            }, e => {
                if (this._destroyed || e.stopping)  // extension disabled during the call
                    return;
                console.warn(`[home-assistant] shortcut ${binding.accel}: ${service.domain}.${service.service} ` +
                    `${service.entityId}: ${e.message}`);
                this._showGicon(new Gio.ThemedIcon({name: ERROR_ICON}), e.message);
            });
    }

    // Live update (a desk rising, a device starting): every new name/text re-shows the bubble.
    _tileChanged(tile) {
        const follow = this._follow;
        if (!follow || tile.id !== follow.id)
            return;
        const now = GLib.get_monotonic_time();
        if (now > follow.until) {
            this._follow = null;
            return;
        }
        const label = shortcutLabel(tile, _('Not found'));
        if (label === follow.label && tile.icon === follow.icon)
            return;
        Object.assign(follow, {label, icon: tile.icon, until: now + FOLLOW_US});
        this._show(tile.icon, label);
    }

    // icon: 'mdi:…' from HA, resolved like the mini-tiles (embedded, cached or downloaded).
    _show(icon, label) {
        const seq = ++this._showSeq;
        const apply = gicon => {
            if (this._destroyed || seq !== this._showSeq)
                return;
            this._showGicon(gicon ?? new Gio.ThemedIcon({name: DEFAULT_ICON}), label);
        };
        if (this._iconCache.has(icon)) {
            apply(this._iconCache.get(icon));
            return;
        }
        this._icons.lookup(icon, gicon => {
            if (gicon)
                this._iconCache.set(icon, gicon);
            apply(gicon);
        });
    }

    // Shell 50/51 OsdWindowManager.show() takes a per-monitor level map; showAll() is what the volume OSD uses.
    _showGicon(gicon, label) {
        ++this._showSeq;
        Main.osdWindowManager.showAll(gicon, label ?? null);
    }

    destroy() {
        this._destroyed = true;
        this._unsubscribe?.();
        this._unsubscribe = null;
        Main.sessionMode.disconnectObject(this);
        global.display.disconnect(this._activatedId);
        this._settings.disconnect(this._settingsId);
        this._ungrabAll();
        this._follow = null;
    }
}
