# extensions.gnome.org

Not submitted yet. This page records what is ready and what a reviewer will look at.

## The zip

```sh
scripts/pack.sh                    # dist/home-assistant@maximeallanic.github.io.shell-extension.zip
python3 tests/check_packs.py dist  # metadata, imports resolve inside the zip, no stray files, 500-line limit
```

`pack.sh` uses `gnome-extensions pack`: the modules and directories of the extension, the compiled translations
(`locale/`, no `.po` files) and the GSettings schema. The same zip is attached to every GitHub release. The `version`
key is left out of `metadata.json`: extensions.gnome.org sets it.

## Review notes

Checked against the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html):

- Nothing is created before `enable()`; `disable()` destroys widgets, cancels requests, closes the WebSocket,
  removes timers and releases shortcuts.
- **`unlock-dialog` session mode**: used for the optional companion only (the "locked" and "active" sensors and the
  commands allowed while locked must keep working). The reason is written above `disable()` in `extension.js`. On the
  lock screen chips and the grid are hidden and the keyboard shortcuts are released.
- **Network**: only to the Home Assistant address the user enters, and to `cdn.jsdelivr.net` for Material Design
  Icons (a pinned `@mdi/svg` version; can be turned off). No telemetry. The metadata description says both.
- **Clipboard**: the preferences copy the generated Home Assistant package when the user presses Copy; declared in
  the description.
- No binaries, no subprocess, no privileged action. GTK and libadwaita are imported only in the preferences, St,
  Clutter, Meta and Shell only in the Shell process.
- The schema is `org.gnome.shell.extensions.home-assistant` at `/org/gnome/shell/extensions/home-assistant/`.
- Licence MIT, compatible with GPL-2.0-or-later.

## Open points before submitting

- **Name and icon**: "Home Assistant" is a trademark of the Open Home Foundation, and `icons/home-assistant-symbolic.svg`
  (the Material Design Icons `home-assistant` glyph, used as the notification icon) is its logo. The guidelines ask
  for the owner's permission for brand names and logos. Options: ask the Open Home Foundation, or rename to a
  descriptive name ("Home dashboard for Home Assistant"...) and use a generic house icon.
- **GNOME versions**: only 51 is declared. Each new GNOME release needs a test in a nested Shell before adding it.
- Upload as a pre-release only after a v0.1.0 GitHub release exists, so the description's links work.
