# Configuration

Everything is set in the preferences: `gnome-extensions prefs home-assistant@maximeallanic.github.io`, or the
Extensions app. No file needs editing.

## Connection page

| Setting | Notes |
|---|---|
| Address | `http://` or `https://` address of Home Assistant, as you open it in a browser |
| Access token | a long-lived access token; **Save** stores it in the keyring, **Remove** deletes it. **Open My Profile** opens the Home Assistant page where tokens are created |
| Test Connection | connects with the address and the token typed, without saving, and says what failed: unreachable address, an address that is not Home Assistant, token refused |
| Labels | the three label names: top bar chips, alert chips, Quick Settings grid |
| Download Home Assistant icons | off: only icons already cached and the two shipped with the extension are shown |

## This Computer page

The companion: **Register this computer**, the **Device name**, the registration status and the generated Home
Assistant package. See [Companion](companion.md).

## Shortcuts

Each mini-tile of the grid, and each of its choices, can get a global keyboard shortcut (press **Set**, then the
keys; Escape cancels, Backspace removes). A shortcut needs Ctrl, Alt or Super, or is one of F1 to F24. A shortcut
already taken by GNOME or another application is marked "Already used by another shortcut". Shortcuts never fire on
the lock screen. When fired, the Shell's on-screen bubble shows the mini-tile with its new state.

Shortcuts refer to mini-tile `id`s: if you rename an id in Home Assistant, the old shortcut is listed as inactive.

## GSettings keys

Schema `org.gnome.shell.extensions.home-assistant`. The preferences are the intended way to change them; the keys
are listed for scripted setups (`gsettings --schemadir ~/.local/share/gnome-shell/extensions/home-assistant@maximeallanic.github.io/schemas ...`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `url` | s | `''` | Home Assistant address |
| `credentials-revision` | i | 0 | bumped by the preferences when the token changes, so the Shell reloads it from the keyring |
| `topbar-label` | s | `gnome-topbar` | label of the chips |
| `alert-label` | s | `gnome-topbar-alert` | label of the alert chips |
| `grid-label` | s | `gnome-grid` | label of the grid entity |
| `download-icons` | b | true | download Material Design Icons |
| `companion-enabled` | b | false | register this computer |
| `device-name` | s | `''` | device name (empty: host name) |
| `shortcuts` | s | `[]` | JSON list of shortcuts, written by the preferences |
| `companion-snapshot`, `grid-snapshot`, `shortcut-conflicts` | | | written by the extension for the preferences; do not edit |

The token is not a GSettings key: it is in the keyring (see [Privacy and security](privacy-security.md)). To set it
from a script:

```sh
secret-tool store --label="Home Assistant access token" \
    xdg:schema io.github.maximeallanic.HomeAssistant url "https://ha.example.org"
```

The `url` attribute must be the same address as the `url` key, without a trailing slash.
