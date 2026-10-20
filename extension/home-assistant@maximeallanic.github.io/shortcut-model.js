// Keyboard shortcuts of the grid mini-tiles, pure logic (no gi://): what a binding resolves to, how bindings are stored
// in the `shortcuts` key, how a key press becomes an accelerator. Used by shortcuts.js (Shell) and prefs (GTK).

export function tileForShortcut(binding, grid) {
    return grid?.tiles.find(t => t.id === binding.tile) ?? null;
}

export function resolveShortcut(binding, grid) {
    const tile = tileForShortcut(binding, grid);
    if (!tile)
        return null;
    if (binding.choice)
        return tile.choices.find(c => c.entityId === binding.choice)?.service ?? null;
    return tile.action;
}

// A shortcut may press only what the menu lets a click press: the tile body unless the tile is unavailable, a choice
// unless its own entity is. Blocked: no call at all (the OSD shows the tile as it is).
export function shortcutBlocked(binding, grid) {
    const tile = tileForShortcut(binding, grid);
    if (!tile)
        return true;
    if (binding.choice)
        return !(tile.choices.find(c => c.entityId === binding.choice)?.available ?? false);
    return tile.look === 'unavailable';
}

// The `shortcuts` key: JSON [{tile, choice, accel}] written by prefs.js; malformed entries are dropped.
export function readShortcuts(json) {
    let list;
    try {
        list = JSON.parse(json);
    } catch (_e) {
        return [];
    }
    if (!Array.isArray(list))
        return [];
    return list.flatMap(e => {
        const valid = e && typeof e === 'object' && typeof e.tile === 'string' && e.tile !== '' &&
            typeof e.accel === 'string' && e.accel !== '' &&
            (e.choice === undefined || e.choice === null || typeof e.choice === 'string');
        return valid ? [{tile: e.tile, choice: e.choice || null, accel: e.accel}] : [];
    });
}

// OSD label of a shortcut: HA's name and text only. An unavailable tile shows no raw state word; a missing one shows
// `notFound`, the translated "Not found" the caller passes (this module has no gettext).
export function shortcutLabel(tile, notFound = '') {
    const text = tile.missing ? notFound : tile.look === 'unavailable' ? '' : tile.text;
    return text ? `${tile.name} · ${text}` : tile.name;
}

// One entry of the `shortcut-conflicts` key: the whole binding, so a duplicate accelerator flags only the entry the
// Shell refused, not the first one that works.
export function conflictKey(binding) {
    return JSON.stringify([binding.tile, binding.choice || null, binding.accel]);
}

// The `grid-snapshot` key read back by prefs.js; anything malformed is dropped, never thrown.
export function readSnapshot(json) {
    let list;
    try {
        list = JSON.parse(json);
    } catch (_e) {
        return [];
    }
    if (!Array.isArray(list))
        return [];
    return list.flatMap(t => {
        if (!t || typeof t !== 'object' || typeof t.id !== 'string' || t.id === '')
            return [];
        const choices = (Array.isArray(t.choices) ? t.choices : []).flatMap(c =>
            c && typeof c.entityId === 'string' && c.entityId !== '' ?
                [{entityId: c.entityId, name: typeof c.name === 'string' && c.name ? c.name : c.entityId}] : []);
        // A snapshot written before hasAction existed says nothing about it: keep offering the action, as before.
        const hasAction = t.hasAction !== false;
        return [{id: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, hasAction, choices}];
    });
}

// Modifier bits as GDK defines them (Gdk.ModifierType), kept as numbers so this module stays free of gi://.
const CONTROL_MASK = 1 << 2;
const ALT_MASK = 1 << 3;
const SUPER_MASK = 1 << 26;
const META_MASK = 1 << 28;
const KEY_F1 = 0xffbe;
const KEY_F24 = 0xffd5;

// Keys that are only a modifier (Shift_L .. Hyper_R, ISO_Level3/5_Shift): pressing one is not yet a shortcut.
export function isModifierKey(keyval) {
    return (keyval >= 0xffe1 && keyval <= 0xffee) || keyval === 0xfe03 || keyval === 0xfe11;
}

// A global shortcut must not steal a plain key: it needs Ctrl, Alt, Super or Meta (Shift alone only types a capital),
// except F1..F24 which are never typed text.
export function acceleratorAllowed(keyval, modifiers) {
    if (isModifierKey(keyval))
        return false;
    if (keyval >= KEY_F1 && keyval <= KEY_F24)
        return true;
    return (modifiers & (CONTROL_MASK | ALT_MASK | SUPER_MASK | META_MASK)) !== 0;
}

// The `shortcuts` key as stored, untouched: an array, or null when it is not a JSON array (prefs then refuses to write).
export function parseStoredShortcuts(json) {
    try {
        const list = JSON.parse(json);
        return Array.isArray(list) ? list : null;
    } catch (_e) {
        return null;
    }
}

// Works on the raw parsed array: only entries of the (tile, choice) row are replaced (first one, in place) or removed
// (all of them); unknown entries, extra fields and duplicates of other rows pass through untouched.
// A null/empty accel removes the row. `choice` null, undefined and '' all mean "no choice".
export function withShortcut(list, tile, choice, accel) {
    const wanted = choice || null;
    const matches = e => !!e && typeof e === 'object' && e.tile === tile && (e.choice || null) === wanted;
    const entry = {tile, choice: wanted, accel};
    const out = [];
    let placed = !accel;
    for (const e of list) {
        if (!matches(e)) {
            out.push(e);
        } else if (!placed) {
            out.push(entry);
            placed = true;
        }
    }
    if (!placed)
        out.push(entry);
    return out;
}

// Normalises a key press the way GNOME Settings does for its shortcut editor, which matches how gnome-shell detects
// accelerators (port of normalize_keyval_and_mask, panels/keyboard/keyboard-shortcuts.c, gnome-control-center 51):
//   unmodified = keyval of the key translated without the explicit modifiers (and without Shift),
//   shifted    = keyval of the same key translated with Shift (only used to normalise num-row digits, AZERTY),
//   mask       = state; defaultMask = Gtk.accelerator_get_default_mod_mask().
// Shift stays an explicit modifier (Ctrl+Shift+L is <Control><Shift>l); Caps Lock never is.
export function normalizeKeyAndMask({unmodified, shifted, mask, defaultMask}) {
    const LOCK_MASK = 1 << 1;
    let keyval = unmodified;
    if (shifted >= 0x30 && shifted <= 0x39)
        keyval = shifted;               // the digit, whatever the layout puts at level 0 (& on AZERTY)
    if (keyval === 0xfe20)              // ISO_Left_Tab -> Tab
        keyval = 0xff09;
    const used = mask & (defaultMask | 1);
    if (keyval === 0xff15 && (used & ALT_MASK) !== 0)   // Sys_Req -> Print, so Alt+Print stays bindable
        keyval = 0xff61;
    return {keyval, mask: used & ~LOCK_MASK};
}

// Splits the saved shortcuts against the current grid: those whose tile or choice is gone are inactive, and so is a
// no-choice shortcut on a tile without an action (it would resolve to nothing).
export function splitShortcuts(snapshot, list) {
    const live = e => {
        const tile = snapshot.find(t => t.id === e.tile);
        if (!tile)
            return false;
        return e.choice ? tile.choices.some(c => c.entityId === e.choice) : tile.hasAction !== false;
    };
    return {active: list.filter(live), inactive: list.filter(e => !live(e))};
}
