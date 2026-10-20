// Top bar contract: number formatting, names, labels, chips, and the menu lines of the grid details.
import {eq, done} from './assert.js';
import {formatEntityState, displayName, compareNames, isHidden, domainOf, readIdList, chips, menuLine,
    trackedChipIds} from '../../extension/home-assistant@maximeallanic.github.io/chips.js';
import {localeFromPosix} from '../../extension/home-assistant@maximeallanic.github.io/number-format.js';

// Formatting: explicit locale in each case (the session's LC_NUMERIC in real use, number-format.js).
const f = formatEntityState;
eq(f('20.4', '°C', 'fr-FR'), '20,4 °C', 'fr with unit');
eq(f('20.4', '°C', 'en-US'), '20.4 °C', 'en with unit');
eq(f('20.4', '°C', 'ar-EG'), '٢٠٫٤ °C', 'ar Arabic-Indic digits');
eq(f('20.4', '°C', 'hi-IN-u-nu-deva'), '२०.४ °C', 'hi Devanagari digits');
eq(f('18.7', '°', 'fr-FR'), '18,7°', 'fr degree without space');
eq(f('18.7', '°', 'en-US'), '18.7°', 'en degree without space');
// The space before "%" comes from CLDR (no-break, narrow or not depending on the ICU version): only its presence.
eq(/^45\s%$/u.test(f('45', '%', 'fr-FR')), true, 'fr percent with locale space');
eq(/^45\s%$/u.test(f('45', '%', 'de-DE')), true, 'de percent with locale space');
eq(f('45', '%', 'en-US'), '45%', 'en percent attached');
eq(f('45', '%', 'ar-EG'), '٤٥%', 'ar percent attached');
eq(f('1.20', 'km', 'fr-FR'), '1,20 km', 'decimals from HA kept');
eq(f('3', 'km', 'en-US'), '3 km', 'integer');
eq(f('1234.5', 'W', 'en-US'), '1,234.5 W', 'en thousands');
eq(f('-3.5', '°C', 'fr-FR'), '-3,5 °C', 'fr negative');
// Nothing else is touched: not a single number, or no unit (text written by a template).
eq(f('192.168.0.1', null, 'fr-FR'), '192.168.0.1', 'address without unit untouched');
eq(f('192.168.0.1', 'x', 'fr-FR'), '192.168.0.1 x', 'address with unit untouched');
eq(f('2026.10.1', null, 'ar-EG'), '2026.10.1', 'version untouched');
eq(f('20.4°', null, 'fr-FR'), '20.4°', 'template text untouched');
eq(f('20.4', null, 'fr-FR'), '20.4', 'number without unit untouched');
eq(f('standing', 'cm', 'fr-FR'), 'standing cm', 'word untouched');
eq(f('3'), '3', 'no unit');
// Session locale: POSIX LC_NUMERIC -> BCP 47 tag; C, POSIX or unreadable -> Intl's default.
eq(localeFromPosix('fr_FR.UTF-8'), 'fr-FR', 'posix fr');
eq(localeFromPosix('en_US'), 'en-US', 'posix en');
eq(localeFromPosix('ar_EG.UTF-8'), 'ar-EG', 'posix ar');
eq(localeFromPosix('sr_RS.UTF-8@latin'), 'sr-Latn-RS', 'posix script modifier');
eq(localeFromPosix('sr_RS@cyrillic'), 'sr-Cyrl-RS', 'posix cyrillic modifier');
eq(localeFromPosix('ks_IN@devanagari'), 'ks-Deva-IN', 'posix devanagari modifier');
eq(localeFromPosix('ca_ES.UTF-8@valencia'), 'ca-ES', 'unknown modifier ignored');
eq(localeFromPosix('de_DE@euro'), 'de-DE', 'euro modifier ignored');
eq(localeFromPosix('C'), undefined, 'posix C');
eq(localeFromPosix('POSIX'), undefined, 'posix POSIX');
eq(localeFromPosix('C.UTF-8'), undefined, 'posix C.UTF-8');
eq(localeFromPosix('anything!'), undefined, 'unreadable');

eq(displayName('1 · Home'), 'Home', 'prefix ·');
eq(displayName('10 - Car'), 'Car', 'prefix -');
eq(displayName('2 · 居間'), '居間', 'prefix before CJK name');
eq(displayName('Maintenance'), 'Maintenance', 'no prefix');
eq(['10 · b', '2 · a', '1 · c'].sort(compareNames), ['1 · c', '2 · a', '10 · b'], 'natural order');
for (const s of ['', '  ', 'unknown', 'Unavailable', 'none'])
    eq(isHidden(s, false), true, `hidden "${s}"`);
eq(isHidden('off', false), true, 'off hidden when not toggleable');
eq(isHidden('off', true), false, 'off shown when toggleable');
eq(isHidden('0', false), false, '0 shown');
eq(isHidden(undefined, false), true, 'no state');
eq(domainOf('todo.chores'), 'todo', 'domain');

