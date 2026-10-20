// Menu lines (from chips.menuLine), used by the details of the grid (grid-detail.js): switch, action, to-do items to
// tick, read-only value, not found.
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './i18n.js';

// The WebSocket message of a service call (also sent by the keyboard shortcuts, shortcuts.js).
export const serviceRequest = (domain, service, entityId, serviceData = {}) =>
    ({type: 'call_service', domain, service, target: {entity_id: entityId}, service_data: serviceData});

export function callService(client, domain, service, entityId, serviceData = {}) {
    client.call(serviceRequest(domain, service, entityId, serviceData))
        .catch(e => {
            if (e.stopping)  // extension disabled during the call
                return;
            console.warn(`[home-assistant] ${domain}.${service} ${entityId}: ${e.message}`);
            Main.notify(_('Home Assistant'), e.message);
        });
}

const toggle = (client, id) => callService(client, 'homeassistant', 'toggle', id);

function valueLine(name, text) {
    const item = new PopupMenu.PopupMenuItem(name, {reactive: false});
    const value = new St.Label({text, x_expand: true, x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER, style_class: 'ha-line-value'});
    item.add_child(value);
    item._haValue = value;
    return item;
}

// What changes the shape of the menu (lines, to-do items); values (a switch state, a text) are updated in place,
// without rebuilding the menu (which would lose the focus while open).
export function linesShape(lines) {
    return JSON.stringify(lines.map(l => [l.type, l.id, l.name,
        (l.tasks ?? []).map(t => [t.uid, t.summary, t.description])]));
}

// Builds the line; returns the function that updates its values.
export function buildLine(section, line, client, several) {
    switch (line.type) {
    case 'switch': {
        const item = new PopupMenu.PopupSwitchMenuItem(line.name, line.on);
        item.connect('toggled', () => toggle(client, line.id));
        section.addMenuItem(item);
        return l => item.setToggleState(l.on);
    }
    case 'action': {
        const item = new PopupMenu.PopupMenuItem(line.name);
        item.connect('activate', () =>
            callService(client, line.service.domain, line.service.service, line.id));
        section.addMenuItem(item);
        return () => {};
    }
    case 'tasks':
        if (several)
            section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(line.name));
        if (line.tasks.length === 0)
            section.addMenuItem(new PopupMenu.PopupMenuItem(_('No tasks'), {reactive: false}));
        for (const task of line.tasks) {
            const title = task.description ? `${task.summary} — ${task.description}` : task.summary;
            const item = new PopupMenu.PopupImageMenuItem(title, 'checkbox-symbolic');
            item.connect('activate', () => callService(client, 'todo', 'update_item', line.id,
                {item: task.uid, status: 'completed'}));
            section.addMenuItem(item);
        }
        return () => {};
    case 'value': {
        const item = valueLine(line.name, line.text);
        section.addMenuItem(item);
        return l => (item._haValue.text = l.text);
    }
    default:
        section.addMenuItem(valueLine(line.name, _('Not found')));
        return () => {};
    }
}
