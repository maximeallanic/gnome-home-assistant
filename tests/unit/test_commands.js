// Commands sent from Home Assistant: names, parameter validation, refusal while locked.
import {eq, done} from './assert.js';
import {parseCommand, COMMANDS} from '../../extension/home-assistant@maximeallanic.github.io/companion/commands.js';

const p = (m, d, locked = false) => parseCommand(m, d, locked);
eq(Object.keys(COMMANDS).sort(), ['brightness', 'caffeine', 'do_not_disturb', 'keyboard_backlight', 'launch_app',
    'lock', 'media', 'mute', 'open_url', 'screen', 'theme', 'volume', 'volume_down', 'volume_up'], '14 commands');
eq(p('hello', null), null, 'not a command');
eq(p(null, null), null, 'no message');
eq(p('command_volume', {level: 30}), {name: 'volume', params: {level: 30}}, 'volume');
eq(p('command_volume', {level: '50.0'}), {name: 'volume', params: {level: 50}}, 'numbers as strings');
eq(p('command_volume', {level: 30.6}).params, {level: 31}, 'rounded');
for (const [v, name] of [[140, 'above range'], [-1, 'below range'], [null, 'null'], ['', 'empty'], ['abc', 'text']])
    eq('error' in p('command_volume', {level: v}), true, `level ${name}`);
eq('error' in p('command_volume', null), true, 'no data');
eq(p('command_volume_up', {}), {name: 'volume_up', params: {step: 5}}, 'default step');
eq(p('command_volume_down', null), {name: 'volume_down', params: {step: 5}}, 'default step without data');
eq(p('command_volume_down', {step: '10'}).params, {step: 10}, 'step as string');
eq('error' in p('command_volume_up', {step: 0}), true, 'zero step');
eq('error' in p('command_volume_up', {step: 51}), true, 'step too large');
eq(p('command_mute', {state: true}).params, {state: 'on'}, 'boolean state');
eq(p('command_mute', {state: 'False'}).params, {state: 'off'}, 'boolean state as string');
eq(p('command_mute', {state: 'toggle'}).params, {state: 'toggle'}, 'toggle');
eq('error' in p('command_mute', {state: 'maybe'}), true, 'invalid state');
eq('error' in p('command_screen', {state: 'toggle'}), true, 'screen cannot toggle');
eq(p('command_theme', {theme: 'dark'}).params, {theme: 'dark'}, 'theme');
eq('error' in p('command_theme', {theme: 'blue'}), true, 'invalid theme');
eq(p('command_media', {action: 'next'}).params, {action: 'next'}, 'media');
eq('error' in p('command_media', {action: 'stop'}), true, 'invalid media action');
eq(p('command_lock', null), {name: 'lock', params: {}}, 'lock');
eq('error' in p('command_unknown', {}), true, 'unknown');
eq('error' in p('command_constructor', {}), true, 'no inherited property');
eq(p('command_open_url', {url: 'https://a.b/c'}).params, {url: 'https://a.b/c'}, 'https url');
eq('error' in p('command_open_url', {url: 'file:///etc/passwd'}), true, 'non-http url');
eq('error' in p('command_open_url', {url: 'HTTPS://'}), true, 'url without host');
eq('error' in p('command_open_url', {url: 42}), true, 'url not text');
eq(p('command_launch_app', {app: 'org.gnome.Nautilus.desktop'}).params, {app: 'org.gnome.Nautilus.desktop'}, 'launch');
eq('error' in p('command_launch_app', {app: '../x.desktop'}), true, 'app with /');
eq('error' in p('command_launch_app', {app: 'a b.desktop'}), true, 'app with space');
eq('error' in p('command_launch_app', {app: 'firefox'}), true, 'app without .desktop');
eq('refused' in p('command_open_url', {url: 'https://a.b'}, true), true, 'open_url refused while locked');
eq('refused' in p('command_launch_app', {app: 'org.gnome.Nautilus.desktop'}, true), true, 'launch refused locked');
eq('error' in p('command_open_url', {url: 'file:///x'}, true), true, 'invalid wins over locked');
eq(p('command_volume', {level: 10}, true).name, 'volume', 'volume allowed while locked');
done('commands');
