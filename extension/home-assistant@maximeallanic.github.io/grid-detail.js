// The unfolded detail of one mini-tile of the grid: segmented choice buttons, a slider for the setting, then menu
// lines rendered by menu-lines.js. Lives in a PopupMenuSection of the grid tile menu (grid-menu.js) and updates in
// place while its shape does not change.
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {menuLine, domainOf, EMPTY_STATES} from './chips.js';
import {numericLocale} from './number-format.js';
import {SliderGuard, settingLabel, stepDecimals} from './grid.js';
import {callService as callEntityService, buildLine, linesShape} from './menu-lines.js';

const KEYBOARD_SEND_DELAY = 300;  // ms without change before a keyboard/scroll slider move is sent

export const callService = (client, s) => callEntityService(client, s.domain, s.service, s.entityId, s.data ?? {});

export const settable = state => Boolean(state) && !EMPTY_STATES.includes(String(state.state).trim().toLowerCase());

function settingService(setting, value) {
    switch (setting.kind) {
    case 'brightness':
        return {domain: 'light', service: 'turn_on', entityId: setting.entityId, data: {brightness_pct: value}};
    case 'position':
        return {domain: 'cover', service: 'set_cover_position', entityId: setting.entityId, data: {position: value}};
    default:
        return {domain: domainOf(setting.entityId), service: 'set_value', entityId: setting.entityId, data: {value}};
    }
}

// Slider fraction (0..1) <-> setting value, snapped to the setting's step.
function toFraction(setting, value) {
    const span = setting.max - setting.min;
    return span > 0 ? Math.min(1, Math.max(0, (value - setting.min) / span)) : 0;
}

function fromFraction(setting, fraction) {
    const decimals = stepDecimals(setting);
    const steps = setting.step > 0 ? Math.round(fraction * (setting.max - setting.min) / setting.step) : 0;
    return Number((setting.min + steps * setting.step).toFixed(decimals));
}

// The unfolded detail of one mini-tile: segmented choices, a slider, menu lines. Built into `section`.
export class TileDetail {
    constructor(section, client) {
        this._section = section;
        this._client = client;
        this._signature = null;
        this._updates = [];
        this._timer = 0;
    }

    static signature(tile, lines) {
        return JSON.stringify([tile.id, tile.choices.map(c => c.entityId), tile.setting?.kind ?? null,
            tile.setting?.entityId ?? null, linesShape(lines)]);
    }

    render(tile, states, tasks, connected, stateNames = null) {
        const lines = tile.details.map(id => menuLine(id, states, tasks, stateNames));
        const signature = TileDetail.signature(tile, lines);
        if (signature !== this._signature) {
            this.clear();
            this._signature = signature;
            this._build(tile, lines);
        }
        this._updates.forEach(update => update(tile, states, lines, connected));
    }

    _build(tile, lines) {
        const title = new PopupMenu.PopupSeparatorMenuItem(tile.name);
        this._section.addMenuItem(title);
        this._updates.push(current => (title.label.text = current.name));
        if (tile.choices.length > 0)
            this._buildChoices(tile);
        if (tile.setting)
            this._buildSlider(tile.setting);
        const lineUpdates = lines.map(l => buildLine(this._section, l, this._client, lines.length > 1));
        this._updates.push((_t, _s, current) => current.forEach((l, i) => lineUpdates[i](l)));
    }

    _row(styleClass) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({style_class: styleClass, x_expand: true});
        item.add_child(box);
        this._section.addMenuItem(item);
        return box;
    }

    _buildChoices(tile) {
        const box = this._row('ha-choice-group');
        const buttons = tile.choices.map(choice => {
            const button = new St.Button({style_class: 'ha-choice', label: choice.name,
                can_focus: true, x_expand: true});
            button.get_child()?.clutter_text?.set({ellipsize: Pango.EllipsizeMode.END});
            button.connect('clicked', () => callService(this._client, choice.service));
            box.add_child(button);
            return button;
        });
        this._updates.push((current, _s, _l, connected) => current.choices.forEach((choice, i) => {
            buttons[i].label = choice.name;
            // A choice button can be pressed unless HA says it is gone (Choice.available, grid.js).
            buttons[i].reactive = connected && choice.available;
            // `active` comes from HA (for example the real height of a desk): updated in place on every render, no rebuild.
            buttons[i].checked = choice.active;
        }));
    }

    _buildSlider(initial) {
        const box = this._row('ha-slider-row');
        const slider = new Slider(0);
        const value = new St.Label({style_class: 'ha-slider-value', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(slider);
        box.add_child(value);
        const guard = new SliderGuard();
        let setting = initial;
        let states = {};
        let fromHa = false;
        let dragging = false;
        const local = () => fromFraction(setting, slider.value);
        const show = v => (value.text = settingLabel(setting, states, v, numericLocale()));
        const send = v => callService(this._client, settingService(setting, v));
        const stopTimer = () => {
            if (this._timer)
                GLib.source_remove(this._timer);
            this._timer = 0;
        };

        slider.connect('drag-begin', () => {
            stopTimer();
            dragging = true;
            guard.begin();
        });
        slider.connect('drag-end', () => {
            dragging = false;
            send(guard.end(local()));
        });
        slider.connect('notify::value', () => {
            if (fromHa)
                return;
            show(local());
            if (dragging)
                return;
            // Keyboard or wheel: one call once the value has settled, the slider held meanwhile.
            guard.begin();
            stopTimer();
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEYBOARD_SEND_DELAY, () => {
                this._timer = 0;
                send(guard.end(local()));
                return GLib.SOURCE_REMOVE;
            });
        });
        this._updates.push((tile, current, _l, connected) => {
            setting = tile.setting;
            states = current;
            slider.reactive = connected && settable(states[setting.entityId]);
            if (!guard.accept(setting.value))
                return;
            // HA has no value (entity missing, unavailable, unknown): no invented number, the handle stays put.
            if (setting.value === null) {
                value.text = '';
                return;
            }
            fromHa = true;
            slider.value = toFraction(setting, setting.value);
            fromHa = false;
            show(setting.value);
        });
    }

    clear() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._updates = [];
        this._signature = null;
        this._section.removeAll();
    }
}

