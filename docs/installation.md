# Installation

## Requirements

- **GNOME Shell 51.** `metadata.json` declares `"shell-version": ["51"]` only; GNOME refuses to enable the extension
  on other versions. Wayland and X11 sessions both load it, only Wayland has been tried.
- **GObject introspection for libsecret and libsoup 3** (the access token lives in the keyring, the connection uses
  libsoup's WebSocket client).
- **A Secret Service provider**: GNOME Keyring (installed with GNOME), or another one such as KeePassXC.
- **Home Assistant** reachable from the computer, with a long-lived access token. Recent versions are expected:
  the extension uses the WebSocket API (`subscribe_entities`, label registry, `todo/item/subscribe`) and template
  entities with `default_entity_id`.
- For the optional companion: the `mobile_app` integration in Home Assistant (part of `default_config`).

| Distribution | Packages the installer checks for |
|---|---|
| Debian, Ubuntu and derivatives | `gir1.2-secret-1` `gir1.2-soup-3.0` `gnome-keyring` (`gettext` from a clone) |
| Fedora, RHEL and derivatives | `libsecret` `libsoup3` `gnome-keyring` (`gettext`) |
| Arch and derivatives | `libsecret` `libsoup3` `gnome-keyring` (`gettext`) |
| openSUSE | `typelib-1_0-Secret-1` `typelib-1_0-Soup-3_0` `gnome-keyring` (`gettext-tools`) |

On a regular GNOME desktop all of these are usually already installed. Only the Debian names have been checked on a
real system; the others come from each distribution's package index.

## One-line install

```sh
curl -fsSL https://raw.githubusercontent.com/maximeallanic/gnome-home-assistant/main/install.sh | bash
```

The script runs as your user. It:

1. checks the GNOME Shell version and that the libraries above are present (with `--install-deps` it offers to
   install what is missing with `apt`, `dnf`, `pacman` or `zypper`, through `sudo`, after asking);
2. downloads the extension zip of the release pinned in the script (`RELEASE_VERSION`) from the GitHub release, over
   HTTPS only, and refuses to install it unless its SHA-256 is the one written in the script (`RELEASE_SHA256`);
   a copy of the script that pins no release refuses to download and tells you to use a clone;
3. runs `gnome-extensions install --force` and enables the extension.

Options are passed after `bash -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/maximeallanic/gnome-home-assistant/main/install.sh | bash -s -- --install-deps
curl -fsSL .../install.sh | bash -s -- --dry-run            # print what would be done
```

| Option | Effect |
|---|---|
| `--zip FILE` | install this zip instead of downloading one |
| `--source` | build and install the clone the script is in (default when run from a clone) |
| `--install-deps` | install missing system packages (asks first; uses sudo) |
| `-y`, `--yes` | do not ask |
| `--no-enable` | install without enabling |
| `--dry-run` | change nothing |
| `--uninstall` | same as `uninstall.sh` |

**First install on Wayland:** GNOME Shell only discovers a new extension at login. Log out and back in once; the
extension is already marked as enabled and starts by itself.

## From a clone

```sh
git clone https://github.com/maximeallanic/gnome-home-assistant
cd gnome-home-assistant
./install.sh            # builds the zip with scripts/pack.sh (needs gettext) and installs it
```

## From the release zip

Download `home-assistant@maximeallanic.github.io.shell-extension.zip` from the
[releases page](https://github.com/maximeallanic/gnome-home-assistant/releases), then:

```sh
gnome-extensions install --force home-assistant@maximeallanic.github.io.shell-extension.zip
```

Log out and in, then `gnome-extensions enable home-assistant@maximeallanic.github.io` (or use the Extensions app).

## After installing

A notification "Connect Home Assistant" appears until an address and a token are saved; its button opens the
preferences. You can also open them with:

```sh
gnome-extensions prefs home-assistant@maximeallanic.github.io
```

Then follow [Home Assistant setup](home-assistant-setup.md).

## Check the installation

```sh
./verify.sh              # or: curl -fsSL https://raw.githubusercontent.com/maximeallanic/gnome-home-assistant/main/verify.sh | bash
./verify.sh --online     # also connects to Home Assistant with the saved token
```

`verify.sh` changes nothing. It reports the Shell version, the libraries, whether the extension is installed and
enabled, the saved address, whether a token is in the keyring (never printing it) and the companion registration,
and says what to do for each failed line. `--online` sends one `GET /api/config` with the token.

## Update

Run the one-line install again (it installs over the previous version), then log out and in. Settings, token and
registration are kept.

## Uninstall

```sh
./uninstall.sh           # or: curl -fsSL .../uninstall.sh | bash
./uninstall.sh --purge   # also removes the token, the settings, the registration file and the icon cache
```

Without `--purge`, settings, token and registration stay, so a reinstall picks up where you left off. The device
registered by the companion stays in Home Assistant either way: delete it under **Settings > Devices & services >
Devices**.
