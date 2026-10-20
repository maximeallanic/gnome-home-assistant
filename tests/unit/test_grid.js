// Quick Settings grid contract and the keyboard shortcut model (no gi://).
import {eq, done} from './assert.js';
import {readGrid, trackedGridIds, SliderGuard, gridSnapshot, settingLabel}
    from '../../extension/home-assistant@maximeallanic.github.io/grid.js';
import {resolveShortcut, tileForShortcut, readShortcuts, shortcutLabel, readSnapshot, isModifierKey, acceleratorAllowed,
    withShortcut, splitShortcuts, normalizeKeyAndMask, parseStoredShortcuts, shortcutBlocked, conflictKey}
    from '../../extension/home-assistant@maximeallanic.github.io/shortcut-model.js';
import {formatState, numericLocale} from '../../extension/home-assistant@maximeallanic.github.io/number-format.js';

const LABELS = [{label_id: 'gnome_grid', name: 'gnome-grid'}, {label_id: 'gnome_topbar', name: 'gnome-topbar'}];
const GRID = 'gnome-grid';
const reg = (id, name, labels = ['gnome_grid'], icon = null) =>
    ({entity_id: id, name, original_name: null, icon, labels});

// Eight example mini-tiles with fictional states.
const TILES = [
    {id: 'office_light', entity: 'light.office', slider: 'light.office', text: '70 %'},
    {id: 'desk_position', entity: 'sensor.desk_height', action: 'none', text: 'sitting',
        choices: ['button.desk_sit', 'button.desk_stand'],
        slider: 'number.desk_height'},
    {id: 'air_purifier', entity: 'switch.air_purifier', slider: 'number.air_purifier_speed', wide: true, text: ''},
    {id: 'living_room_light', entity: 'light.living_room'},
    {id: 'blinds', entity: 'cover.living_room_blinds', text: 'closed'},
    {id: 'home', entity: 'climate.heater', action: 'none',
        details: ['climate.heater', 'binary_sensor.window_open']},
    {id: 'car', entity: 'sensor.car_battery', action: 'none'},
    {id: 'chores', entity: 'todo.chores', action: 'none', details: ['todo.chores']},
];
const STATES = {
    'light.office': {state: 'on', attributes: {brightness: 178, friendly_name: 'Office'}},
    'sensor.desk_height': {state: '69.9', attributes: {unit_of_measurement: 'cm'}},
    'number.desk_height': {state: '69.9', attributes: {min: 63.5, max: 123, step: 0.1}},
    'button.desk_sit': {state: 'unknown', attributes: {friendly_name: '1 · Sit'}},
    'button.desk_stand': {state: 'unknown', attributes: {friendly_name: 'Stand'}},
    'switch.air_purifier': {state: 'off', attributes: {}},
    'number.air_purifier_speed': {state: 'unavailable', attributes: {}},
    'light.living_room': {state: 'off', attributes: {}},
    'cover.living_room_blinds': {state: 'closed', attributes: {current_position: 0}},
    'climate.heater': {state: 'heat', attributes: {}},
    'sensor.car_battery': {state: '80', attributes: {unit_of_measurement: '%'}},
    'todo.chores': {state: '3', attributes: {}},
};
const grid = (tiles, states = STATES, extra = {}) => readGrid(
    [reg('sensor.home_grid', '1 · Home Grid', ['gnome_grid'], 'mdi:home')], LABELS,
    {'sensor.home_grid': {state: 'Office light on', attributes: {tiles, ...extra}}, ...states}, GRID);
// One-tile helper: returns the first tile for a given entity and state.
const one = (tile, states) => grid([tile], {...STATES, ...states}).tiles[0];

