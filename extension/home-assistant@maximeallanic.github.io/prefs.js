// Preferences window. Runs in the preferences process (GTK 4 / libadwaita), not in the Shell: no imports from
// resource:///org/gnome/shell here.
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ConnectionPage} from './prefs-connection.js';
import {CompanionPage} from './prefs-companion.js';
import {ShortcutsPage} from './prefs-shortcuts.js';

export default class HomeAssistantPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.search_enabled = true;
        window.add(new ConnectionPage(window, settings).page);
        window.add(new CompanionPage(window, settings).page);
        window.add(new ShortcutsPage(window, settings).page);
    }
}
