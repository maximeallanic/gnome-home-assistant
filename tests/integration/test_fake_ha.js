// The real network code against the fake Home Assistant of tests/fake-ha: the preferences' connection test, HaClient
// authentication, StateSource reading the label and entity registries, and the chips and grid built from them.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {eq, runAsync} from '../unit/assert.js';
import {tempDir, cleanTempDirs} from '../unit/tmpdir.js';
import {HaClient} from '../../extension/home-assistant@maximeallanic.github.io/ha-client.js';
import {StateSource} from '../../extension/home-assistant@maximeallanic.github.io/state-source.js';
import {chips} from '../../extension/home-assistant@maximeallanic.github.io/chips.js';
import {readGrid} from '../../extension/home-assistant@maximeallanic.github.io/grid.js';
import {testConnection} from '../../extension/home-assistant@maximeallanic.github.io/connection-test.js';
import {DEFAULT_LABELS} from '../../extension/home-assistant@maximeallanic.github.io/config.js';
import {fetchStateNames, stateName} from '../../extension/home-assistant@maximeallanic.github.io/state-names.js';

const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const TOKEN = 'fake-token-for-tests';
const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));

async function until(what, test, seconds = 10) {
    for (let i = 0; i < seconds * 20; i++) {
        const value = test();
        if (value)
            return value;
        await wait(50);
    }
    throw new Error(`FAIL timed out waiting for ${what}`);
}

let server = null;

runAsync('tests/integration/test_fake_ha.js', async () => {
    const dir = tempDir();
    const portFile = GLib.build_filenamev([dir, 'port']);
    server = Gio.Subprocess.new(['gjs', '-m', GLib.build_filenamev([HERE, '../fake-ha/server.js']),
        '--port-file', portFile], Gio.SubprocessFlags.STDOUT_SILENCE);
    const port = await until('the fake server', () =>
        GLib.file_test(portFile, GLib.FileTest.EXISTS) &&
        new TextDecoder().decode(GLib.file_get_contents(portFile)[1]).trim());
    const url = `http://127.0.0.1:${port}`;

    // Preferences: Test Connection.
    eq(await testConnection(url, TOKEN), {ok: true, name: 'Demo Home', version: '2026.10.0'}, 'connection ok');
    eq((await testConnection(url, 'wrong')).reason, 'unauthorized', 'connection with a wrong token');
    eq((await testConnection('http://127.0.0.1:1', TOKEN)).reason, 'unreachable', 'connection to nothing');

    // A refused token ends in the 'rejected' state, without retry.
    const refused = new HaClient({url, token: 'wrong'});
    refused.start();
    await until('rejected', () => refused.state === 'rejected');
    refused.stop();

    // The extension's state: chips from the gnome-topbar label, the grid from gnome-grid.
    const client = new HaClient({url, token: TOKEN});
    const source = new StateSource(client, () => DEFAULT_LABELS);
    let last = null;
    source.onChange(d => (last = d));
    source.start();
    client.start();
    const grid = await until('the grid', () => {
        const g = last && readGrid(last.entities, last.labels, last.states, DEFAULT_LABELS.grid, last.answered);
        return g && !g.pending && last.tasks['todo.chores'] ? g : null;
    });
    const shown = chips(last.entities, last.labels, last.states, DEFAULT_LABELS);
    eq(shown.map(c => [c.name, c.text, c.alert]), [['Indoor', '21.4°', false], ['Chores', '2', true]], 'chips');
    eq([grid.name, grid.subtitle, grid.errors], ['Home', 'Lights · Blinds', []], 'grid header');
    eq(grid.tiles.map(t => t.id), ['office_light', 'living_room_light', 'blinds', 'heating', 'chores'], 'tiles');
    eq(last.tasks['todo.chores'].length, 3, 'to-do items');
    // Without a text of its own, a mini-tile shows its state as Home Assistant translates it, in the session language.
    await until('the state translations', () => last.stateNames);
    const tiles = readGrid(last.entities, last.labels, last.states, DEFAULT_LABELS.grid, last.answered,
        last.stateNames).tiles;
    const translated = id => stateName(last.stateNames, id, last.states[id]);
    eq(tiles.map(t => t.text), ['70 %', translated('light.living_room'), translated('cover.living_room_blinds'),
        translated('climate.living_room'), '2 to do'], 'tile texts');
    eq(translated('climate.living_room') !== null, true, 'climate state translated');
    const heat = async tag => stateName(await fetchStateNames(client, ['climate'], tag), 'climate.living_room',
        last.states['climate.living_room']);
    eq([await heat('fr-FR'), await heat('de-DE'), await heat('en-US')], ['Chauffe', 'Heat', 'Heat'],
        'French found, unknown language in English');

    // A service call reaches the fake server and its state change comes back through subscribe_entities.
    await client.call({type: 'call_service', domain: 'homeassistant', service: 'toggle',
        target: {entity_id: 'light.living_room'}});
    await until('the toggled light', () => last.states['light.living_room']?.state === 'on');

    source.stop();
    client.stop();
}, () => {
    server?.send_signal(15);
    server?.wait(null);
    cleanTempDirs();
});