// readGrid
eq(readGrid([reg('sensor.x', 'X', [])], LABELS, {}, GRID), null, 'readGrid_absent no entity');
eq(readGrid([reg('sensor.x', 'X')], [], {}, GRID), null, 'readGrid_absent no label');
const g = grid(TILES);
eq([g.entityId, g.name, g.icon, g.subtitle, g.errors], ['sensor.home_grid', 'Home Grid', 'mdi:home', 'Office light on', []], 'readGrid_native header');
eq(g.tiles.map(t => t.id), TILES.map(t => t.id), 'readGrid_native order');
eq(g.tiles.length, 8, 'readGrid_native count');
eq(g.tiles.find(t => t.id === 'air_purifier').wide, true, 'readGrid_native air_purifier wide');
eq(g.tiles.find(t => t.id === 'living_room_light').wide, false, 'readGrid_native not wide');
eq(JSON.stringify(grid(JSON.stringify(TILES))), JSON.stringify(g), 'readGrid_json_string');
const broken = grid('[{"id": ');
eq([broken.tiles, broken.errors], [[], ['unreadable']], 'readGrid_broken_json');
eq(grid({id: 'a'}).errors, ['unreadable'], 'readGrid_not_a_list');
const noAttr = readGrid([reg('sensor.g', 'G')], LABELS, {'sensor.g': {state: 'x', attributes: {}}}, GRID);
eq([noAttr.tiles, noAttr.errors], [[], ['unreadable']], 'readGrid_no_attribute');
const dup = grid([{id: 'a', entity: 'light.office'}, {id: 'a', entity: 'light.living_room'}]);
eq([dup.tiles.map(t => t.entityId), dup.errors], [['light.office'], ['duplicate-id:a']], 'readGrid_duplicate_id');
const miss = grid([{id: 'a', entity: 'light.office'}, {id: 'b', entity: 'light.living_room'}, {id: 'c'}, 'oops', {entity: 'light.x'}]);
eq([miss.tiles.map(t => t.id), miss.errors], [['a', 'b'], ['missing-key:2', 'missing-key:3', 'missing-key:4']], 'readGrid_missing_key');
const two = readGrid(
    [reg('sensor.b', '2 · B'), reg('sensor.a', '1 · A')], LABELS,
    {'sensor.b': {state: 'B', attributes: {tiles: []}}, 'sensor.a': {state: 'A', attributes: {tiles: [{id: 'x', entity: 'light.office'}]}}}, GRID);
eq([two.entityId, two.name, two.tiles.length, two.errors], ['sensor.a', 'A', 1, ['multiple-grids']], 'readGrid_two_grids');
eq(readGrid([reg('sensor.g', 'G')], LABELS, {'sensor.g': {state: 'unavailable', attributes: {tiles: []}}}, GRID).subtitle, '', 'subtitle unavailable');

// look
for (const [state, look] of [['on', 'active'], ['off', 'inactive'], ['unavailable', 'unavailable'], ['unknown', 'unavailable'],
    ['open', 'active'], ['closed', 'inactive'], ['heat', 'active'], ['69.9', 'inactive']])
    eq(one({id: 'a', entity: 'x.y'}, {'x.y': {state, attributes: {}}}).look, look, `look_${state}`);
eq(one({id: 'a', entity: 'todo.t'}, {'todo.t': {state: '3', attributes: {}}}).look, 'active', 'look_todo_3');
eq(one({id: 'a', entity: 'todo.t'}, {'todo.t': {state: '0', attributes: {}}}).look, 'inactive', 'look_todo_0');
eq(one({id: 'a', entity: 'sensor.t'}, {'sensor.t': {state: '69.9', attributes: {}}}).look, 'inactive', 'look_sensor');
eq(one({id: 'a', entity: 'sensor.ghost'}).look, 'unavailable', 'look_no_state');
// missing (error shown): an entity HA does not know is "not found", an unavailable one is not
eq(one({id: 'a', entity: 'sensor.ghost'}).missing, true, 'missing_no_state');
eq(one({id: 'a', entity: 'x.y'}, {'x.y': {state: 'unavailable', attributes: {}}}).missing, false, 'missing_unavailable_is_not');
eq(grid(TILES).tiles.every(t => t.missing === false), true, 'missing_false_when_known');
eq(shortcutLabel(one({id: 'a', entity: 'sensor.ghost', name: 'Ghost'}), 'Not found'), 'Ghost · Not found',
    'shortcutLabel_missing_says_not_found');
