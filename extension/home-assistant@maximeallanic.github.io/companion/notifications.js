// Home Assistant notifications in GNOME: "Home Assistant" source, action buttons sent back to HA
// (mobile_app_notification_action), replacement by tag, URL opened on click. The model comes from
// notification-model.js.
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {_} from '../i18n.js';

export class NotificationDisplay {
    // fireEvent: (type, data) => Promise, the mobile_app event sender. icon: Gio.Icon of the source.
    constructor({fireEvent, icon}) {
        this._fireEvent = fireEvent;
        this._icon = icon;
        this._source = null;
        this._byTag = new Map();
    }

    show(m) {
        if (m.tag)
            this.clear(m.tag, MessageTray.NotificationDestroyedReason.REPLACED);
        const source = this._getSource();
        const n = new MessageTray.Notification({
            source,
            title: m.title,
            body: m.body,
            urgency: m.urgent ? MessageTray.Urgency.HIGH : MessageTray.Urgency.NORMAL,
        });
        for (const a of m.actions) {
            n.addAction(a.title, () => {
                this._fireEvent('mobile_app_notification_action', {action: a.action, ...m.tag ? {tag: m.tag} : {}})
                    .catch(e => console.warn(`[home-assistant] notification action: ${e.message}`));
            });
        }
        if (m.url) {
            n.connect('activated', () => {
                try {
                    Gio.AppInfo.launch_default_for_uri(m.url, global.create_app_launch_context(0, -1));
                } catch (e) {
                    console.warn(`[home-assistant] opening the notification URL: ${e.message}`);
                }
            });
        }
        if (m.tag) {
            this._byTag.set(m.tag, n);
            n.connect('destroy', () => {
                if (this._byTag.get(m.tag) === n)
                    this._byTag.delete(m.tag);
            });
        }
        source.addNotification(n);
    }

    clear(tag, reason = MessageTray.NotificationDestroyedReason.SOURCE_CLOSED) {
        this._byTag.get(tag)?.destroy(reason);
    }

    destroy() {
        this._byTag.clear();
        this._source?.destroy();
        this._source = null;
    }

    _getSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: _('Home Assistant'), icon: this._icon});
            this._source.connect('destroy', () => (this._source = null));
            Main.messageTray.add(this._source);
        }
        return this._source;
    }
}
