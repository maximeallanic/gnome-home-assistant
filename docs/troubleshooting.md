# Troubleshooting

Start with `./verify.sh` (or `verify.sh --online`): it checks most of what follows and says what to do.

The extension writes its warnings to the GNOME Shell journal, prefixed with `[home-assistant]`:

```sh
journalctl -b -o cat /usr/bin/gnome-shell | grep -i home-assistant
journalctl -f -o cat /usr/bin/gnome-shell        # follow it live
```

The preferences run in a separate process (`gjs`); their messages are in `journalctl -b -o cat | grep -i home-assistant`.

| Symptom | Likely cause | What to do |
|---|---|---|
| Nothing appears after installing | GNOME Shell discovers new extensions only at login (Wayland) | log out and back in; then `gnome-extensions info home-assistant@maximeallanic.github.io` should say `State: ACTIVE` |
| `State: OUT OF DATE` | GNOME Shell version other than 51 | see [FAQ](faq.md#does-it-work-on-gnome-50-or-52) |
| `State: ERROR` | a missing library (libsecret or libsoup 3 introspection) | run `./install.sh --install-deps`, or install the packages listed in [Installation](installation.md#requirements) |
| A crossed-out house in the top bar | not connected: no address or token, address unreachable, or Home Assistant restarting | open the preferences, **Test Connection** |
| "Home Assistant refused the access token" | token deleted or expired in Home Assistant | create a new token, paste it, **Save**. The extension does not retry a refused token by itself |
| "The keyring cannot be read" | no Secret Service running, or the keyring is locked | log in with a password (an automatic login leaves the keyring locked), or unlock it with Passwords and Keys (Seahorse) |
| Connected, but no chip | no entity carries the top bar label, or the label name in the preferences differs | check the label in Home Assistant **Settings > Areas, labels & zones > Labels** and on the **Connection** page |
| A chip is missing | its state is empty, `unknown`, `unavailable` or `none`, which hides it on purpose | check the entity in **Developer tools > States** |
| No "Home" tile in Quick Settings | no entity carries the grid label | put `gnome-grid` on the grid sensor |
| "The grid sent by Home Assistant cannot be read" | the `tiles` attribute is not a list | look at the attribute in **Developer tools > States**; a template must render a list, see [grid](grid.md) |
| A mini-tile is missing | missing `id` or `entity`, or a duplicate `id` | the journal lists it (`grid: missing-key:2`, `duplicate-id:...`) |
| A mini-tile says "Not found" | its `entity` does not exist in Home Assistant | fix the entity id |
| Square or missing icons | the icon is not an `mdi:` name, or downloads are off and it is not cached, or `cdn.jsdelivr.net` is unreachable | use `mdi:` names; turn on **Download Home Assistant icons** |
| Entity states in English while the desktop is in another language | Home Assistant has no translation for that language, or the state comes from a template (template text is shown as written) | nothing to fix for templates: write the text in your language |
| The companion page says "Not registered." | `mobile_app` missing in Home Assistant, or the token's user cannot register devices | add the Mobile App integration (part of `default_config`); use an administrator token for the companion |
| Commands do nothing | wrong notify service name, or the command is refused | see the `gnome_home_assistant_command` event in **Developer tools > Events** (listen to it): `result` and `detail` say why |
| `command_open_url` or `command_launch_app` refused | the screen is locked | by design |
| The Caffeine sensor is absent | the Caffeine extension is not installed | install it, or ignore the sensor |
| A shortcut does nothing | already used by GNOME or another app, or the mini-tile id changed | the **Shortcuts** page marks both cases |

## Reporting a bug

Open an issue with the output of `./verify.sh`, the GNOME Shell version, your distribution, and the journal lines
mentioning `home-assistant`. **Remove any address, entity name or token you do not want to make public.**
