// Translations of the extension's own user-facing strings (source strings are English, catalogues in po/).
// Imports GJS's gettext module rather than extension.js so it works in plain `gjs -m` tests and in prefs.js.
// The domain is bound by GNOME Shell (and by the preferences process) from the "gettext-domain" key of metadata.json.
import Gettext from 'gettext';

export const DOMAIN = 'home-assistant@maximeallanic.github.io';

export const _ = msgid => Gettext.dgettext(DOMAIN, msgid);

// Same msgid in several places that a language may translate differently (gender, case): told apart by context.
export const C_ = (context, msgid) => Gettext.dpgettext(DOMAIN, context, msgid);

// Fills each %s of a translated template in order. A replacer function, so `$&` and the like in a value stay literal.
export function format(template, ...values) {
    let i = 0;
    return template.replace(/%s/g, () => String(values[i++]));
}

// Plural forms follow the rules of each language's catalogue, not English's one/other.
export const ngettext = (singular, plural, n) => Gettext.dngettext(DOMAIN, singular, plural, n);
