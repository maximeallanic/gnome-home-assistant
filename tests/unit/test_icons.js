// mdi: icons: cache, shipped icons, not-found memory, transport errors, downloads turned off. No network.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {eq, runAsync} from './assert.js';
import {tempDir, cleanTempDirs} from './tmpdir.js';
import {Icons, mdiName} from '../../extension/home-assistant@maximeallanic.github.io/icons.js';

const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));

// Fake session: the message is never sent, its status stays != 200 (like a 404).
class FakeSession {
    constructor() {
        this.requests = 0;
    }

    send_and_read_async(_msg, _prio, _cancellable, callback) {
        this.requests++;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => (callback(this, null), GLib.SOURCE_REMOVE));
    }

    send_and_read_finish() {
        return new GLib.Bytes(new TextEncoder().encode('Not found'));
    }

    abort() {}
}

// Session whose transport fails (network down): send_and_read_finish throws.
class OfflineSession extends FakeSession {
    send_and_read_finish() {
        throw new GLib.Error(Gio.ResolverError, Gio.ResolverError.TEMPORARY_FAILURE, 'network down');
    }
}

runAsync('icons', async () => {
    eq(mdiName('mdi:walk'), 'walk', 'mdi name');
    eq(mdiName('hass:walk'), null, 'other prefix');
    eq(mdiName(null), null, 'no icon');
    eq(mdiName('mdi:../x'), null, 'invalid name');

    const cacheDir = tempDir();
    const session = new FakeSession();
    const icons = new Icons({cacheDir, session});
    GLib.file_set_contents(`${cacheDir}/walk-symbolic.svg`, '<svg/>');
    let got;
    icons.lookup('mdi:walk', g => (got = g));
    eq(got instanceof Gio.FileIcon && got.get_file().get_path().endsWith('walk-symbolic.svg'), true, 'disk cache, sync');
    eq(session.requests, 0, 'cache -> no request');

    let absent = 'not called';
    icons.lookup('mdi:does-not-exist', g => (absent = g));
    await wait(100);
    eq(absent, null, '404 -> null');
    icons.lookup('mdi:does-not-exist', g => (absent = g));
    await wait(100);
    eq(session.requests, 1, 'not found is remembered');
    icons.destroy();

    // Icons shipped with the extension: served without network or cache.
    const shippedDir = tempDir();
    GLib.file_set_contents(`${shippedDir}/home-off-symbolic.svg`, '<svg/>');
    const offline = new OfflineSession();
    const icons2 = new Icons({cacheDir: tempDir(), session: offline, shippedDir});
    let off;
    icons2.lookup('mdi:home-off', g => (off = g));
    eq(off?.get_file?.().get_path().startsWith(shippedDir), true, 'shipped icon without network');
    eq(offline.requests, 0, 'shipped -> no request');

    // Transport error: not remembered as not found, tried again at the next request.
    let r1 = 'not called';
    icons2.lookup('mdi:walk', g => (r1 = g));
    await wait(100);
    eq(r1, null, 'network down -> null');
    icons2.lookup('mdi:walk', () => {});
    await wait(100);
    eq(offline.requests, 2, 'network down -> new attempt');
    icons2.destroy();

    // Downloads turned off in the preferences: no request at all.
    const quiet = new FakeSession();
    const icons3 = new Icons({cacheDir: tempDir(), session: quiet, downloads: () => false});
    let r3 = 'not called';
    icons3.lookup('mdi:lightbulb', g => (r3 = g));
    eq([r3, quiet.requests], [null, 0], 'downloads off -> null without request');
    icons3.destroy();
}, cleanTempDirs);
