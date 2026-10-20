# Development

## Layout

```
extension/home-assistant@maximeallanic.github.io/   the extension, as installed
  extension.js            entry point: connection, chips, grid, companion, shortcuts
  ha-client.js            WebSocket client (auth, reconnection, request/response, subscriptions)
  state-source.js         registries, states, to-do items, state translations, kept up to date
  chips.js, grid.js       the Home Assistant contracts, pure logic (no Shell import, tested with gjs -m)
  state-names.js          state words through Home Assistant's own translations
  indicator.js, grid-menu.js, grid-detail.js, menu-lines.js   Shell widgets
  shortcuts.js, shortcut-model.js                           global shortcuts
  companion/, sensors/    mobile_app registration, webhook, sensors, commands, notifications
  prefs*.js               preferences (GTK 4 / libadwaita)
  credentials.js          token in the keyring (libsecret)
  icons.js, icons/        Material Design Icons cache and the two shipped icons
ha/packages/              example Home Assistant packages
po/                       translations (English source strings, French catalogue)
scripts/                  pack.sh, update-po.sh, release-notes.sh, release.sh, example-package.js
tests/unit, tests/integration, tests/fake-ha, tests/screenshots
install.sh, uninstall.sh, verify.sh
```

No source file exceeds 500 lines (checked by `tests/run.sh`). Modules without `resource:///org/gnome/shell` imports are
pure and run under plain `gjs -m`, which is how the tests exercise them.

## Tests

```sh
npm ci            # once, for ESLint
tests/run.sh
```

`tests/run.sh` runs, without opening any window or touching your settings: every `tests/unit/test_*.js` and
`tests/integration/test_*.js` under `gjs -m`, schema compilation, translation checks (French catalogue complete,
template up to date, `POTFILES` complete), the stylesheet layout check, the generated example package, YAML parsing,
the 500-line limit, building and checking the extensions.gnome.org zip, the release notes, ESLint and ShellCheck.
Steps whose tool is missing are reported as `SKIP`.

Needs: `gjs`, `gir1.2-secret-1`, `gir1.2-soup-3.0`, `gettext`, `python3` (+ `python3-yaml`), `gnome-shell` (for
`gnome-extensions pack`), `shellcheck`, Node for ESLint. Some tests format numbers in `fr_FR`: install the locale
(`locales-all` on Debian) for them to be meaningful.

## The fake Home Assistant

`tests/fake-ha/server.js` is a small Home Assistant stand-in written in GJS with libsoup: the WebSocket calls the
extension makes, `GET /api/config`, and the mobile_app registration and webhook endpoints. It serves
`tests/fake-ha/fixture.json`, a made-up home ("Demo Home", token `fake-token-for-tests`), listens on 127.0.0.1 only,
and logs every request as a JSON line.

```sh
gjs -m tests/fake-ha/server.js --port-file /path/to/port
```

`tests/integration/test_fake_ha.js` connects the real client, state source and contracts to it: connection test,
refused token, chips, grid, to-do items, translated states, a service call round trip.

## Screenshots

`tests/screenshots/run.sh` starts an isolated headless GNOME Shell (own D-Bus session and system bus, runtime and
XDG directories, dconf database, keyring, virtual monitor), installs the zip built by `scripts/pack.sh`, connects it
to the fake Home Assistant and takes the screenshots in `screenshots/` through `org.gnome.Shell.Screenshot`. It also
checks the companion end to end (registration, sensors, registration file mode) and fails on any JavaScript error of
the extension. It never touches your session: it checks your dconf database before and after.

```sh
tests/screenshots/run.sh --out screenshots --scheme both
tests/screenshots/run.sh --out screenshots --scheme dark --locale fr_FR.UTF-8
```

See [`screenshots/README.md`](../screenshots/README.md).

## Translations

Source strings are English, marked with `_()` (and `C_()` for context) from `i18n.js`. After changing strings:

```sh
scripts/update-po.sh      # regenerates the template and merges po/*.po
```

To add a language, copy the template to `po/<lang>.po`, translate it, and add nothing else: `scripts/pack.sh`
compiles every catalogue in `po/`. Nothing in the code may assume a language: state words go through Home
Assistant's translations, numbers through the session locale, sorting through `Intl.Collator`.

## Releases

1. Set the version in `metadata.json` (`version-name`), `package.json` and `install.sh` (`PINNED_VERSION`), and add a
   CHANGELOG section.
2. `scripts/release.sh X.Y.Z` checks all of it and prints the tag commands.
3. Pushing the tag runs `.github/workflows/release.yml`: tests, zip, source tarball, `SHA256SUMS`, build provenance
   attestation, GitHub release. `install.sh` downloads the zip and `SHA256SUMS` of that release.