// pending: the grid entity is in the registry, its state has not arrived (first connection)
const pend = readGrid([reg('sensor.home_grid', 'Home', ['gnome_grid'], 'mdi:home')], LABELS, {}, GRID);
eq([pend.pending, pend.errors, pend.tiles, pend.name], [true, [], [], 'Home'], 'readGrid_pending_no_error');
eq(grid(TILES).pending, false, 'readGrid_not_pending');
// HA has answered for the grid entity and it has no state: a failure, shown (error shown), never pending
const gone = readGrid([reg('sensor.home_grid', 'Home', ['gnome_grid'], 'mdi:home')], LABELS, {}, GRID,
    new Set(['sensor.home_grid']));
eq([gone.pending, gone.errors, gone.tiles, gone.name, gone.subtitle], [false, ['no-state', 'unreadable'], [], 'Home', ''],
    'readGrid_answered_no_state_is_error');
eq(readGrid([reg('sensor.home_grid', 'Home')], LABELS, {}, GRID, new Set(['light.other'])).pending, true,
    'readGrid_other_ids_answered_still_pending');
eq(trackedGridIds(pend), ['sensor.home_grid'], 'trackedIds_pending_grid_entity_only');
eq(grid(TILES).tiles.find(t => t.id === 'desk_position').choices.map(c => c.available), [true, true],
    'choice_available_unknown_button');

// action
const act = (tile, id) => one({id: 'a', ...tile}, {[id]: {state: 'off', attributes: {}}}).action;
eq(act({entity: 'light.x'}, 'light.x'), {domain: 'homeassistant', service: 'toggle', entityId: 'light.x'}, 'action_light');
eq(act({entity: 'cover.x'}, 'cover.x'), {domain: 'cover', service: 'toggle', entityId: 'cover.x'}, 'action_cover');
eq(act({entity: 'button.x'}, 'button.x'), {domain: 'button', service: 'press', entityId: 'button.x'}, 'action_button');
eq(act({entity: 'light.x', action: 'none'}, 'light.x'), null, 'action_none');
eq(act({entity: 'sensor.x'}, 'sensor.x'), null, 'action_sensor');
eq(act({entity: 'sensor.x', action: 'script.go'}, 'sensor.x'), {domain: 'script', service: 'turn_on', entityId: 'script.go'}, 'action_other_entity');

// setting
const heightTile = g.tiles.find(t => t.id === 'desk_position');
eq(heightTile.setting, {entityId: 'number.desk_height', kind: 'number', min: 63.5, max: 123, step: 0.1, value: 69.9}, 'setting_number');
eq(g.tiles[0].setting, {entityId: 'light.office', kind: 'brightness', min: 0, max: 100, step: 1, value: 70}, 'setting_brightness');
eq(one({id: 'a', entity: 'light.living_room', slider: 'light.living_room'}).setting.value, 0, 'setting_light_off');
eq(one({id: 'a', entity: 'cover.living_room_blinds', slider: 'cover.living_room_blinds'}, {'cover.living_room_blinds': {state: 'open', attributes: {current_position: 40}}}).setting,
    {entityId: 'cover.living_room_blinds', kind: 'position', min: 0, max: 100, step: 1, value: 40}, 'setting_cover');
eq(one({id: 'a', entity: 'light.office', slider: 'sensor.desk_height'}).setting, null, 'setting_other_domain');
// An entity HA cannot read has no value: the slider must not show an invented minimum.
eq(g.tiles.find(t => t.id === 'air_purifier').setting.value, null, 'setting_unavailable_value_null');
eq(one({id: 'a', entity: 'light.office', slider: 'number.x'}, {'number.x': {state: 'unknown', attributes: {min: 62}}}).setting.value,
    null, 'setting_unknown_value_null');
eq(one({id: 'a', entity: 'light.office', slider: 'cover.gone'}).setting.value, null, 'setting_missing_value_null');
eq(one({id: 'a', entity: 'light.office', slider: 'light.x'}, {'light.x': {state: 'unavailable', attributes: {}}}).setting.value,
    null, 'setting_light_unavailable_value_null');