eq(readIdList(['a.b', 'c.d', 'a.b']), ['a.b', 'c.d'], 'list with duplicate');
eq(readIdList("['a.b', 'c.d']"), ['a.b', 'c.d'], 'Python-style string');
eq(readIdList('a.b, c.d'), ['a.b', 'c.d'], 'comma-separated string');
eq(readIdList(''), [], 'empty');
eq(readIdList(3), [], 'number');
eq(readIdList(null), [], 'absent');
eq(readIdList(['Sensor.OK', 'binary_sensor.window-open', 'a.b c.d', 'sensor.ok']),
    ['sensor.ok', 'binary_sensor.window-open', 'a.b c.d'], 'ids lower-cased, invalid ones kept');

// Label names are chosen in the preferences; Home Assistant compares them case-insensitively.
const NAMES = {topbar: 'gnome-topbar', alert: 'gnome-topbar-alert', grid: 'gnome-grid'};
const L = [{label_id: 'gnome_topbar', name: 'GNOME-Topbar'}, {label_id: 'gnome_topbar_alert', name: 'gnome-topbar-alert'}];
const E = [
    {entity_id: 'sensor.car', name: '3 · Car', original_name: null, icon: null, labels: ['gnome_topbar']},
    {entity_id: 'sensor.home', name: null, original_name: null, icon: 'mdi:home', labels: ['gnome_topbar']},
    {entity_id: 'sensor.chores', name: '4 · Chores', original_name: null, icon: null,
        labels: ['gnome_topbar', 'gnome_topbar_alert']},
    {entity_id: 'switch.charger', name: '5 · Charger', original_name: null, icon: null, labels: ['gnome_topbar']},
    {entity_id: 'sensor.other', name: 'Other', original_name: null, icon: null, labels: []},
    {entity_id: 'sensor.ghost', name: '9 · Ghost', original_name: null, icon: null, labels: ['gnome_topbar']},
];
const S = {
    'sensor.car': {state: '', attributes: {icon: 'mdi:car-electric'}},
    'sensor.home': {state: '20.4°', attributes: {friendly_name: '1 · Home'}},
    'sensor.chores': {state: '3', attributes: {}},
    'switch.charger': {state: 'off', attributes: {}},
};
const P = chips(E, L, S, NAMES);
eq(P.map(p => p.id), ['sensor.home', 'sensor.car', 'sensor.chores', 'switch.charger', 'sensor.ghost'],
    'order and label filter');
eq(P[0], {id: 'sensor.home', name: 'Home', text: '20.4°', icon: 'mdi:home', alert: false, hidden: false,
    toggleable: false, active: false}, 'home chip');
eq([P[1].hidden, P[1].icon], [true, 'mdi:car-electric'], 'empty state hides the chip, icon kept');
eq(P[2].alert, true, 'alert');
eq([P[3].toggleable, P[3].hidden, P[3].active, P[3].text], [true, false, false, ''], 'toggleable off');
eq(P[4].hidden, true, 'chip without state');
eq(chips(E, [], S, NAMES), [], 'no top bar label -> no chip');
eq(chips(E, L, S, {...NAMES, topbar: 'my-bar'}), [], 'other label name chosen -> no chip');
eq(chips(E, [{label_id: 'x', name: 'my-bar'}], S, {...NAMES, topbar: 'my-bar'}), [], 'custom label on no entity');
eq(trackedChipIds([{id: 'sensor.a'}, {id: 'sensor.b'}, {id: 'sensor.a'}, {id: 'binary_sensor.window-open'},
    {id: 'Température'}]), ['sensor.a', 'sensor.b'], 'invalid ids not tracked, duplicates once');
eq(menuLine('binary_sensor.window-open', {}, {}).type, 'missing', 'invalid id -> missing');
eq(trackedChipIds(P).sort(), ['sensor.car', 'sensor.chores', 'sensor.ghost', 'sensor.home', 'switch.charger'],
    'tracked ids');

const S2 = {...S,
    'script.cool_down': {state: 'off', attributes: {friendly_name: 'Cool down'}},
    'todo.chores': {state: '1', attributes: {friendly_name: 'Chores'}},
    'sensor.range': {state: '108', attributes: {unit_of_measurement: 'km', friendly_name: 'Range'}}};
const T = {'todo.chores': [{uid: 'u1', summary: 'A', description: null, status: 'needs_action'},
    {uid: 'u2', summary: 'B', description: null, status: 'completed'}]};
eq(menuLine('switch.charger', S2, T).type, 'switch', 'switch line');
eq(menuLine('switch.charger', S2, T).on, false, 'switch off');
eq(menuLine('script.cool_down', S2, T).service, {domain: 'script', service: 'turn_on'}, 'action line');
eq(menuLine('todo.chores', S2, T).tasks.map(t => t.uid), ['u1'], 'tasks needing action');
eq(menuLine('todo.chores', S2, {}).tasks, [], 'tasks not received yet');
eq(menuLine('sensor.range', S2, T).text, formatEntityState('108', 'km'), 'value line (session locale)');
eq(menuLine('sensor.range', S2, T).name, 'Range', 'line name');
eq(menuLine('sensor.unknown', S2, T).type, 'missing', 'missing line');
done('chips');
