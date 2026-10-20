# Contributing

Thanks for helping. Hearth for Home Assistant runs inside GNOME Shell and talks to people's homes, so small, careful changes
with a clean `disable()` and no surprise network traffic are what matter most.

## Ways to contribute

- **Report a bug** with the issue form: version, distribution, GNOME version, session type, `./verify.sh` output,
  the journal lines mentioning `home-assistant`, steps to reproduce. **Remove addresses, entity names and tokens.**
- **Try it on another setup** (distribution, GNOME version, X11, a Home Assistant version) and report what you saw.
- **Translate it**: see [Translations](#translations).
- **Improve the documentation.** The README and docs are English first; `README.fr.md` follows the English one.
- **Fix something or add a feature**, as described below.

## How to contribute code

1. **Discuss first** for anything beyond a small fix: open an issue or a Discussion describing the problem and the
   approach.
2. **Fork** and branch from `main` as `type/short-description` (`feat`, `fix`, `docs`, `refactor`, `test`, `ci`,
   `chore`).
3. **Keep the change focused**: one subject per pull request, no unrelated reformatting.
4. **Run `tests/run.sh`**; add or update tests for the behaviour you changed. For anything visible, run
   `tests/screenshots/run.sh` and attach before/after images (they use the fake Home Assistant: no personal data).
5. **Commit with [Conventional Commits](https://www.conventionalcommits.org/)** messages in English
   (`fix(grid): keep the slider under the finger while HA sends states`).
6. **Open the pull request** against `main` and fill in the template.

By contributing you agree that your work is released under the repository licence (MIT). You are responsible for
what you submit, including anything produced with the help of a tool: read it, run it, and be able to explain it.

## Ground rules

- **English in code**: identifiers, comments, log lines.
- **No language is hardcoded.** User-visible strings go through `_()` / `C_()` from `i18n.js`. No keyword list or
  regex that interprets text in one human language; no length limit calibrated on one script; numbers and sorting
  through the session locale; state words through Home Assistant's translations (`state-names.js`). Text sent by
  Home Assistant is shown as sent.
- **Nothing about one home in the code**: entity ids, names and texts come from Home Assistant through labels and
  template attributes. Examples use the made-up home of `tests/fake-ha` and `ha/packages`.
- **`disable()` undoes everything `enable()` did**: signals, GLib sources, Soup sessions, widgets, key grabs.
- **Fix causes, not symptoms**: no retry loop hiding a failure, no empty `catch`. A `catch` that ignores an error
  says why in a comment; otherwise it logs with `console.warn` or `console.error`.
- **No new network destination** without discussion; the current ones are listed in
  [docs/privacy-security.md](docs/privacy-security.md).
- **Never log or display the token or the webhook id.**
- Follow the [extensions.gnome.org review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
- **Source files stay under 500 lines.** Split along a real seam, never at an arbitrary line.
- Pure logic stays out of Shell imports so it can be tested with `gjs -m` (`chips.js`, `grid.js`, `companion/`...).

## Workflow

```sh
npm ci
tests/run.sh                           # must pass
./install.sh --source --no-enable      # installs the checkout for your user (log out and in to load it)
```

[docs/development.md](docs/development.md) describes the layout, the fake Home Assistant and the screenshot runner.
Update `CHANGELOG.md` under `[Unreleased]`.

## Translations

```sh
scripts/update-po.sh                   # regenerate the template, merge po/*.po
cp po/home-assistant@maximeallanic.github.io.pot po/<lang>.po   # a new language
```

Translate with any PO editor (Poedit, GNOME Translation Editor, Lokalize). `scripts/pack.sh` compiles every
catalogue. Sensor names are translated too: Home Assistant receives them at registration.

## Releases (maintainer)

1. Set `version-name` in `metadata.json` and `version` in `package.json`; turn `[Unreleased]` into
   `[X.Y.Z] - date` in `CHANGELOG.md`. Merge.
2. On an up-to-date `main`, on Debian testing: `scripts/release.sh X.Y.Z` checks everything, builds the zip
   reproducibly, pins its version and SHA-256 in `install.sh` in a `chore(release): X.Y.Z` commit and prints the tag
   commands.
3. Push `main` and the tag. The *Release* workflow runs CI, rebuilds the zip and checks it matches the pin
   (`scripts/release.sh --build-only`), builds the source tarball and `SHA256SUMS`, attests their provenance and
   publishes the GitHub release (pre-release below 1.0.0). To rehearse, run the workflow by hand: it runs the same
   checks and publishes nothing.