// text, name, icon, choices, details, hasDetail
eq(heightTile.text, 'sitting', 'text_key');
// Fallback text: HA's state with its unit, in the session's LC_NUMERIC (each locale is covered in test_chips.js).
eq(g.tiles.find(t => t.id === 'car').text, formatState('80', '%', numericLocale()), 'text_formatted_state');
eq(one({id: 'a', entity: 'sensor.desk_height'}).text, formatState('69.9', 'cm', numericLocale()), 'text_decimal_locale');
eq(g.tiles.find(t => t.id === 'air_purifier').text, '', 'text_empty_string');
eq(g.tiles.find(t => t.id === 'air_purifier').name, 'switch.air_purifier', 'name_fallback_entity_id');
eq(g.tiles[0].name, 'Office', 'name_friendly');
eq(one({id: 'a', entity: 'light.office', name: 'My name'}).name, 'My name', 'name_key');
eq(one({id: 'a', entity: 'light.office', icon: 'mdi:desk'}).icon, 'mdi:desk', 'icon_key');
eq(heightTile.choices.map(c => [c.entityId, c.name, c.service.service]),
    [['button.desk_sit', 'Sit', 'press'], ['button.desk_stand', 'Stand', 'press']], 'choices');
// choix entries as {entite, nom}: nom names the button; without nom, the HA name stays.
const named = grid([{id: 'r', entity: 'cover.living_room_blinds', action: 'none',
    choices: [{entity: 'script.open_blinds', name: 'Open'}, {entity: 'Script.Close_Blinds', name: 'Close'}]}],
{...STATES, 'script.open_blinds': {state: 'off', attributes: {friendly_name: 'Blinds - Open'}}});
eq([named.tiles[0].choices.map(c => [c.entityId, c.name, c.service.service]), named.errors],
    [[['script.open_blinds', 'Open', 'turn_on'], ['script.close_blinds', 'Close', 'turn_on']], []], 'choices_object_with_nom');
eq(one({id: 'a', entity: 'light.office', choices: [{entity: 'button.desk_sit'}]}).choices.map(c => c.name),
    ['Sit'], 'choices_object_without_nom');
eq(one({id: 'a', entity: 'light.office', choices: ['button.desk_stand',
    {entity: 'button.desk_sit', name: 'Seated'}]}).choices.map(c => [c.entityId, c.name]),
[['button.desk_stand', 'Stand'], ['button.desk_sit', 'Seated']], 'choices_mixed');
const badChoice = grid([{id: 'a', entity: 'light.office',
    choices: [{name: 'No entity'}, 'button.desk_sit', 5, {entity: 'sensor.x', name: 'Not pressable'}, null]}]);
eq([badChoice.tiles[0].choices.map(c => c.entityId), badChoice.errors],
    [['button.desk_sit'], ['invalid-choice:a:0', 'invalid-choice:a:2', 'invalid-choice:a:3', 'invalid-choice:a:4']],
    'choices_invalid_reported');
// active: boolean written by HA (e.g. a cover position) -> choice.active; absent = false; anything else reported, button kept.
const activeGrid = grid([{id: 'p', entity: 'sensor.desk_height', action: 'none', choices: [
    {entity: 'button.desk_sit', name: 'Sit', active: true},
    {entity: 'button.desk_stand', name: 'Stand', active: false},
    {entity: 'button.b3', name: 'No active'},
    'button.b4',
    {entity: 'button.b5', name: 'String', active: 'true'},
    {entity: 'button.b6', name: 'Null', active: null}]}]);
eq(activeGrid.tiles[0].choices.map(c => [c.entityId, c.active]),
    [['button.desk_sit', true], ['button.desk_stand', false],
        ['button.b3', false], ['button.b4', false], ['button.b5', false], ['button.b6', false]], 'choices_actif_values');
eq(activeGrid.errors, ['invalid-choice:p:4', 'invalid-choice:p:5'], 'choices_actif_invalid_reported');
eq(typeof activeGrid.tiles[0].choices[0].active, 'boolean', 'choices_actif_boolean');
eq(one({id: 'a', entity: 'light.office', choices: "['button.b1', 'button.b2']"}).choices.map(c => c.entityId),
    ['button.b1', 'button.b2'], 'choices_template_string');
eq(g.tiles.find(t => t.id === 'home').details, ['climate.heater', 'binary_sensor.window_open'], 'details');
eq(g.tiles.map(t => t.hasDetail), [true, true, true, false, false, true, false, true], 'hasDetail');

