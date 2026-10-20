// Settings helpers: URL normalisation and label names.
import {eq, done} from './assert.js';
import {normalizeUrl, normalizeLabel, readLabels, labelId, DEFAULT_LABELS}
    from '../../extension/home-assistant@maximeallanic.github.io/config.js';

eq(normalizeUrl(' https://ha.example.org:8123/ '), 'https://ha.example.org:8123', 'trailing slash and blanks');
eq(normalizeUrl('http://192.0.2.10:8123'), 'http://192.0.2.10:8123', 'address with port');
eq(normalizeUrl('https://example.org/ha'), 'https://example.org/ha', 'path kept (reverse proxy)');
eq(normalizeUrl('http://[2001:db8::1]:8123'), 'http://[2001:db8::1]:8123', 'IPv6 literal');
eq(normalizeUrl('https://домой.example'), 'https://домой.example', 'internationalised host');
for (const bad of ['', 'homeassistant.local:8123', 'ftp://x', 'https://', 'https://a b', 'https://x?y=1', null])
    eq(normalizeUrl(bad), null, `rejected ${bad}`);
eq(normalizeLabel('  GNOME-Topbar ', 'x'), 'gnome-topbar', 'label lower-cased and trimmed');
eq(normalizeLabel('   ', 'fallback'), 'fallback', 'empty label falls back');
eq(normalizeLabel('Barre Supérieure', 'x'), 'barre supérieure', 'accents kept');
eq(normalizeLabel('ПАНЕЛЬ', 'x'), 'панель', 'Cyrillic lower-cased');
eq(normalizeLabel('ホーム', 'x'), 'ホーム', 'Japanese unchanged');
const settings = {get_string: key => ({'topbar-label': 'Bar', 'alert-label': '', 'grid-label': 'Grille'})[key]};
eq(readLabels(settings), {topbar: 'bar', alert: DEFAULT_LABELS.alert, grid: 'grille'}, 'readLabels');
eq(labelId([{label_id: 'a', name: ' Bar '}, {label_id: 'b', name: 'grille'}], 'bar'), 'a', 'labelId');
eq(labelId([{label_id: 'a', name: null}], 'bar'), null, 'labelId missing');
done('config');
