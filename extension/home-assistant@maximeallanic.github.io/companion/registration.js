// The mobile_app registration of this computer: {url, device_id, webhook_id}, in a private file (0600). The webhook_id
// gives access to the device in Home Assistant: never show it, never log it. A registration made with another Home
// Assistant URL is ignored (a new device is registered on the new server).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const REGISTRATION_PATH = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-home-assistant',
    'registration.json']);

// null when absent, unreadable, incomplete, or made for another URL.
export function readRegistration(path, url) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        const r = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof r?.device_id === 'string' && r.device_id && typeof r.webhook_id === 'string' && r.webhook_id &&
            r.url === url)
            return {url, device_id: r.device_id, webhook_id: r.webhook_id};
    } catch (_e) {
        // Absent or unreadable: a new device is registered (the caller logs it when the file exists).
    }
    return null;
}

export function writeRegistration(path, {url, device_id, webhook_id}) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    const file = Gio.File.new_for_path(path);
    file.replace_contents(new TextEncoder().encode(JSON.stringify({url, device_id, webhook_id})), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
}

export function deleteRegistration(path) {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            throw e;
    }
}
