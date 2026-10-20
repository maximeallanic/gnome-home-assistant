// Settings of the extension that are not secret (pure logic, no gi://): the Home Assistant URL and the label names
// that tell the extension what to show. The access token is never here: it lives in the keyring (credentials.js).

// Defaults of the schema, repeated for callers that have no Gio.Settings (tests, the HA package generator).
export const DEFAULT_LABELS = Object.freeze({topbar: 'gnome-topbar', alert: 'gnome-topbar-alert', grid: 'gnome-grid'});

// "https://ha.example.org:8123/" -> "https://ha.example.org:8123". null when it is not an http(s) URL with a host.
export function normalizeUrl(text) {
    const url = String(text ?? '').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i.test(url) ? url : null;
}

// Label names compare like Home Assistant shows them: case-insensitive, surrounding blanks ignored.
export function normalizeLabel(text, fallback) {
    const name = String(text ?? '').trim().toLowerCase();
    return name === '' ? fallback : name;
}

// The label names from the settings (a Gio.Settings, or any object with get_string).
export function readLabels(settings) {
    return {
        topbar: normalizeLabel(settings.get_string('topbar-label'), DEFAULT_LABELS.topbar),
        alert: normalizeLabel(settings.get_string('alert-label'), DEFAULT_LABELS.alert),
        grid: normalizeLabel(settings.get_string('grid-label'), DEFAULT_LABELS.grid),
    };
}

// label_id of the label called `name` in HA's label registry, or null.
export function labelId(labels, name) {
    return labels.find(l => String(l.name ?? '').trim().toLowerCase() === name)?.label_id ?? null;
}