// air_purifier off
const purifier = grid([{id: 'air_purifier', entity: 'switch.air_purifier', text: ''}]).tiles[0];
eq([purifier.look, purifier.action.service, purifier.text], ['inactive', 'toggle', ''], 'air_purifier_off');

// trackedIds
const tr = trackedGridIds(grid([
    {id: 'a', entity: 'light.office', action: 'script.go', choices: ['button.b1'], slider: 'number.n', details: ['sensor.d', 'Not Valid']},
    {id: 'b', entity: 'Not Valid'}]));
eq(tr.sort(), ['button.b1', 'light.office', 'number.n', 'script.go', 'sensor.d', 'sensor.home_grid'], 'trackedIds_union');
eq(trackedGridIds(g).includes('sensor.home_grid'), true, 'trackedIds_grid');

// shortcuts
const S = {lumiere: {tile: 'office_light', choice: null, accel: '<Super>l'}};
eq(resolveShortcut(S.lumiere, g), {domain: 'homeassistant', service: 'toggle', entityId: 'light.office'}, 'resolveShortcut_tile');
eq(resolveShortcut({tile: 'desk_position', choice: 'button.desk_stand', accel: 'x'}, g),
    {domain: 'button', service: 'press', entityId: 'button.desk_stand'}, 'resolveShortcut_choice');
eq(resolveShortcut({tile: 'nope', choice: null, accel: 'x'}, g), null, 'resolveShortcut_gone tile');
eq(resolveShortcut({tile: 'desk_position', choice: 'button.nope', accel: 'x'}, g), null, 'resolveShortcut_gone choice');
eq(resolveShortcut({tile: 'home', choice: null, accel: 'x'}, g), null, 'resolveShortcut_no_action');
eq(resolveShortcut(S.lumiere, null), null, 'resolveShortcut_no_grid');
eq(tileForShortcut(S.lumiere, g).id, 'office_light', 'tileForShortcut');
eq(tileForShortcut({tile: 'nope', choice: null, accel: 'x'}, g), null, 'tileForShortcut_gone');

// SliderGuard: a held slider ignores the values HA sends back until it is released
const guard = new SliderGuard();
eq(guard.accept(5), true, 'SliderGuard_idle_accepts');
guard.begin();
eq(guard.accept(5), false, 'SliderGuard_held_rejects');
eq(guard.end(7), 7, 'SliderGuard_end_returns_value');
eq(guard.accept(5), true, 'SliderGuard_released_accepts');

// settingLabel: the slider's value, always a number, in an explicit locale
const desk = {entityId: 'number.desk', kind: 'number', min: 63.5, max: 123, step: 0.1, value: 69.9};
const deskStates = {'number.desk': {state: '69.9', attributes: {unit_of_measurement: 'cm'}}};
eq(settingLabel(desk, deskStates, 69.9, 'en-US'), '69.9 cm', 'slider_en_US');
eq(settingLabel(desk, deskStates, 69.9, 'fr-FR'), '69,9 cm', 'slider_fr_FR');
eq(settingLabel(desk, deskStates, 69.9, 'ar-EG'), '٦٩٫٩ cm', 'slider_ar_EG');
eq(settingLabel(desk, deskStates, 70, 'fr-FR'), '70,0 cm', 'slider_local_value_step_decimals');
eq(settingLabel(desk, {'number.desk': {state: '1.20', attributes: {}}}, 1.2, 'fr-FR'), '1,20',
    'slider_no_unit_still_formatted_with_ha_decimals');
const bright = {entityId: 'light.x', kind: 'brightness', min: 0, max: 100, step: 1, value: 70};
eq(settingLabel(bright, {}, 70, 'en-US'), '70%', 'slider_percent_en');
eq(/^70\s%$/u.test(settingLabel(bright, {}, 70, 'fr-FR')), true, 'slider_percent_fr_space');

// gridSnapshot: what the preferences lists (ids, HA names, choices with their HA names)
const snap = gridSnapshot(g);
eq(snap.length, 8, 'snapshot_count');
eq(snap.map(t => t.id), TILES.map(t => t.id), 'snapshot_ids');
eq(snap.find(t => t.id === 'office_light').name, 'Office', 'snapshot_name');
eq(snap.find(t => t.id === 'desk_position').choices,
    [{entityId: 'button.desk_sit', name: 'Sit'},
        {entityId: 'button.desk_stand', name: 'Stand'}], 'snapshot_choices');
