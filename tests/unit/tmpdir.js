// Temporary directories for the tests, removed at the end (a few small files each).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const made = [];

export function tempDir(name = 'gnome-ha-test') {
    const dir = GLib.dir_make_tmp(`${name}-XXXXXX`);
    made.push(dir);
    return dir;
}

function removeTree(file) {
    const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let child = children.next_file(null); child; child = children.next_file(null))
            removeTree(file.get_child(child.get_name()));
    }
    file.delete(null);
}

export function cleanTempDirs() {
    for (const dir of made.splice(0)) {
        if (GLib.file_test(dir, GLib.FileTest.EXISTS))
            removeTree(Gio.File.new_for_path(dir));
    }
}
