// Prints the Home Assistant package the preferences generate, for a sample computer called "My Computer" whose
// sensors got the entity ids Home Assistant gives by default. Writes ha/packages/gnome_computer.example.yaml when
// run by scripts/update-examples.sh. Run: gjs -m scripts/example-package.js
import {buildPackage} from '../extension/home-assistant@maximeallanic.github.io/companion/ha-package.js';

export const SAMPLE = {
    deviceName: 'My Computer',
    notifyService: 'mobile_app_my_computer',
    notifyVerified: true,
    entities: Object.fromEntries(['volume', 'muted', 'brightness', 'keyboard_backlight', 'do_not_disturb', 'caffeine',
        'theme', 'screen_on', 'last_contact', 'locked', 'battery', 'media']
        .map(uid => [uid, `${['muted', 'do_not_disturb', 'caffeine', 'screen_on', 'locked'].includes(uid)
            ? 'binary_sensor' : 'sensor'}.my_computer_${uid}`])),
};

print(buildPackage(SAMPLE).trimEnd());
