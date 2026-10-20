// Entity states in the person's language. HA sends machine words ("on", "heat", "open"); its frontend shows them
// through HA's own translations, and so does this extension: the translations come from Home Assistant itself
// (WebSocket "frontend/get_translations", category "entity_component"), in the language of the desktop session, and
// the lookup follows the frontend's order (src/common/entity/compute_state_display.ts):
//   component.<domain>.entity_component.<device_class>.state.<state>, then component.<domain>.entity_component._.state.<state>.
// No word list is written here, so every language Home Assistant is translated into works.
import GLib from 'gi://GLib';

import {localeFromPosix} from './number-format.js';

// The session's language for messages (LANGUAGE, LC_ALL, LC_MESSAGES, LANG) as a BCP 47 tag, or 'en'.
export function sessionLanguage() {
    return localeFromPosix(GLib.get_language_names_with_category('LC_MESSAGES')[0]) ?? 'en';
}

// Tags to ask Home Assistant for, most specific first: "pt-BR" -> pt-BR, pt-Latn, pt; "zh-TW" -> zh-TW, zh-Hant, zh;
// "sr-Latn-RS" -> sr-RS, sr-Latn, sr. Home Assistant names some languages by region (pt-BR, en-GB) and some by script
// (zh-Hans, zh-Hant, sr-Latn); the script comes from the locale data (Intl.Locale.maximize), never from a table here.
export function languageCandidates(tag) {
    let locale;
    try {
        locale = new Intl.Locale(tag);
    } catch (_e) {
        return ['en'];
    }
    const {language, region} = locale;
    const script = locale.script ?? locale.maximize().script;
    return [...new Set([
        ...region ? [`${language}-${region}`] : [],
        ...script ? [`${language}-${script}`] : [],
        language,
    ])];
}

// Only the state texts are compared: HA may add integration titles of its own to any answer.
function differs(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => k.includes('.state.')));
    for (const key of keys) {
        if (a[key] !== b[key])
            return true;
    }
    return false;
}

// Translations of the states of `domains`, for the first candidate Home Assistant really has. HA answers a language it
// does not know with its English text, so a candidate whose answer is the English one is skipped; when none differs,
// the English text is used (it is also the answer for English itself).
export async function fetchStateNames(client, domains, tag = sessionLanguage()) {
    if (domains.length === 0)
        return {};
    const fetch = async language => (await client.call({type: 'frontend/get_translations', language,
        category: 'entity_component', integration: domains}))?.resources ?? {};
    const english = await fetch('en');
    for (const candidate of languageCandidates(tag)) {
        if (candidate === 'en')
            return english;
        const resources = await fetch(candidate);
        if (differs(resources, english))
            return resources;
    }
    return english;
}

// The translated state of `entityId`, or null when Home Assistant has no translation for it (a template's own text, a
// number, an unknown state word).
export function stateName(names, entityId, state) {
    if (!state || !names)
        return null;
    const domain = entityId.split('.')[0];
    const deviceClass = state.attributes?.device_class;
    const keys = [
        ...deviceClass ? [`component.${domain}.entity_component.${deviceClass}.state.${state.state}`] : [],
        `component.${domain}.entity_component._.state.${state.state}`,
    ];
    for (const key of keys) {
        if (typeof names[key] === 'string' && names[key])
            return names[key];
    }
    return null;
}
