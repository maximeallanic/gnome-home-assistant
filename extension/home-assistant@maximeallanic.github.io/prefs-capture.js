// Shortcut capture dialog for the Shortcuts preferences page (GTK 4 / libadwaita process: no Shell modules here).
// Escape cancels, BackSpace clears, a refused key keeps the dialog open and says why.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {_} from './i18n.js';
import {acceleratorAllowed, isModifierKey, normalizeKeyAndMask} from './shortcut-model.js';

// Group titles and descriptions are Pango markup: translated text and Home Assistant names are escaped.
const escape = text => GLib.markup_escape_text(text, -1);

// Accelerator name of a key press, {pending} while the key is only a modifier, {refused} when the combination may
// not be a shortcut. Normalisation follows GNOME Settings (see normalizeKeyAndMask in shortcut-model.js), in the keyboard
// layout group of the event.
function acceleratorFromPress(display, keyval, keycode, state, group) {
    if (isModifierKey(keyval))
        return {pending: true};
    const defaultMask = Gtk.accelerator_get_default_mod_mask();
    const explicit = defaultMask | Gdk.ModifierType.SHIFT_MASK;
    const translate = shiftMask => {
        const [ok, translated] = display.translate_key(keycode, shiftMask | (state & ~explicit), group);
        return ok ? translated : keyval;
    };
    const {keyval: key, mask} = normalizeKeyAndMask({
        unmodified: translate(0), shifted: translate(Gdk.ModifierType.SHIFT_MASK), mask: state, defaultMask,
    });
    if (!acceleratorAllowed(key, mask))
        return {refused: true};
    return {accel: Gtk.accelerator_name(key, mask)};
}

/**
 * Opens the capture dialog on `parent`. `onResult(accel)` is called once: an accelerator name, or '' to clear.
 * Cancelling calls nothing.
 */
export function captureShortcut(parent, heading, onResult) {
    const page = new Adw.StatusPage({
        icon_name: 'input-keyboard-symbolic',
        title: _('Press a shortcut'),
        description: escape(_('Press Escape to cancel or Backspace to remove the shortcut.')),
    });
    const dialog = new Adw.Dialog({title: heading, content_width: 420, child: page});

    const keys = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    keys.connect('key-pressed', (_c, keyval, keycode, state) => {
        const bare = (state & Gtk.accelerator_get_default_mod_mask()) === 0;
        if (keyval === Gdk.KEY_Escape && bare) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_BackSpace && bare) {
            dialog.close();
            onResult('');
            return Gdk.EVENT_STOP;
        }
        const press = acceleratorFromPress(dialog.get_display(), keyval, keycode, state, keys.get_group());
        if (press.pending)
            return Gdk.EVENT_STOP;
        if (press.refused) {
            page.set_description(escape(_('Use Ctrl, Alt or Super with the key, or one of F1 to F24.')));
            page.add_css_class('error');
            return Gdk.EVENT_STOP;
        }
        dialog.close();
        onResult(press.accel);
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(keys);
    dialog.present(parent);
    return dialog;
}
