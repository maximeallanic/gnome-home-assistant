// Numbers as the person reads them: the locale comes from the session (LC_NUMERIC), the digits, separators and the
// space before a unit from that locale's data (Intl / ICU), never from a table written for one language.
// The only thing parsed is HA's wire format: a state that is a plain decimal number ("18.7", "-3", "1200").
import GLib from 'gi://GLib';

const DECIMAL = /^-?\d+(?:\.(\d+))?$/;

// glibc locale modifier naming a script ("latin", "cyrillic", "devanagari") -> its ISO 15924 subtag, through GLib's
// own Unicode script table (GUnicodeScript names are the Unicode script names). Anything else ("euro", "valencia")
// and the placeholder codes (Zyyy common, Zinh inherited, Zzzz unknown) give null: the modifier is dropped.
function scriptSubtag(modifier) {
    const script = GLib.UnicodeScript[String(modifier).toUpperCase()];
    if (typeof script !== 'number')
        return null;
    const n = GLib.unicode_script_to_iso15924(script);
    const code = String.fromCharCode(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    return n === 0 || /^Z/.test(code) ? null : code;
}

// "fr_FR.UTF-8" -> "fr-FR", "sr_RS@latin" -> "sr-Latn-RS", "ks_IN@devanagari" -> "ks-Deva-IN",
// "C"/"POSIX" -> undefined (Intl's default), garbage -> undefined.
export function localeFromPosix(name) {
    const [, base = '', modifier = ''] = /^([^.@]*)(?:\.[^@]*)?(?:@(.*))?$/.exec(String(name ?? '')) ?? [];
    if (base === '' || base === 'C' || base === 'POSIX')
        return undefined;
    const [language, ...rest] = base.split('_');
    const script = modifier ? scriptSubtag(modifier) : null;
    try {
        return Intl.getCanonicalLocales([language, ...script ? [script] : [], ...rest].join('-'))[0];
    } catch (_e) {
        return undefined;
    }
}

let sessionLocale = null;

// The session's LC_NUMERIC, read once: it does not change while the Shell (or the prefs process) runs.
export function numericLocale() {
    if (sessionLocale === null)
        sessionLocale = {value: localeFromPosix(GLib.get_language_names_with_category('LC_NUMERIC')[0])};
    return sessionLocale.value;
}

const formatters = new Map();

function formatter(locale, decimals) {
    const key = `${locale ?? ''}|${decimals}`;
    if (!formatters.has(key)) {
        formatters.set(key, new Intl.NumberFormat(locale,
            {minimumFractionDigits: decimals, maximumFractionDigits: decimals}));
    }
    return formatters.get(key);
}

// HA's decimal text in the locale's digits and separators, with as many decimals as HA sent; null if not a number.
export function formatDecimal(text, locale) {
    const match = DECIMAL.exec(String(text).trim());
    if (!match)
        return null;
    return formatter(locale, match[1]?.length ?? 0).format(Number(match[0]));
}

// HA frontend's blankBeforeUnit (src/common/translations/blank_before_unit.ts): nothing before '°', a space before
// any other unit, and before '%' whatever the locale puts there. HA reads that last one from a list of languages
// (blank_before_percent.ts); here it is the locale's own percent pattern (CLDR), so every language gets its rule.
export function blankBeforeUnit(unit, locale) {
    if (unit === '°')
        return '';
    if (unit === '%') {
        const parts = new Intl.NumberFormat(locale, {style: 'percent'}).formatToParts(0.5);
        const i = parts.findIndex(p => p.type === 'percentSign');
        const before = i > 0 && parts[i - 1].type === 'literal' ? parts[i - 1].value : '';
        return /^\s+$/u.test(before) ? before : '';
    }
    return ' ';
}

export function withUnit(text, unit, locale) {
    return unit ? `${text}${blankBeforeUnit(unit, locale)}${unit}` : text;
}

// A state shown with its unit: the number is formatted only when the whole state is a number and HA gives it a unit
// (a measurement). Anything else — an address, a version, a word — is left exactly as HA wrote it.
export function formatState(state, unit, locale) {
    const text = String(state);
    if (!unit)
        return text;
    return withUnit(formatDecimal(text, locale) ?? text, unit, locale);
}
