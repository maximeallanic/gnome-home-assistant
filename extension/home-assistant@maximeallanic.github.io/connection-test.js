// "Test connection" of the preferences: GET /api/config with the token. Runs in the preferences process.
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// {ok: true, name, version} | {ok: false, reason: 'unauthorized'|'not-found'|'http'|'unreachable', detail}
export function testConnection(url, token, cancellable = null) {
    const session = new Soup.Session({timeout: 10});
    const msg = Soup.Message.new('GET', `${url}/api/config`);
    msg.get_request_headers().append('Authorization', `Bearer ${token}`);
    return new Promise(resolve => {
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            let body;
            try {
                body = new TextDecoder().decode(s.send_and_read_finish(res).toArray());
            } catch (e) {
                resolve({ok: false, reason: 'unreachable', detail: e.message});
                return;
            }
            const status = msg.get_status();
            if (status === 401 || status === 403) {
                resolve({ok: false, reason: 'unauthorized', detail: `HTTP ${status}`});
                return;
            }
            if (status === 404) {
                resolve({ok: false, reason: 'not-found', detail: `HTTP ${status}`});
                return;
            }
            let config = null;
            try {
                config = JSON.parse(body);
            } catch (_e) {
                // Not Home Assistant (a web page): reported below.
            }
            if (status !== 200 || typeof config?.version !== 'string') {
                resolve({ok: false, reason: 'http', detail: `HTTP ${status}`});
                return;
            }
            resolve({ok: true, name: String(config.location_name ?? ''), version: config.version});
        });
    });
}
