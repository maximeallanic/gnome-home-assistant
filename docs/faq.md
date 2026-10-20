# FAQ

### Is it an official Home Assistant project?

No. Hearth for Home Assistant is an unofficial community project, not affiliated with Home Assistant or the Open
Home Foundation: an independent GNOME Shell extension that talks to Home Assistant's public WebSocket and REST APIs.
"Home Assistant" is a trademark of the Open Home Foundation; it is used here only to say what the extension connects
to.

### Does it work on GNOME 50 or 52?

Only GNOME Shell 51 is declared and tested. The extension uses Quick Settings internals that change between
releases. Editing `shell-version` may work but is not supported; reports from other versions are welcome.

### Do I need to write YAML?

No for chips: a label on an existing entity is enough. Yes for the grid: one template sensor describes it (the
example package is a starting point). The companion's package is generated for you.

### Can I show something without a label, or two grids?

No. Labels are how Home Assistant tells the extension what to show, so the desktop never needs a list of entity ids.
There is one grid; a long grid can use `wide` tiles and details to stay readable.

### Why are my template texts not translated?

The extension never rewrites text Home Assistant sends. It translates only the bare state words Home Assistant
itself translates (`on`, `open`, `heat`...). Text written by a template is yours: write it in your language.

### Does it slow GNOME down?

It keeps one WebSocket open and receives only the states of the entities it shows. The companion polls CPU, memory
and hardware sensors every 30 seconds and sends values only when they change.

### Can I use Home Assistant Link (formerly Home Assistant Cloud, by Nabu Casa) or a reverse proxy?

Any address that serves Home Assistant's API over `http(s)://` with WebSocket support works, including the remote URL
of Home Assistant Link. Nabu Casa announced in October 2026 that Home Assistant Cloud becomes Home Assistant Link,
officially from Home Assistant 2026.12; what the service does stays the same. The companion uses the address you entered; it does not use cloudhooks.

### Why does it run on the lock screen?

Only for the companion: the "Locked" and "Active" sensors and the commands allowed while locked (volume, lock,
screen off...) must keep working. Chips and the grid are hidden on the lock screen and nothing can be clicked.

### Where is the token?

In your keyring. See [Privacy and security](privacy-security.md).

### How do I remove everything?

`./uninstall.sh --purge`, then delete the device in Home Assistant if the companion was on.
