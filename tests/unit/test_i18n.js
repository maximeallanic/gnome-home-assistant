// Translations: English source strings without a catalogue, then the French catalogue compiled from po/fr.po.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gettext from 'gettext';
import {eq, done} from './assert.js';
import {tempDir, cleanTempDirs} from './tmpdir.js';
import {_, C_, DOMAIN, format, ngettext} from '../../extension/home-assistant@maximeallanic.github.io/i18n.js';
import {parseCommand} from '../../extension/home-assistant@maximeallanic.github.io/companion/commands.js';

try {
    // No domain bound: the English source text.
    eq(_('Not found'), 'Not found', 'no catalogue: msgid');
    eq(C_('OS version', 'unknown'), 'unknown', 'no catalogue: msgid with context');
    eq(parseCommand('command_x', {}, false).error, 'unknown command: x', 'no catalogue: English command detail');
    eq(format('%s / %s', '$&', 2), '$& / 2', 'format: literal values, in order');

    const root = tempDir();
    const moDir = GLib.build_filenamev([root, 'fr', 'LC_MESSAGES']);
    GLib.mkdir_with_parents(moDir, 0o755);
    const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    const po = GLib.build_filenamev([here, '..', '..', 'po', 'fr.po']);
    const proc = Gio.Subprocess.new(['msgfmt', '--check', '-o', GLib.build_filenamev([moDir, `${DOMAIN}.mo`]), po],
        Gio.SubprocessFlags.STDERR_PIPE);
    const [, , err] = proc.communicate_utf8(null, null);
    eq([proc.get_exit_status(), err], [0, ''], 'msgfmt compiles po/fr.po');

    GLib.setenv('LANGUAGE', 'fr', true);
    // glibc ignores LANGUAGE under the C locale: any real UTF-8 locale will do (CI installs locales-all).
    const locale = ['en_US.UTF-8', 'fr_FR.UTF-8', 'de_DE.UTF-8'].find(l => Gettext.setlocale(Gettext.LocaleCategory.ALL, l));
    eq(Boolean(locale), true, 'a UTF-8 locale other than C is installed');
    Gettext.bindtextdomain(DOMAIN, root);
    eq(_('Not found'), 'Introuvable', 'French catalogue');
    eq(_('No tasks'), 'Aucune tâche', 'accents');
    eq(_('Unknown msgid'), 'Unknown msgid', 'msgid not in the catalogue');
    eq(_('Last contact'), 'Dernier contact', 'sensor name');
    eq([C_('device model', 'unknown'), C_('OS version', 'unknown')], ['inconnu', 'inconnue'], 'contexts: different agreement');
    eq(format(ngettext('Registered as “%s”, %s sensor.', 'Registered as “%s”, %s sensors.', 1), 'PC', 1),
        'Enregistré sous « PC », 1 capteur.', 'plural: one');
    eq(format(ngettext('Registered as “%s”, %s sensor.', 'Registered as “%s”, %s sensors.', 0), 'PC', 0),
        'Enregistré sous « PC », 0 capteur.', 'plural: French zero is singular');
    eq(format(ngettext('Registered as “%s”, %s sensor.', 'Registered as “%s”, %s sensors.', 24), 'PC', 24),
        'Enregistré sous « PC », 24 capteurs.', 'plural: many');
    eq(parseCommand('command_volume', {level: 140}, false).error, 'level doit être un nombre de 0 à 100',
        'translated detail, protocol name intact');
    eq(parseCommand('command_open_url', {url: 'https://a.b'}, true).refused,
        'open_url n’est pas permise quand l’écran est verrouillé', 'translated refusal, command name intact');
    eq(parseCommand('command_theme', {theme: 'blue'}, false).error, 'theme doit valoir l’une de ces valeurs : light/dark',
        'protocol values not translated');
} finally {
    cleanTempDirs();
}
done('i18n');
