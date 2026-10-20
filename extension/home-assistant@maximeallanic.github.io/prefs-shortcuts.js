// Preferences page "Shortcuts": keyboard shortcuts for the mini-tiles of the Quick Settings grid.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {_} from './i18n.js';
import {conflictKey, parseStoredShortcuts, readShortcuts, readSnapshot, splitShortcuts, withShortcut}
    from './shortcut-model.js';
import {captureShortcut} from './prefs-capture.js';

// Group titles and descriptions are Pango markup: translated text and Home Assistant names are escaped.
const escape = text => GLib.markup_escape_text(text, -1);

export class ShortcutsPage {
    constructor(window, settings) {
        this._window = window;
        this._settings = settings;
        this.page = new Adw.PreferencesPage({title: _('Shortcuts'), icon_name: 'input-keyboard-symbolic'});
        this._groups = [];
        this._rebuild();
        const ids = ['shortcuts', 'grid-snapshot', 'shortcut-conflicts'].map(key =>
            this._settings.connect(`changed::${key}`, () => this._rebuild()));
        window.connect('close-request', () => {
            ids.forEach(id => this._settings.disconnect(id));
            return false;
        });
    }

    _rebuild() {
        this._groups.forEach(g => this.page.remove(g));
        this._groups = [];

        const snapshot = readSnapshot(this._settings.get_string('grid-snapshot'));
        const shortcuts = readShortcuts(this._settings.get_string('shortcuts'));
        // One key per refused entry (conflictKey): of two entries sharing an accelerator, only the refused one is flagged.
        const conflicts = new Set(this._settings.get_strv('shortcut-conflicts'));
        const add = group => {
            this.page.add(group);
            this._groups.push(group);
        };

        // The snapshot is only the list of mini-tiles: it cannot tell "not connected yet" from "no grid entity" or "grid
        // unreadable", so the message covers all three.
        if (snapshot.length === 0) {
            const group = new Adw.PreferencesGroup();
            group.add(new Adw.StatusPage({
                icon_name: 'go-home-symbolic',
                title: _('No mini-tiles to list'),
                description: escape(_('They appear here once Home Assistant is connected and sends a grid with mini-tiles.')),
            }));
            add(group);
            return;
        }

        const {inactive} = splitShortcuts(snapshot, shortcuts);
        for (const tile of snapshot) {
            if (!tile.hasAction && tile.choices.length === 0)
                continue;  // nothing a shortcut could do on this tile
            const group = new Adw.PreferencesGroup({title: escape(tile.name)});
            // A tile with `action: none` does nothing on its own: no shortcut row for it, only for its choices.
            if (tile.hasAction)
                group.add(this._row({title: _('Tile action'), tile: tile.id, choice: null, shortcuts, conflicts, heading: tile.name}));
            for (const choice of tile.choices)
                group.add(this._row({
                    title: choice.name, tile: tile.id, choice: choice.entityId, shortcuts, conflicts,
                    heading: `${tile.name} · ${choice.name}`,
                }));
            add(group);
        }
        if (inactive.length > 0)
            add(this._inactiveGroup(inactive, conflicts));
    }

    _entry(shortcuts, tile, choice) {
        return shortcuts.find(e => e.tile === tile && e.choice === choice) ?? null;
    }

    _warning(entry, conflicts) {
        return entry && conflicts.has(conflictKey(entry)) ? _('Already used by another shortcut') : '';
    }

    _row({title, tile, choice, shortcuts, conflicts, heading}) {
        const entry = this._entry(shortcuts, tile, choice);
        const accel = entry?.accel ?? '';
        const warning = this._warning(entry, conflicts);
        const row = new Adw.ActionRow({use_markup: false, title, subtitle: warning, subtitle_lines: 0});
        if (warning) {
            row.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
            row.add_css_class('warning');
        }
        row.add_suffix(new Gtk.ShortcutLabel({
            accelerator: accel, disabled_text: _('Not set'), valign: Gtk.Align.CENTER,
        }));
        const button = new Gtk.Button({label: _('Set'), valign: Gtk.Align.CENTER});
        button.update_property([Gtk.AccessibleProperty.DESCRIPTION], [heading]);
        button.connect('clicked', () => captureShortcut(this._window, heading, result =>
            this._edit(tile, choice, result)));
        row.add_suffix(button);
        row.set_activatable_widget(button);
        return row;
    }

    _inactiveGroup(inactive, conflicts) {
        const group = new Adw.PreferencesGroup({
            title: escape(_('Inactive')),
            description: escape(_('These shortcuts no longer match anything in the grid and do nothing.')),
        });
        for (const e of inactive) {
            const row = new Adw.ActionRow({
                use_markup: false,
                title: e.tile,
                subtitle: this._warning(e, conflicts) || (e.choice ?? ''),
                subtitle_lines: 0,
            });
            row.add_css_class('dim-label');
            row.add_prefix(new Gtk.Image({icon_name: 'action-unavailable-symbolic'}));
            row.add_suffix(new Gtk.ShortcutLabel({accelerator: e.accel, valign: Gtk.Align.CENTER}));
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic', tooltip_text: _('Remove'), valign: Gtk.Align.CENTER,
            });
            remove.add_css_class('flat');
            remove.connect('clicked', () => this._edit(e.tile, e.choice, null));
            row.add_suffix(remove);
            group.add(row);
        }
        return group;
    }

    // Edits one row of the stored list in place; refuses to write over a value that is not a JSON list.
    _edit(tile, choice, accel) {
        const stored = parseStoredShortcuts(this._settings.get_string('shortcuts'));
        if (stored === null) {
            this._window.add_toast(new Adw.Toast({use_markup: false, title: _('The stored shortcuts are not a list, nothing was changed')}));
            return;
        }
        this._settings.set_string('shortcuts', JSON.stringify(withShortcut(stored, tile, choice, accel)));
    }
}
