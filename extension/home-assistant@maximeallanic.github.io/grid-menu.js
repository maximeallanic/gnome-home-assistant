// The grid Quick Settings tile: one QuickMenuToggle whose menu is a
// two-column grid of mini-tiles described by Home Assistant, then the detail of the one mini-tile unfolded
// (grid-detail.js). Every text comes from HA (grid.js); this module only lays it out and calls the services.
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {TileDetail, callService, settable} from './grid-detail.js';
import {_} from './i18n.js';

const DEFAULT_ICON = 'go-home-symbolic';
const LOOK_CLASSES = {active: 'ha-tile-on', inactive: 'ha-tile-off', unavailable: 'ha-tile-unavailable'};

function detailUsable(tile, states) {
    return tile.choices.some(c => c.available) ||
        (tile.setting !== null && settable(states[tile.setting.entityId])) ||
        tile.details.some(id => Boolean(states[id]));
}

// What changes the shape of the grid; anything else (texts, looks, values) is updated in place.
function gridSignature(tiles) {
    return JSON.stringify(tiles.map(t => [t.id, t.wide, t.hasDetail, t.choices.map(c => c.entityId),
        t.setting?.kind ?? null, t.details]));
}

export const GridTile = GObject.registerClass(
class GridTile extends QuickMenuToggle {
    _init({client, icons}) {
        super._init({toggle_mode: false, menu_enabled: true, icon_name: DEFAULT_ICON});
        this._client = client;
        this._icons = icons;
        this._destroyed = false;
        this._hidden = false;
        this._present = false;
        this.visible = false;
        this._iconCache = new Map();  // 'mdi:…' -> Gio.Icon, only icons actually found
        this._listeners = new Set();
        this._signature = null;
        this._minis = [];
        this._openId = null;
        this._last = null;
        this._header = null;
        this._errorKey = null;
        this._iconName = undefined;

        this._errors = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._errors);
        const layout = new Clutter.GridLayout({column_homogeneous: true});
        this._grid = new St.Widget({style_class: 'ha-grid', layout_manager: layout, x_expand: true});
        layout.hookup_style(this._grid);
        this.menu.box.add_child(this._grid);
        this._detailSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._detailSection);
        this._detail = new TileDetail(this._detailSection, client);

        // The tile has no state of its own: a click opens the menu.
        this.connect('clicked', () => this.menu.open());
        this.connect('notify::gicon', () => this._syncHeader());
        this.connect('notify::icon-name', () => this._syncHeader());
        // The Shell puts the menu in its overlay but does not destroy it with the tile.
        this.connect('destroy', () => {
            this._destroyed = true;
            this._minis.forEach(mini => (mini.dead = true));
            this._detail.clear();
            this.menu.destroy();
        });
    }

    onTileState(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    // Lock screen: hidden without being destroyed, so it keeps its place in the Quick Settings grid.
    setLocked(locked) {
        this._hidden = locked;
        this._syncVisible();
    }

    // grid === null: no entity carries the grid label, the tile leaves the panel. A pending grid (its state not arrived
    // yet) changes nothing: what is shown stays until the grid has something to say.
    render(grid, states, tasks, connected, stateNames = null) {
        if (grid?.pending)
            return;
        this._present = grid !== null;
        this._syncVisible();
        if (!grid)
            return;
        this._last = {grid, states, tasks, connected, stateNames};
        this.title = grid.name;
        this.subtitle = grid.subtitle || null;
        this.checked = grid.tiles.some(t => t.look === 'active');
        this.reactive = connected;
        this._header = grid.name;
        this._syncHeader();
        if (this._iconName !== grid.icon) {
            const wanted = grid.icon;
            this._iconName = wanted;
            this._applyIcon(wanted, gicon => {
                if (this._iconName !== wanted)
                    return;
                if (gicon) {
                    this.gicon = gicon;
                } else {
                    this.icon_name = DEFAULT_ICON;
                    this._iconName = undefined;  // asked again on the next render (network down)
                }
            });
        }
        this._renderErrors(grid.errors);

        const signature = gridSignature(grid.tiles);
        if (signature !== this._signature) {
            this._signature = signature;
            this._rebuildGrid(grid.tiles);
        }
        grid.tiles.forEach((tile, i) => this._updateMini(this._minis[i], tile, states, connected));
        this._grid.visible = grid.tiles.length > 0;

        this._renderDetail();
        for (const tile of grid.tiles)
            this._listeners.forEach(callback => callback(tile));
    }

    _syncVisible() {
        this.visible = this._present && !this._hidden;
    }

    _syncHeader() {
        if (this._header !== null)
            this.menu.setHeader(this.gicon ?? this.icon_name ?? DEFAULT_ICON, this._header);
    }

    _renderErrors(errors) {
        const key = errors.join(' ');
        if (key === this._errorKey)
            return;
        this._errorKey = key;
        if (errors.length > 0)
            console.warn(`[home-assistant] grid: ${key}`);
        this._errors.removeAll();
        if (errors.includes('unreadable')) {
            const item = new PopupMenu.PopupMenuItem(_('The grid sent by Home Assistant cannot be read'),
                {reactive: false});
            item.label.clutter_text.set({line_wrap: true, ellipsize: Pango.EllipsizeMode.NONE});
            this._errors.addMenuItem(item);
        }
    }

    _rebuildGrid(tiles) {
        // Pending icon lookups of the old mini-tiles must not touch their destroyed St.Icon.
        this._minis.forEach(mini => (mini.dead = true));
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        let column = 0;
        let row = 0;
        this._minis = tiles.map(tile => {
            const mini = this._createMini(tile);
            if (tile.wide) {
                if (column !== 0)
                    row++;
                layout.attach(mini.button, 0, row++, 2, 1);
                column = 0;
            } else {
                layout.attach(mini.button, column, row, 1, 1);
                if (++column === 2) {
                    column = 0;
                    row++;
                }
            }
            return mini;
        });
    }

    _createMini(tile) {
        const button = new St.Button({style_class: 'ha-tile', can_focus: true, x_expand: true});
        const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'ha-tile-body',
            x_expand: true});
        const top = new St.BoxLayout({style_class: 'ha-tile-top', x_expand: true});
        const icon = new St.Icon({style_class: 'ha-tile-icon', icon_name: DEFAULT_ICON});
        const name = new St.Label({style_class: 'ha-tile-name', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const text = new St.Label({style_class: 'ha-tile-text', x_expand: true});
        text.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        top.add_child(icon);
        top.add_child(name);
        let arrow = null;
        if (tile.hasDetail) {
            arrow = new St.Button({style_class: 'ha-tile-arrow', can_focus: true,
                child: new St.Icon({icon_name: 'pan-down-symbolic'})});
            arrow.connect('clicked', () => this._toggleDetail(tile.id));
            top.add_child(arrow);
        }
        body.add_child(top);
        body.add_child(text);
        button.set_child(body);
        const mini = {id: tile.id, button, icon, name, text, arrow, tile, iconName: undefined, dead: false};
        button.connect('clicked', () => {
            if (mini.tile.action)
                callService(this._client, mini.tile.action);
            else if (mini.tile.hasDetail)
                this._toggleDetail(mini.tile.id);
        });
        return mini;
    }

    _updateMini(mini, tile, states, connected) {
        mini.tile = tile;
        mini.name.text = tile.name;
        // The dimmed look says "unavailable"; HA's raw state word is not a text for people. An entity HA does not
        // know is said in words: the tile stays in its place, dimmed, "Not found".
        mini.text.text = tile.missing ? _('Not found') : tile.look === 'unavailable' ? '' : tile.text;
        for (const [look, styleClass] of Object.entries(LOOK_CLASSES)) {
            if (look === tile.look)
                mini.button.add_style_class_name(styleClass);
            else
                mini.button.remove_style_class_name(styleClass);
        }
        const clickable = tile.action !== null || tile.hasDetail;
        mini.button.reactive = connected && tile.look !== 'unavailable' && clickable;
        if (mini.arrow)
            mini.arrow.reactive = connected && (tile.look !== 'unavailable' || detailUsable(tile, states));
        if (mini.iconName !== tile.icon) {
            mini.iconName = tile.icon;
            this._applyIcon(tile.icon, gicon => {
                if (mini.dead || mini.iconName !== tile.icon)
                    return;
                if (gicon) {
                    mini.icon.gicon = gicon;
                } else {
                    mini.icon.icon_name = DEFAULT_ICON;
                    mini.iconName = undefined;  // asked again on the next render (network down)
                }
            });
        }
    }

    _applyIcon(name, apply) {
        if (this._iconCache.has(name)) {
            apply(this._iconCache.get(name));
            return;
        }
        this._icons.lookup(name, gicon => {
            if (this._destroyed)
                return;
            if (gicon)
                this._iconCache.set(name, gicon);
            apply(gicon);
        });
    }

    _toggleDetail(id) {
        this._openId = this._openId === id ? null : id;
        this._renderDetail();
    }

    // At most one detail unfolded; it stays open across renders as long as its mini-tile still has one.
    _renderDetail() {
        const {grid, states, tasks, connected, stateNames} = this._last;
        const open = grid.tiles.find(t => t.id === this._openId && t.hasDetail);
        if (open) {
            this._detail.render(open, states, tasks, connected, stateNames);
        } else {
            this._openId = null;
            this._detail.clear();
        }
        this._syncOpen();
    }

    _syncOpen() {
        for (const mini of this._minis) {
            const open = mini.id === this._openId;
            if (open)
                mini.button.add_style_class_name('ha-tile-open');
            else
                mini.button.remove_style_class_name('ha-tile-open');
            if (mini.arrow)
                mini.arrow.child.icon_name = open ? 'pan-up-symbolic' : 'pan-down-symbolic';
        }
    }
});