eq(snap.find(t => t.id === 'air_purifier').choices, [], 'snapshot_no_choices');
eq(Object.keys(snap[0]), ['id', 'name', 'hasAction', 'choices'], 'snapshot_keys');
// hasAction: 4 of the 8 example tiles say `action: none`; a no-choice shortcut on them would do nothing.
eq(snap.filter(t => !t.hasAction).map(t => t.id), ['desk_position', 'home', 'car', 'chores'],
    'snapshot_hasAction_false_for_none');
eq(snap.find(t => t.id === 'air_purifier').hasAction, true, 'snapshot_hasAction_true');
eq(readSnapshot('[{"id":"a","hasAction":false}]')[0].hasAction, false, 'readSnapshot_hasAction_false');
eq(readSnapshot('[{"id":"a","hasAction":true}]')[0].hasAction, true, 'readSnapshot_hasAction_true');
eq(readSnapshot('[{"id":"a"}]')[0].hasAction, true, 'readSnapshot_hasAction_absent_old_snapshot');
eq(gridSnapshot(null), [], 'snapshot_null_grid');

// readShortcuts: the `shortcuts` key is JSON written by the preferences; anything malformed is dropped, never thrown
eq(readShortcuts('[{"tile":"air_purifier","choice":null,"accel":"<Super><Alt>F9"}]'),
    [{tile: 'air_purifier', choice: null, accel: '<Super><Alt>F9'}], 'readShortcuts_valid');
eq(readShortcuts('[{"tile":"desk_position","choice":"button.b","accel":"<Super>s"}]')[0].choice, 'button.b',
    'readShortcuts_choice');
eq(readShortcuts('[{"tile":"a","accel":"<Super>a"}]')[0].choice, null, 'readShortcuts_choice_missing');
eq(readShortcuts('[{"tile":'), [], 'readShortcuts_broken_json');
eq(readShortcuts('{"tile":"a"}'), [], 'readShortcuts_not_a_list');
eq(readShortcuts('[{"tile":"a"},{"accel":"<Super>a"},{"tile":"","accel":"x"},{"tile":"a","accel":""},null,"x"]'), [],
    'readShortcuts_incomplete');
eq(readShortcuts('[{"tile":"a","choice":5,"accel":"<Super>a"}]'), [], 'readShortcuts_bad_choice');

// shortcutLabel: only HA's name and text, joined by " · "
eq(shortcutLabel(g.tiles.find(t => t.id === 'blinds')), 'cover.living_room_blinds · closed',
    'shortcutLabel_name_text');
eq(shortcutLabel(g.tiles.find(t => t.id === 'air_purifier')), 'switch.air_purifier', 'shortcutLabel_empty_text');
eq(shortcutLabel(one({id: 'a', entity: 'light.x', name: 'مكتب طويل جداً', text: '٧٠٪'}, {'light.x': {state: 'on', attributes: {}}})),
    'مكتب طويل جداً · ٧٠٪', 'shortcutLabel_non_latin');
eq(shortcutLabel(one({id: 'a', entity: 'light.x', name: 'X'}, {'light.x': {state: 'unavailable', attributes: {}}})), 'X',
    'shortcutLabel_unavailable_no_raw_state');

// the preferences helpers
const SUPER = 1 << 26, CTRL = 1 << 2, ALT = 1 << 3, SHIFT = 1;
eq(acceleratorAllowed(0x6c, SUPER), true, 'accel_super_l');
eq(acceleratorAllowed(0x6c, 0), false, 'accel_plain_key_refused');
eq(acceleratorAllowed(0x6c, SHIFT), false, 'accel_shift_only_refused');
eq(acceleratorAllowed(0x6c, SHIFT | CTRL), true, 'accel_ctrl_shift');
eq(acceleratorAllowed(0x6c, ALT), true, 'accel_alt');
eq(acceleratorAllowed(0xffbe, 0), true, 'accel_f1_plain');
eq(acceleratorAllowed(0xffd5, 0), true, 'accel_f24_plain');
eq(acceleratorAllowed(0xffd6, 0), false, 'accel_f25_refused');
eq(acceleratorAllowed(0xffbd, 0), false, 'accel_below_f1_refused');
eq(acceleratorAllowed(0xffe3, CTRL), false, 'accel_modifier_alone_refused');
eq(acceleratorAllowed(0x6c8, SUPER), true, 'accel_non_latin_keyval');
eq(isModifierKey(0xffeb) && !isModifierKey(0x61), true, 'isModifierKey');

