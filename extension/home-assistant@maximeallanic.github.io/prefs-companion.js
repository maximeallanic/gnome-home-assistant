// Preferences page "This Computer": registers the computer as a Home Assistant mobile_app device (opt-in), and shows
// the Home Assistant package generated from the entity ids Home Assistant gave it, ready to copy.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {buildPackage, readCompanionSnapshot} from './companion/ha-package.js';
import {_, format, ngettext} from './i18n.js';

// Group titles and descriptions are Pango markup: translated text and Home Assistant names are escaped.
const escape = text => GLib.markup_escape_text(text, -1);

export class CompanionPage {
    constructor(window, settings) {
        this._window = window;
        this._settings = settings;
        this.page = new Adw.PreferencesPage({title: _('This Computer'), icon_name: 'computer-symbolic'});
        this._buildDevice();
        this._buildPackage();
        this._refresh();
        const ids = ['companion-snapshot', 'companion-enabled'].map(key =>
            settings.connect(`changed::${key}`, () => this._refresh()));
        window.connect('close-request', () => {
            ids.forEach(id => settings.disconnect(id));
            return false;
        });
    }

    _buildDevice() {
        const group = new Adw.PreferencesGroup({
            title: escape(_('Register in Home Assistant')),
            description: escape(_('This computer becomes a device of the Mobile App integration: it reports sensors ' +
                '(battery, volume, screen lock, media playing…), receives commands and shows notifications sent ' +
                'from Home Assistant.')),
        });
        const enabled = new Adw.SwitchRow({use_markup: false, title: _('Register this computer')});
        this._settings.bind('companion-enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        const name = new Adw.EntryRow({
            use_markup: false,
            title: format(_('Device name (empty: %s)'), GLib.get_host_name()),
            text: this._settings.get_string('device-name'), show_apply_button: true,
        });
        name.connect('apply', () => this._settings.set_string('device-name', name.text.trim()));
        this._status = new Adw.ActionRow({use_markup: false, title: _('Status'), subtitle_lines: 0});
        for (const row of [enabled, name, this._status])
            group.add(row);
        this.page.add(group);
    }

    _buildPackage() {
        this._packageGroup = new Adw.PreferencesGroup({
            title: escape(_('Home Assistant package')),
            description: escape(_('Turns the sensors of this computer into controls (volume and brightness sliders, ' +
                'switches, buttons, scripts). In Home Assistant, enable packages in configuration.yaml ' +
                '(homeassistant: packages: !include_dir_named packages), save this text as ' +
                'packages/gnome_computer.yaml, then restart Home Assistant.')),
        });
        const copy = new Gtk.Button({label: _('Copy'), valign: Gtk.Align.CENTER});
        copy.add_css_class('suggested-action');
        copy.connect('clicked', () => {
            if (!this._yaml)
                return;
            Gdk.Display.get_default().get_clipboard().set(this._yaml);
            this._window.add_toast(new Adw.Toast({use_markup: false, title: _('Copied to the clipboard')}));
        });
        this._packageGroup.set_header_suffix(copy);
        this._copy = copy;
        this._notify = new Adw.ActionRow({use_markup: false, subtitle_lines: 0, visible: false});
        this._notify.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
        this._packageGroup.add(this._notify);
        this._buffer = new Gtk.TextBuffer();
        const view = new Gtk.TextView({buffer: this._buffer, editable: false, monospace: true,
            wrap_mode: Gtk.WrapMode.NONE, top_margin: 12, bottom_margin: 12, left_margin: 12, right_margin: 12});
        view.update_property([Gtk.AccessibleProperty.LABEL], [_('Home Assistant package')]);
        const scroller = new Gtk.ScrolledWindow({child: view, min_content_height: 320, max_content_height: 320,
            propagate_natural_height: true});
        scroller.add_css_class('card');
        this._packageGroup.add(scroller);
        this.page.add(this._packageGroup);
    }

    _refresh() {
        const enabled = this._settings.get_boolean('companion-enabled');
        const snapshot = readCompanionSnapshot(this._settings.get_string('companion-snapshot'));
        this._yaml = enabled ? buildPackage(snapshot) : null;
        if (!enabled) {
            this._status.subtitle = _('Not registered.');
        } else if (!snapshot) {
            this._status.subtitle = _('Waiting for Home Assistant. The extension must be enabled and connected.');
        } else {
            const count = Object.keys(snapshot.entities).length;
            this._status.subtitle = format(ngettext('Registered as “%s”, %s sensor.', 'Registered as “%s”, %s sensors.',
                count), snapshot.deviceName, count);
        }
        this._packageGroup.visible = Boolean(this._yaml);
        this._copy.sensitive = Boolean(this._yaml);
        this._buffer.text = this._yaml ?? '';
        // The notify service name is derived from the device name; when HA does not list it (a name in a non-Latin
        // script, or a device renamed at registration), the user has to check it once.
        this._notify.visible = Boolean(snapshot && !snapshot.notifyVerified);
        if (snapshot)
            this._notify.title = format(_('Home Assistant does not list the service notify.%s. In Developer tools, ' +
                'Actions, look for the notify.mobile_app_… service of this computer and use it in the package.'),
            snapshot.notifyService);
    }
}
