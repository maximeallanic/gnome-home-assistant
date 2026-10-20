// Home Assistant "mdi:..." icons as GNOME symbolic icons. Material Design Icons are not shipped with GNOME: each icon
// is downloaded once from the jsDelivr CDN (the @mdi/svg npm package, pinned version) and cached as
// "<name>-symbolic.svg", so the Shell recolours it like any symbolic icon. Downloads can be turned off in the
// preferences; then only the icons shipped in icons/ and those already cached are shown.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export const MDI_VERSION = '7.4.47';
const CDN = `https://cdn.jsdelivr.net/npm/@mdi/svg@${MDI_VERSION}/svg`;

export function mdiName(icon) {
    const m = /^mdi:([a-z0-9-]+)$/.exec(icon ?? '');
    return m ? m[1] : null;
}

export class Icons {
    constructor({
        cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-home-assistant', 'mdi']),
        session = new Soup.Session({timeout: 15}),
        shippedDir = null,  // icons shipped with the extension (served even offline)
        downloads = () => true,
    } = {}) {
        this._cacheDir = cacheDir;
        this._shippedDir = shippedDir;
        this._session = session;
        this._downloads = downloads;
        this._cancellable = new Gio.Cancellable();
        this._notFound = new Set();
        this._inFlight = new Map();  // name -> waiting callbacks
        GLib.mkdir_with_parents(cacheDir, 0o755);
    }

    lookup(icon, callback) {
        const name = mdiName(icon);
        if (!name || this._notFound.has(name)) {
            callback(null);
            return;
        }
        for (const dir of [this._shippedDir, this._cacheDir].filter(d => d)) {
            const present = GLib.build_filenamev([dir, `${name}-symbolic.svg`]);
            if (GLib.file_test(present, GLib.FileTest.EXISTS)) {
                callback(new Gio.FileIcon({file: Gio.File.new_for_path(present)}));
                return;
            }
        }
        if (!this._downloads()) {
            callback(null);
            return;
        }
        const path = GLib.build_filenamev([this._cacheDir, `${name}-symbolic.svg`]);
        if (this._inFlight.has(name)) {
            this._inFlight.get(name).push(callback);
            return;
        }
        this._inFlight.set(name, [callback]);
        const msg = Soup.Message.new('GET', `${CDN}/${name}.svg`);
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
            let gicon = null;
            let missing = true;  // false on a transport error: a new attempt at the next request
            try {
                const bytes = s.send_and_read_finish(res);
                const svg = new TextDecoder().decode(bytes.toArray());
                if (msg.get_status() === Soup.Status.OK && svg.trimStart().startsWith('<svg')) {
                    GLib.file_set_contents(path, svg);
                    gicon = new Gio.FileIcon({file: Gio.File.new_for_path(path)});
                }
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                console.warn(`[home-assistant] icon ${name}: ${e.message}`);
                missing = false;
            }
            if (!gicon && missing) {
                console.warn(`[home-assistant] icon mdi:${name} not found`);
                this._notFound.add(name);
            }
            const callbacks = this._inFlight.get(name) ?? [];
            this._inFlight.delete(name);
            callbacks.forEach(cb => cb(gicon));
        });
    }

    destroy() {
        this._cancellable.cancel();
        this._inFlight.clear();
    }
}