eq(readSnapshot('[{"id":"a","name":"A","choices":[{"entityId":"button.x","name":"X"},{"name":"no id"},null]},{"id":""},5]'),
    [{id: 'a', name: 'A', hasAction: true, choices: [{entityId: 'button.x', name: 'X'}]}], 'readSnapshot_drops_bad');
eq(readSnapshot('[{"id":"a"}]'), [{id: 'a', name: 'a', hasAction: true, choices: []}], 'readSnapshot_defaults');
eq(readSnapshot('nope'), [], 'readSnapshot_broken');
eq(readSnapshot('{}'), [], 'readSnapshot_not_list');
eq(readSnapshot(JSON.stringify(gridSnapshot(g))), gridSnapshot(g), 'readSnapshot_roundtrip');

const L = [{tile: 'a', choice: null, accel: '<Super>a'}, {tile: 'a', choice: 'button.x', accel: '<Super>x'}];
eq(withShortcut(L, 'a', null, '<Super>b'), [{tile: 'a', choice: null, accel: '<Super>b'}, L[1]], 'withShortcut_replace_in_place');
eq(withShortcut(L, 'a', 'button.x', null), [L[0]], 'withShortcut_clear');
eq(withShortcut(L, 'b', undefined, '<Super>c').length, 3, 'withShortcut_add');
eq(withShortcut([], 'a', null, ''), [], 'withShortcut_empty_accel');
const SNAP = [{id: 'a', name: 'A', choices: [{entityId: 'button.x', name: 'X'}]}];
eq(splitShortcuts(SNAP, L), {active: L, inactive: []}, 'split_all_active');
eq(splitShortcuts(SNAP, [{tile: 'gone', choice: null, accel: '<Super>g'}, {tile: 'a', choice: 'button.gone', accel: '<Super>h'}, L[0]]),
    {active: [L[0]], inactive: [{tile: 'gone', choice: null, accel: '<Super>g'}, {tile: 'a', choice: 'button.gone', accel: '<Super>h'}]},
    'split_gone_tile_and_choice');
eq(splitShortcuts([], L).active, [], 'split_empty_grid');
const NOACT = [{id: 'a', name: 'A', hasAction: false, choices: [{entityId: 'button.x', name: 'X'}]}];
eq(splitShortcuts(NOACT, L), {active: [L[1]], inactive: [L[0]]}, 'split_no_action_tile_no_choice_inactive');

// shortcutBlocked: no call for what a click could not press
const BS = {...STATES, 'button.desk_stand': {state: 'unavailable', attributes: {}}};
const gb = grid(TILES, {...BS, 'light.living_room': {state: 'unavailable', attributes: {}}});
eq(shortcutBlocked({tile: 'living_room_light', choice: null}, gb), true, 'blocked_unavailable_tile');
eq(shortcutBlocked({tile: 'air_purifier', choice: null}, gb), false, 'blocked_inactive_tile_not_blocked');
eq(shortcutBlocked({tile: 'desk_position', choice: 'button.desk_sit'}, gb), false,
    'blocked_choice_unknown_state_pressable');
eq(shortcutBlocked({tile: 'desk_position', choice: 'button.desk_stand'}, gb), true,
    'blocked_choice_unavailable');
eq(shortcutBlocked({tile: 'gone', choice: null}, gb), true, 'blocked_gone_tile');
const ghostTile = one({id: 'a', entity: 'sensor.ghost', name: 'Ghost'});
eq(shortcutBlocked({tile: 'a', choice: null}, {tiles: [ghostTile]}), true, 'blocked_missing_entity');

// conflictKey: one entry per binding, so a duplicate accelerator flags only the refused entry
eq(conflictKey({tile: 'a', choice: '', accel: '<Super>a'}), '["a",null,"<Super>a"]', 'conflictKey_no_choice');
eq(conflictKey({tile: 'a', choice: 'button.x', accel: '<Super>a'}) !== conflictKey({tile: 'b', choice: null, accel: '<Super>a'}),
    true, 'conflictKey_same_accel_distinct_entries');

