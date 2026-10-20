// Preferences page "Connection": Home Assistant address, access token (saved in the keyring), test, label names,
// icon downloads. The first page a new user sees.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {DEFAULT_LABELS, normalizeUrl} from './config.js';
import {clearToken, lookupToken, storeToken} from './credentials.js';
import {testConnection} from './connection-test.js';
import {_, format} from './i18n.js';

// Group titles and descriptions are Pango markup: translated text and Home Assistant names are escaped.
const escape = text => GLib.markup_escape_text(text, -1);

export class ConnectionPage {
    constructor(window, settings) {
        this._window = window;
        this._settings = settings;
        this.page = new Adw.PreferencesPage({title: _('Connection'), icon_name: 'network-server-symbolic'});
        this._buildServer();
        this._buildLabels();
        this._buildPrivacy();
        this._refreshTokenStatus();
    }

    _buildServer() {
        const group = new Adw.PreferencesGroup({
            title: escape(_('Home Assistant')),
            description: escape(_('Create a long-lived access token in Home Assistant: your profile, Security tab, ' +
                'Long-lived access tokens, Create token. The token is saved in your keyring, never in a file.')),
        });
        this._url = new Adw.EntryRow({use_markup: false, title: _('Address, for example http://homeassistant.local:8123'),
            text: this._settings.get_string('url'), input_purpose: Gtk.InputPurpose.URL});
        this._token = new Adw.PasswordEntryRow({use_markup: false, title: _('Access token')});
        this._tokenStatus = new Adw.ActionRow({use_markup: false, title: _('Saved token'), subtitle_lines: 0});
        this._removeToken = new Gtk.Button({label: _('Remove'), valign: Gtk.Align.CENTER, sensitive: false});
        this._removeToken.add_css_class('destructive-action');
        this._removeToken.connect('clicked', () => this._forget());
        this._tokenStatus.add_suffix(this._removeToken);
        const openProfile = new Gtk.Button({label: _('Open My Profile'), valign: Gtk.Align.CENTER});
        openProfile.connect('clicked', () => {
            const url = normalizeUrl(this._url.text);
            if (url)
                new Gtk.UriLauncher({uri: `${url}/profile/security`}).launch(this._window, null, null);
            else
                this._toast(_('Enter the address of Home Assistant first'));
        });
        const profileRow = new Adw.ActionRow({use_markup: false, title: _('Create a token in Home Assistant')});
        profileRow.add_suffix(openProfile);

        const buttons = new Gtk.Box({spacing: 12, halign: Gtk.Align.END, margin_top: 12});
        this._test = new Gtk.Button({label: _('Test Connection')});
        this._test.connect('clicked', () => this._runTest());
        const save = new Gtk.Button({label: _('Save')});
        save.add_css_class('suggested-action');
        save.connect('clicked', () => this._save());
        buttons.append(this._test);
        buttons.append(save);
        this._result = new Adw.ActionRow({use_markup: false, title: _('Not tested yet'), subtitle_lines: 0, visible: false});

        for (const row of [this._url, this._token, this._tokenStatus, profileRow, this._result])
            group.add(row);
        group.add(buttons);
        this.page.add(group);
    }

    _buildLabels() {
        const group = new Adw.PreferencesGroup({
            title: escape(_('Labels')),
            description: escape(_('In Home Assistant, put these labels on entities to show them. Labels are created in ' +
                'Settings, Areas, labels & zones, Labels.')),
        });
        for (const [key, title, fallback] of [
            ['topbar-label', _('Top bar chips'), DEFAULT_LABELS.topbar],
            ['alert-label', _('Alert chips'), DEFAULT_LABELS.alert],
            ['grid-label', _('Quick Settings grid'), DEFAULT_LABELS.grid],
        ]) {
            const row = new Adw.EntryRow({use_markup: false, title, text: this._settings.get_string(key), show_apply_button: true});
            row.connect('apply', () => this._settings.set_string(key, row.text.trim() || fallback));
            group.add(row);
        }
        this.page.add(group);
    }

    _buildPrivacy() {
        const group = new Adw.PreferencesGroup({title: escape(_('Icons'))});
        const row = new Adw.SwitchRow({
            use_markup: false,
            title: _('Download Home Assistant icons'),
            subtitle: _('Material Design Icons are fetched once from cdn.jsdelivr.net, then kept in the cache.'),
        });
        this._settings.bind('download-icons', row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
        this.page.add(group);
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({use_markup: false, title}));
    }

    async _refreshTokenStatus() {
        const url = normalizeUrl(this._settings.get_string('url'));
        let token = null;
        let failure = null;
        if (url) {
            try {
                token = await lookupToken(url);
            } catch (e) {
                failure = e.message;
            }
        }
        this._tokenStatus.subtitle = failure ? format(_('The keyring cannot be read: %s'), failure)
            : token ? format(_('A token for %s is saved in your keyring.'), url)
                : _('No token saved yet.');
        this._removeToken.sensitive = Boolean(token);
    }

    _bumpRevision() {
        this._settings.set_int('credentials-revision', this._settings.get_int('credentials-revision') + 1);
    }

    async _save() {
        const url = normalizeUrl(this._url.text);
        if (!url) {
            this._toast(_('The address must start with http:// or https://'));
            return;
        }
        this._url.text = url;
        const token = this._token.text.trim();
        try {
            if (token)
                await storeToken(url, token);
        } catch (e) {
            this._toast(format(_('The token could not be saved in the keyring: %s'), e.message));
            return;
        }
        this._token.text = '';
        this._settings.set_string('url', url);
        this._bumpRevision();
        await this._refreshTokenStatus();
        this._toast(_('Saved'));
        this._runTest();
    }

    async _forget() {
        const url = normalizeUrl(this._settings.get_string('url'));
        if (!url)
            return;
        try {
            await clearToken(url);
        } catch (e) {
            this._toast(format(_('The token could not be removed from the keyring: %s'), e.message));
            return;
        }
        this._bumpRevision();
        await this._refreshTokenStatus();
    }

    // Tests what is typed (address, and token if one is typed, else the saved one).
    async _runTest() {
        const url = normalizeUrl(this._url.text);
        if (!url) {
            this._toast(_('The address must start with http:// or https://'));
            return;
        }
        let token = this._token.text.trim();
        if (!token) {
            try {
                token = await lookupToken(url);
            } catch (e) {
                this._toast(format(_('The keyring cannot be read: %s'), e.message));
                return;
            }
        }
        if (!token) {
            this._toast(_('Enter an access token'));
            return;
        }
        this._test.sensitive = false;
        this._result.visible = true;
        this._result.title = _('Testing…');
        this._result.subtitle = '';
        const r = await testConnection(url, token);
        this._test.sensitive = true;
        if (r.ok) {
            this._result.title = r.name ? format(_('Connected to %s'), r.name) : _('Connected');
            this._result.subtitle = format(_('Home Assistant %s'), r.version);
            return;
        }
        this._result.title = _('Connection failed');
        this._result.subtitle = {
            unauthorized: _('Home Assistant refused the token. Create a new one and paste it again.'),
            'not-found': _('This address answers, but it is not Home Assistant.'),
            http: format(_('Unexpected answer from this address (%s).'), r.detail),
            unreachable: format(_('The address cannot be reached: %s'), r.detail),
        }[r.reason];
    }
}
