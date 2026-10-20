# Privacy and security

## The access token

- Stored with libsecret in your keyring (GNOME Keyring or any Secret Service provider), item schema
  `io.github.maximeallanic.HomeAssistant`, attribute `url`, label "Home Assistant access token for <address>". It is
  never written to GSettings, a file or the journal.
- `verify.sh` only says whether a token is present. `verify.sh --online` passes it to `curl` on standard input, not on
  the command line.
- A token is a full Home Assistant login for its user. Prefer a dedicated user; if you do not use the companion it
  does not need to be an administrator.
- Use `https://` when Home Assistant is reached over a network you do not control: with `http://` the token and the
  data travel in clear text.
- When Home Assistant refuses the token, the extension stops retrying (each attempt would count as a failed login and
  may get the address banned by `ip_ban_enabled`) and shows a notification.

## What is sent where

| To | What | When |
|---|---|---|
| Your Home Assistant | WebSocket connection: label and entity registries, states of the labelled entities and of those the grid names, to-do items, translations of state words, service calls when you click | while the extension is enabled (the connection stays open on the lock screen, where nothing is shown or clickable) |
| Your Home Assistant (companion only) | device registration, sensor values listed in [Companion](companion.md) (including the active application name, Wi-Fi network name and IP address), command results | when the companion is on, also while the screen is locked |
| `cdn.jsdelivr.net` | a request for each `mdi:` icon not yet cached (`@mdi/svg` package, pinned version). It reveals the icon names and your IP address to the CDN | first time an icon is shown; turn off **Download Home Assistant icons** to avoid it |

Nothing else: no analytics, no other server.

## On disk

| Path | Content |
|---|---|
| `~/.local/share/gnome-home-assistant/registration.json` | companion registration: address, device id, webhook id. Mode 0600. The webhook id lets anyone who has it post data as this device: do not share it |
| `~/.cache/gnome-home-assistant/mdi/` | downloaded icons |
| dconf `/org/gnome/shell/extensions/home-assistant/` | the settings above |

`uninstall.sh --purge` removes all three and the keyring item.

## What Home Assistant can make the computer do

Only the commands listed in [Companion](companion.md#commands), with validated parameters. There is no command that
runs a program by path or a shell command line; `command_launch_app` only starts an installed application by its
desktop file id, and it and `command_open_url` are refused while the screen is locked. Notifications are displayed
as plain text.

The companion registers with `supports_encryption: false`, like a plain HTTP client: webhook payloads are protected
only by the transport, hence the advice to use `https://`.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