// raw pass-through: unknown entries, extra fields, duplicates of other rows, choice '' as no choice
const RAW = [{tile: 'a', choice: '', accel: '<Super>a', extra: 1}, 'weird', {foo: 1},
    {tile: 'z', choice: null, accel: '<Super>z', note: 'keep'}, {tile: 'w', choice: null, accel: '<Super>w'}, null];
eq(withShortcut(RAW, 'a', null, '<Super>b'), [{tile: 'a', choice: null, accel: '<Super>b'}, ...RAW.slice(1)], 'withShortcut_raw_set');
eq(withShortcut(RAW, 'a', null, null), RAW.slice(1), 'withShortcut_raw_clear');
eq(withShortcut(RAW, 'z', null, '<Super>x')[3], {tile: 'z', choice: null, accel: '<Super>x'}, 'withShortcut_replaces_in_place');
eq(withShortcut([...RAW, {tile: 'a', choice: null, accel: '<Super>dup'}], 'a', null, '<Super>b').length, RAW.length,
    'withShortcut_collapses_matching_duplicates');
eq(withShortcut(RAW, 'q', null, '<Super>q').slice(0, 6), RAW, 'withShortcut_add_keeps_all');
eq(withShortcut(RAW, 'q', null, '<Super>q')[6], {tile: 'q', choice: null, accel: '<Super>q'}, 'withShortcut_add_appends');
eq(parseStoredShortcuts('[1]'), [1], 'parseStored_array');
eq(parseStoredShortcuts('{"a":1}'), null, 'parseStored_object');
eq(parseStoredShortcuts('oops'), null, 'parseStored_broken');

// normalizeKeyAndMask (rules of GNOME Settings' shortcut editor)
const DM = CTRL | ALT | SUPER | (1 << 28);   // default modifier mask, without Shift
eq(normalizeKeyAndMask({unmodified: 0x6c, shifted: 0x4c, mask: CTRL | SHIFT, defaultMask: DM}),
    {keyval: 0x6c, mask: CTRL | SHIFT}, 'normalize_ctrl_shift_l_keeps_shift');
eq(normalizeKeyAndMask({unmodified: 0x6c, shifted: 0x4c, mask: SUPER | SHIFT, defaultMask: DM}),
    {keyval: 0x6c, mask: SUPER | SHIFT}, 'normalize_super_shift_l_keeps_shift');
eq(normalizeKeyAndMask({unmodified: 0x26, shifted: 0x31, mask: SHIFT, defaultMask: DM}),
    {keyval: 0x31, mask: SHIFT}, 'normalize_azerty_shift_1_is_digit');
eq(normalizeKeyAndMask({unmodified: 0x26, shifted: 0x31, mask: SUPER, defaultMask: DM}),
    {keyval: 0x31, mask: SUPER}, 'normalize_azerty_num_row_digit');
eq(normalizeKeyAndMask({unmodified: 0x6cc, shifted: 0x6ec, mask: SUPER, defaultMask: DM}),
    {keyval: 0x6cc, mask: SUPER}, 'normalize_cyrillic_stays');
eq(acceleratorAllowed(0x6cc, SUPER), true, 'cyrillic_allowed');
eq(normalizeKeyAndMask({unmodified: 0x6c, shifted: 0x4c, mask: SUPER | (1 << 1), defaultMask: DM}).mask, SUPER,
    'normalize_drops_caps_lock');
eq(normalizeKeyAndMask({unmodified: 0xfe20, shifted: 0xfe20, mask: ALT, defaultMask: DM}).keyval, 0xff09, 'normalize_left_tab');
eq(normalizeKeyAndMask({unmodified: 0xff15, shifted: 0xff15, mask: ALT, defaultMask: DM}).keyval, 0xff61, 'normalize_sysrq_alt');
eq(normalizeKeyAndMask({unmodified: 0xff15, shifted: 0xff15, mask: CTRL, defaultMask: DM}).keyval, 0xff15, 'normalize_sysrq_kept');

done('grid');
