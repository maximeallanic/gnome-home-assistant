// The Home Assistant long-lived access token, stored in the user's keyring through libsecret (Secret Service), never
// in GSettings or in a file. Used by the Shell process (lookup) and by the preferences process (store, clear).
// One item per Home Assistant URL, so switching between two servers does not lose either token.
import Gio from 'gi://Gio';
import Secret from 'gi://Secret';

import {_, format} from './i18n.js';

const SCHEMA = new Secret.Schema('io.github.maximeallanic.HomeAssistant', Secret.SchemaFlags.NONE, {
    url: Secret.SchemaAttributeType.STRING,
});

function wrap(start, finish) {
    return new Promise((resolve, reject) => {
        start((_source, result) => {
            try {
                resolve(finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// The token for `url`, or null when there is none. Rejects when the keyring cannot be reached.
export async function lookupToken(url, cancellable = null) {
    const token = await wrap(cb => Secret.password_lookup(SCHEMA, {url}, cancellable, cb),
        r => Secret.password_lookup_finish(r));
    return token ? token.trim() || null : null;
}

export function storeToken(url, token, cancellable = null) {
    // The label is what keyring managers (Seahorse, KeePassXC...) show for the item.
    const label = format(_('Home Assistant access token for %s'), url);
    return wrap(cb => Secret.password_store(SCHEMA, {url}, Secret.COLLECTION_DEFAULT, label, token, cancellable, cb),
        r => Secret.password_store_finish(r));
}

export function clearToken(url, cancellable = null) {
    return wrap(cb => Secret.password_clear(SCHEMA, {url}, cancellable, cb), r => Secret.password_clear_finish(r));
}

export const isCancelled = e => e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
