// Commands received from Home Assistant through the push channel: parsing and validation, pure (no gi://).
// Values often come from an HA template: numbers as strings ("50.0"), booleans as strings ("False").
// Error details end up in the gnome_home_assistant_command event, read by people in HA: translated. Command names,
// parameter names and allowed values belong to the protocol (the HA package): never translated.
import {_, format} from '../i18n.js';

export const COMMAND_PREFIX = 'command_';
export const COMMAND_EVENT = 'gnome_home_assistant_command';

const STATES = {on: 'on', off: 'off', true: 'on', false: 'off', toggle: 'toggle'};

function integer(v, min, max) {
    if (typeof v === 'string' && v.trim() !== '')
        v = Number(v);
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    v = Math.round(v);
    return v >= min && v <= max ? v : null;
}

function oneOf(values) {
    return v => (values.includes(v) ? v : null);
}

const level = d => {
    const n = integer(d.level, 0, 100);
    return n === null ? format(_('%s must be a number from 0 to 100'), 'level') : {level: n};
};
const step = d => {
    if (d.step === undefined || d.step === null)
        return {step: 5};
    const n = integer(d.step, 1, 50);
    return n === null ? format(_('%s must be a number from 1 to 50'), 'step') : {step: n};
};
const onOff = (allowed = ['on', 'off', 'toggle']) => d => {
    const s = STATES[String(d.state).toLowerCase()];
    return allowed.includes(s) ? {state: s} : format(_('%s must be one of %s'), 'state', allowed.join('/'));
};
// error builds the translated message when needed (the gettext domain is bound only once the extension is enabled).
const field = (name, validate, error) => d => {
    const v = validate(d[name]);
    return v === null ? error() : {[name]: v};
};

function httpUrl(v) {
    if (typeof v !== 'string')
        return null;
    return /^https?:\/\/[^\s/]+/i.test(v.trim()) ? v.trim() : null;
}

function desktopId(v) {
    return typeof v === 'string' && /^[^/\s]+\.desktop$/.test(v) ? v : null;
}

const THEMES = ['light', 'dark'];
const MEDIA_ACTIONS = ['play_pause', 'next', 'previous'];

// whenLocked: is the command allowed while the screen is locked?
export const COMMANDS = Object.freeze({
    volume: {params: level, whenLocked: true},
    volume_up: {params: step, whenLocked: true},
    volume_down: {params: step, whenLocked: true},
    mute: {params: onOff(), whenLocked: true},
    brightness: {params: level, whenLocked: true},
    keyboard_backlight: {params: level, whenLocked: true},
    do_not_disturb: {params: onOff(), whenLocked: true},
    caffeine: {params: onOff(), whenLocked: true},
    theme: {params: field('theme', oneOf(THEMES), () => format(_('%s must be one of %s'), 'theme', THEMES.join('/'))),
        whenLocked: true},
    screen: {params: onOff(['on', 'off']), whenLocked: true},
    lock: {params: () => ({}), whenLocked: true},
    media: {params: field('action', oneOf(MEDIA_ACTIONS),
        () => format(_('%s must be one of %s'), 'action', MEDIA_ACTIONS.join('/'))), whenLocked: true},
    open_url: {params: field('url', httpUrl, () => format(_('%s must be an http or https address'), 'url')),
        whenLocked: false},
    launch_app: {params: field('app', desktopId, () => format(_('%s must be a .desktop file ID'), 'app')),
        whenLocked: false},
});

// null: not a command (a notification to show). Otherwise {name, params} | {error} | {refused}.
export function parseCommand(message, data, locked) {
    if (typeof message !== 'string' || !message.startsWith(COMMAND_PREFIX))
        return null;
    const name = message.slice(COMMAND_PREFIX.length);
    if (!Object.hasOwn(COMMANDS, name))
        return {error: format(_('unknown command: %s'), name)};
    const command = COMMANDS[name];
    const params = command.params(data && typeof data === 'object' ? data : {});
    if (typeof params === 'string')
        return {error: params};
    if (locked && !command.whenLocked)
        return {refused: format(_('%s is not allowed while the screen is locked'), name)};
    return {name, params};
}
