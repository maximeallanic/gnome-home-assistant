// Minimal assertions for the unit tests (plain GJS, no test framework). A failed assertion throws: at module level
// GJS exits with status 1; asynchronous tests go through runAsync(), because System.exit() called from a promise
// callback does not stop a running main loop.
import GLib from 'gi://GLib';
import System from 'system';

export function eq(actual, expected, name) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`FAIL ${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

export function done(file) {
    print(`ok ${file}`);
}

// Runs an async test body in a main loop; exits with status 1 when it throws. cleanup() runs in both cases.
export function runAsync(name, body, cleanup = () => {}) {
    const loop = new GLib.MainLoop(null, false);
    let failure = null;
    body().catch(e => (failure = e)).finally(() => loop.quit());
    loop.run();
    cleanup();
    if (failure) {
        printerr(`${failure.message}\n${failure.stack ?? ''}`);
        System.exit(1);
    }
    done(name);
}
