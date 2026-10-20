// Home Assistant package generator: snapshot parsing, slugs, and the generated entities.
import {eq, done} from './assert.js';
import {slugify, readCompanionSnapshot, buildPackage}
    from '../../extension/home-assistant@maximeallanic.github.io/companion/ha-package.js';

eq(slugify('My Computer'), 'my_computer', 'slug');
eq(slugify('Ordinateur de Zoé'), 'ordinateur_de_zoe', 'accents dropped like HA');
eq(slugify('  --Work PC 2-- '), 'work_pc_2', 'edges trimmed');
eq(slugify('コンピューター'), '', 'non-Latin name: empty slug (HA transliterates, this cannot)');
eq(readCompanionSnapshot('nope'), null, 'broken JSON');
eq(readCompanionSnapshot('{"deviceName":"A","entities":{}}'), null, 'no notify service');
eq(readCompanionSnapshot('{"deviceName":"A","notifyService":"mobile_app_a","entities":{"volume":"sensor.a_volume",' +
    '"bad":"Not An Id","n":3}}'),
{deviceName: 'A', notifyService: 'mobile_app_a', notifyVerified: false, entities: {volume: 'sensor.a_volume'}},
'invalid entity ids dropped');
eq(buildPackage(null), null, 'no snapshot, no package');

const minimal = buildPackage({deviceName: 'Laptop', notifyService: 'mobile_app_laptop', notifyVerified: true,
    entities: {}});
eq(minimal.includes('state: "{{ false }}"'), true, 'no last_contact: never online');
eq(minimal.includes('- number:'), false, 'no slider without sensors');
eq(minimal.includes('button.laptop_lock'), true, 'buttons always there');
const full = buildPackage({deviceName: 'Laptop', notifyService: 'mobile_app_laptop', notifyVerified: true,
    entities: {volume: 'sensor.laptop_volume', muted: 'binary_sensor.laptop_muted', theme: 'sensor.laptop_theme',
        last_contact: 'sensor.laptop_last_contact'}});
for (const id of ['number.laptop_volume', 'switch.laptop_mute', 'switch.laptop_dark_theme', 'script:',
    'laptop_open_url:', 'laptop_launch_app:', "states('sensor.laptop_last_contact')", 'notify.mobile_app_laptop'])
    eq(full.includes(id), true, `full package has ${id}`);
eq(buildPackage({deviceName: 'コンピューター', notifyService: 'mobile_app_', notifyVerified: false, entities: {}})
    .includes('binary_sensor.computer_online'), true, 'non-Latin name: generic prefix');
done('ha-package');
