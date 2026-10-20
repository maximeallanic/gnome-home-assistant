// Grid contract (HA -> extension): pure logic, no gi:// and no Shell, testable with gjs -m.
// One entity carrying the grid label has a `tiles` attribute describing the mini-tiles; HA writes every text, the
// extension only displays. Errors are codes, never sentences (the UI translates).
import {labelId} from './config.js';
import {
    domainOf, displayName, compareNames, entityStateText, readIdList, rawName,
    TOGGLEABLE_DOMAINS, ACTION_SERVICES, EMPTY_STATES, VALID_ENTITY_ID,
} from './chips.js';
import {formatDecimal, withUnit} from './number-format.js';

const ACTIVE_STATES = ['on', 'open', 'opening', 'closing', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
const NO_ACTION = 'none';

/**
 * Types (same registry/state shapes as chips() in chips.js):
 * Service = {domain, service, entityId, data?}
 * Choice  = {entityId, name, service: Service, active, available}
 *           (available: HA has the entity and it is not 'unavailable' — 'unknown' is a button's normal state)
 *           (`choices` entry: an entity_id, or {entity, name?, active?}; `active` is a boolean written by HA)
 * Setting = {entityId, kind: 'number'|'brightness'|'position', min, max, step, value: number|null}
 *           (value null: the entity is missing, unavailable or unknown — nothing to show)
 * Tile    = {id, entityId, name, icon, text, look: 'active'|'inactive'|'unavailable', missing, action: Service|null,
 *            wide, choices: Choice[], setting: Setting|null, details: string[], hasDetail}
 *           (missing: HA has no state for `entity` — an unknown entity, shown "Not found")
 * Grid    = {entityId, name, icon, subtitle, tiles: Tile[], errors: string[], pending}
 *           (pending: HA has not answered yet for the grid entity's state — nothing to show, nothing wrong;
 *            answered and still missing: errors 'no-state' + 'unreadable')
 */

function normalizeId(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// `tiles` is a native list or a JSON string rendered by a template; nothing else is accepted.
function parseTiles(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value !== 'string')
        return null;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch (_e) {
        return null;
    }
}

export function serviceFor(entityId) {
    const d = domainOf(entityId);
    if (TOGGLEABLE_DOMAINS.includes(d))
        return {domain: 'homeassistant', service: 'toggle', entityId};
    if (d in ACTION_SERVICES)
        return {domain: d, service: ACTION_SERVICES[d], entityId};
    return null;
}

function lookOf(entityId, state) {
    if (!state)
        return 'unavailable';
    const value = String(state.state).trim().toLowerCase();
    if (EMPTY_STATES.includes(value))
        return 'unavailable';
    if (ACTIVE_STATES.includes(value))
        return 'active';
    if (domainOf(entityId) === 'todo' && Number(value) > 0)
        return 'active';
    return 'inactive';
}

function numberOr(value, fallback) {
    const n = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(n) ? fallback : n;
}

function settingFor(entityId, state) {
    const attrs = state?.attributes ?? {};
    const value = String(state?.state ?? '');
    const empty = !state || EMPTY_STATES.includes(value.trim().toLowerCase());
    switch (domainOf(entityId)) {
    case 'number':
    case 'input_number':
        return {
            entityId, kind: 'number',
            min: numberOr(attrs.min, 0), max: numberOr(attrs.max, 100), step: numberOr(attrs.step, 1),
            value: empty ? null : numberOr(value, null),
        };
    case 'light':
        return {
            entityId, kind: 'brightness', min: 0, max: 100, step: 1,
            value: empty ? null : value === 'on' ? Math.round(numberOr(attrs.brightness, 0) / 2.55) : 0,
        };
    case 'cover':
        return {
            entityId, kind: 'position', min: 0, max: 100, step: 1,
            value: empty ? null : numberOr(attrs.current_position, null),
        };
    default:
        return null;
    }
}

// `choices`: a list whose entries are an entity_id or {entity, name, active}, or a string rendered by a template (ids
// only). An entry that is neither, or whose domain cannot be pressed, is reported as `invalid-choice:<tile id>:<index>`
// and dropped. A non-boolean `active` is reported the same way; the button stays, shown as not active.
function readChoices(raw, states, errors) {
    const entries = Array.isArray(raw.choices) ? raw.choices : readIdList(raw.choices);
    const seen = new Set();
    return entries.flatMap((entry, index) => {
        const isObject = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
        const entityId = normalizeId(isObject ? entry.entity : entry);
        if (!isObject && typeof entry === 'string' && entityId === '')
            return [];
        const service = entityId ? serviceFor(entityId) : null;
        if (!service) {
            errors.push(`invalid-choice:${raw.id}:${index}`);
            return [];
        }
        if (seen.has(entityId))
            return [];
        seen.add(entityId);
        const name = isObject && typeof entry.name === 'string' && entry.name
            ? entry.name
            : displayName(states[entityId]?.attributes?.friendly_name ?? entityId);
        const hasActive = isObject && 'active' in entry && entry.active !== undefined;
        if (hasActive && typeof entry.active !== 'boolean')
            errors.push(`invalid-choice:${raw.id}:${index}`);
        const state = states[entityId];
        const available = Boolean(state) && String(state.state).trim().toLowerCase() !== 'unavailable';
        return [{entityId, name, service, active: hasActive && entry.active === true, available}];
    });
}

function readTile(raw, states, registry, errors, stateNames) {
    const entityId = normalizeId(raw.entity);
    const state = states[entityId];
    const attrs = state?.attributes ?? {};
    const actionId = 'action' in raw ? normalizeId(raw.action) : entityId;
    const action = actionId && actionId !== NO_ACTION ? serviceFor(actionId) : null;
    const settingId = normalizeId(raw.slider);
    const setting = settingId ? settingFor(settingId, states[settingId]) : null;
    const choices = readChoices(raw, states, errors);
    const details = readIdList(raw.details);
    return {
        id: raw.id,
        entityId,
        name: typeof raw.name === 'string' && raw.name ? raw.name : displayName(attrs.friendly_name ?? entityId),
        icon: raw.icon || attrs.icon || registry.get(entityId)?.icon || null,
        text: typeof raw.text === 'string' ? raw.text : state ? entityStateText(entityId, state, stateNames) : '',
        look: lookOf(entityId, state),
        missing: !state,
        action,
        wide: raw.wide === true || raw.wide === 'true',
        choices,
        setting,
        details,
        hasDetail: choices.length > 0 || setting !== null || details.length > 0,
    };
}

// gridLabel: the label name chosen in the preferences. answered: ids whose subscription has delivered its first event
// (state-source.js). Without it, a grid entity with no state is pending; with it, that entity's missing state is the
// error 'no-state' (shown as unreadable).
export function readGrid(entities, labels, states, gridLabel, answered = new Set(), stateNames = null) {
    const id = labelId(labels, gridLabel);
    if (!id)
        return null;
    const found = entities
        .filter(e => e.labels?.includes(id))
        .map(e => ({e, raw: rawName(e, states[e.entity_id])}))
        .sort((a, b) => compareNames(a.raw, b.raw));
    if (found.length === 0)
        return null;

    const {e, raw} = found[0];
    const state = states[e.entity_id];
    const errors = found.length > 1 ? ['multiple-grids'] : [];
    // Registries read, the subscription that brings this state has not answered yet (first connection): nothing to
    // say yet, nothing wrong. Once HA has answered, a missing state is a failure, said as such.
    if (!state && !answered.has(e.entity_id)) {
        return {entityId: e.entity_id, name: displayName(raw), icon: e.icon ?? null, subtitle: '', tiles: [], errors: [],
            pending: true};
    }
    const grid = {
        entityId: e.entity_id,
        name: displayName(raw),
        icon: state?.attributes?.icon ?? e.icon ?? null,
        subtitle: !state || EMPTY_STATES.includes(String(state.state).trim().toLowerCase()) ? '' : String(state.state),
        tiles: [],
        errors,
        pending: false,
    };

    if (!state) {
        errors.push('no-state', 'unreadable');
        return grid;
    }
    const list = parseTiles(state.attributes?.tiles);
    if (list === null) {
        errors.push('unreadable');
        return grid;
    }
    const registry = new Map(entities.map(x => [x.entity_id, x]));
    const seen = new Set();
    list.forEach((rawTile, index) => {
        const valid = rawTile && typeof rawTile === 'object' && typeof rawTile.id === 'string' && rawTile.id !== '' &&
            normalizeId(rawTile.entity) !== '';
        if (!valid) {
            errors.push(`missing-key:${index}`);
        } else if (seen.has(rawTile.id)) {
            errors.push(`duplicate-id:${rawTile.id}`);
        } else {
            seen.add(rawTile.id);
            grid.tiles.push(readTile(rawTile, states, registry, errors, stateNames));
        }
    });
    return grid;
}

export function trackedGridIds(grid) {
    const ids = [grid.entityId];
    for (const t of grid.tiles) {
        ids.push(t.entityId, ...t.choices.map(c => c.entityId), ...t.details);
        if (t.action)
            ids.push(t.action.entityId);
        if (t.setting)
            ids.push(t.setting.entityId);
    }
    return [...new Set(ids)].filter(id => VALID_ENTITY_ID.test(id));
}

export const stepDecimals = setting => (String(setting.step).split('.')[1] ?? '').length;

// The label next to a setting's slider. Always a number, so it is always formatted in `locale`, unit or not: the state
// HA sent for a number entity (its decimals), else the value with the step's decimals; '%' for brightness/position.
export function settingLabel(setting, states, value, locale) {
    const state = states[setting.entityId];
    const sent = state?.state;
    const text = setting.kind === 'number' && sent !== undefined && Number(sent) === value
        ? String(sent) : value.toFixed(stepDecimals(setting));
    const unit = setting.kind === 'number' ? state?.attributes?.unit_of_measurement ?? null : '%';
    return withUnit(formatDecimal(text, locale) ?? text, unit, locale);
}

// A slider the user holds owns its value: states HA sends back meanwhile (a desk rising step by step) must not
// move the handle under the finger. Released, the slider follows HA again.
export class SliderGuard {
    constructor() {
        this._held = false;
    }

    begin() {
        this._held = true;
    }

    end(value) {
        this._held = false;
        return value;
    }

    accept(_incoming) {
        return !this._held;
    }
}

// What prefs.js needs to offer mini-tiles and their choices (published in the `grid-snapshot` key).
// hasAction: the tile body does something (no `action: none`), so a shortcut without a choice can do it too.
export function gridSnapshot(grid) {
    return (grid?.tiles ?? []).map(t => ({
        id: t.id,
        name: t.name,
        hasAction: t.action !== null,
        choices: t.choices.map(c => ({entityId: c.entityId, name: c.name})),
    }));
}
