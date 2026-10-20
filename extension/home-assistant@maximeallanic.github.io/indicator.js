// Top bar chips, in the Quick Settings indicator area. Display only.
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const OFFLINE_CHIP = {id: '', name: '', text: '', icon: 'mdi:home-off', alert: false,
    hidden: false, toggleable: true, active: false};

const Chip = GObject.registerClass(
class Chip extends St.BoxLayout {
    _init(icons) {
        super._init({style_class: 'ha-chip', y_align: Clutter.ActorAlign.CENTER});
        this._icons = icons;
        this._icon = new St.Icon({style_class: 'system-status-icon', visible: false});
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER, visible: false});
        this.add_child(this._icon);
        this.add_child(this._label);
        this._iconName = undefined;
        this._destroyed = false;
        this.connect('destroy', () => (this._destroyed = true));
    }

    show(chip) {
        this.visible = !chip.hidden;
        this._label.text = chip.text;
        this._label.visible = chip.text !== '';
        if (chip.alert)
            this.add_style_class_name('ha-chip-alert');
        else
            this.remove_style_class_name('ha-chip-alert');
        // St does not apply "opacity" from CSS: the dimming is set on the actor.
        const inactive = chip.toggleable && !chip.active;
        if (inactive)
            this.add_style_class_name('ha-chip-inactive');
        else
            this.remove_style_class_name('ha-chip-inactive');
        this.opacity = inactive ? 128 : 255;
        if (chip.icon !== this._iconName) {
            this._iconName = chip.icon;
            this._icons.lookup(chip.icon, gicon => {
                // Chip destroyed or icon changed meanwhile: nothing to do.
                if (this._destroyed || this._iconName !== chip.icon)
                    return;
                this._icon.gicon = gicon;
                this._icon.visible = gicon !== null;
                // No icon (network down): asked again at the next render; a real absence (404) is remembered by
                // Icons and costs nothing.
                if (!gicon)
                    this._iconName = undefined;
            });
        }
    }
});

export const HomeIndicator = GObject.registerClass(
class HomeIndicator extends SystemIndicator {
    _init(icons) {
        super._init();
        this.add_style_class_name('ha-indicator');
        this._icons = icons;
        this._chips = new Map();  // id -> Chip
    }

    // Differential update: targeted creation, removal and update, order fixed afterwards.
    // connected false: one crossed-out house instead of the chips.
    render(chips, connected) {
        const wanted = connected ? chips : [OFFLINE_CHIP];
        const ids = new Set(wanted.map(c => c.id));
        for (const [id, widget] of this._chips) {
            if (!ids.has(id)) {
                widget.destroy();
                this._chips.delete(id);
            }
        }
        wanted.forEach((chip, index) => {
            let widget = this._chips.get(chip.id);
            if (!widget) {
                widget = new Chip(this._icons);
                this._chips.set(chip.id, widget);
                this.add_child(widget);
            }
            widget.show(chip);
            this.set_child_at_index(widget, index);
        });
        this.visible = wanted.some(c => !c.hidden);
    }

    // Not configured yet, or the screen is locked: nothing in the bar.
    clear() {
        this.render([], true);
    }
});
