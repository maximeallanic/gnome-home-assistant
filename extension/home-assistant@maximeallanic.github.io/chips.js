// Top bar contract (HA -> extension): pure logic, no Shell, testable with gjs -m (the number locale comes from
// number-format.js, which reads LC_NUMERIC through GLib).
// A chip is an entity carrying the top bar label; Home Assistant decides its text and icon. Chips only display:
// what can be switched or run lives in the grid (grid.js), whose details reuse menuLine() below.
import {labelId} from './config.js';
import {formatState, numericLocale} from './number-format.js';
import {stateName} from './state-names.js';

export const TOGGLEABLE_DOMAINS = ['switch', 'input_boolean', 'light', 'fan'];

export const EMPTY_STATES = ['', 'unknown', 'unavailable', 'none'];
// "1 · Home", "2 - Car", "3. Desk": an ordering prefix, removed for display.
const ORDER_PREFIX = /^\s*\d+\s*[·.\-–]\s*/;
// entity_id format accepted by HA (cv.entity_id): one invalid id makes a whole subscribe_entities fail.
export const VALID_ENTITY_ID = /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/;
// Order of the session language (Intl's default locale), digits compared as numbers.
const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

export function domainOf(entityId) {
    return entityId.split('.')[0];
}

// An HA state with its unit: the number is formatted for the locale (LC_NUMERIC) only when the whole state is a number
// with a unit; any other text stays exactly as HA wrote it (number-format.js).
export function formatEntityState(state, unit = null, locale = numericLocale()) {
    return formatState(state, unit, locale);
}

// The text of an entity's state: HA's own translation of the state word when it has one (state-names.js), otherwise
// the state as HA sent it, a number being formatted for the locale.
export function entityStateText(entityId, state, stateNames, locale = numericLocale()) {
    return stateName(stateNames, entityId, state) ??
        formatEntityState(state.state, state.attributes?.unit_of_measurement, locale);
}

export function displayName(name) {
    return name.replace(ORDER_PREFIX, '');
}

export function compareNames(a, b) {
    return collator.compare(a, b);
}

export function isHidden(state, toggleable) {
    if (state === undefined || state === null)
        return true;
    const s = String(state).trim().toLowerCase();
    return EMPTY_STATES.includes(s) || (s === 'off' && !toggleable);
}

export const ACTION_SERVICES = {
    script: 'turn_on',
    scene: 'turn_on',
    button: 'press',
    input_button: 'press',
    cover: 'toggle',
};

/**
 * Types (HA registry and state formats, as kept by state-source.js):
 * Entity = {entity_id, name, original_name, icon, labels: string[]}
 * Label  = {label_id, name}
 * States = {[entity_id]: {state: string, attributes: object}}
 * Tasks  = {[todo_id]: [{uid, summary, description, status}]}
 * Chip   = {id, name, text, icon, alert, hidden, toggleable, active}
 * Line   = {type: 'switch'|'action'|'tasks'|'value'|'missing', id, name, ...}
 */

// A YAML list, or a string rendered by a template ("['a.b', 'c.d']" or "a.b, c.d").
export function readIdList(value) {
    let ids;
    if (Array.isArray(value))
        ids = value.map(String);
    else if (typeof value === 'string')
        ids = value.replace(/[[\]'"]/g, '').split(',');
    else
        return [];
    return [...new Set(ids.map(i => i.trim().toLowerCase()).filter(i => i))];
}

export function rawName(entity, state) {
    return entity.name ?? state?.attributes?.friendly_name ?? entity.original_name ?? entity.entity_id;
}

// names: {topbar, alert}, the label names chosen in the preferences.
export function chips(entities, labels, states, names, stateNames = null) {
    const topbar = labelId(labels, names.topbar);
    const alert = labelId(labels, names.alert);
    if (!topbar)
        return [];
    return entities
        .filter(e => e.labels?.includes(topbar))
        .map(e => ({e, state: states[e.entity_id], raw: rawName(e, states[e.entity_id])}))
        .sort((a, b) => compareNames(a.raw, b.raw))
        .map(({e, state, raw}) => {
            const toggleable = TOGGLEABLE_DOMAINS.includes(domainOf(e.entity_id));
            const attrs = state?.attributes ?? {};
            return {
                id: e.entity_id,
                name: displayName(raw),
                text: !state || toggleable ? '' : entityStateText(e.entity_id, state, stateNames),
                icon: attrs.icon ?? e.icon ?? null,
                alert: alert !== null && e.labels.includes(alert),
                hidden: isHidden(state?.state, toggleable),
                toggleable,
                active: state?.state === 'on',
            };
        });
}

export function trackedChipIds(list) {
    // Entity ids come from the registry, but an invalid one would make the whole subscribe_entities fail.
    return [...new Set(list.map(c => c.id))].filter(id => VALID_ENTITY_ID.test(id));
}

export function menuLine(id, states, tasks, stateNames = null) {
    const state = states[id];
    const d = domainOf(id);
    const name = displayName(state?.attributes?.friendly_name ?? id);
    if (!state)
        return {type: 'missing', id, name};
    if (TOGGLEABLE_DOMAINS.includes(d))
        return {type: 'switch', id, name, on: state.state === 'on'};
    if (d in ACTION_SERVICES)
        return {type: 'action', id, name, service: {domain: d, service: ACTION_SERVICES[d]}};
    if (d === 'todo')
        return {type: 'tasks', id, name, tasks: (tasks[id] ?? []).filter(t => t.status === 'needs_action')};
    return {type: 'value', id, name, text: entityStateText(id, state, stateNames)};
}
