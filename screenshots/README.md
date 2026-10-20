# Screenshots

Every image here is what GNOME Shell 51 rendered; none is drawn or edited. They were taken by
`tests/screenshots/run.sh` in an isolated headless GNOME Shell (virtual 2880×1800 monitor, scale 2, animations off,
stock Adwaita Shell theme) running the extension zip built by `scripts/pack.sh`, connected to the fake Home Assistant
of `tests/fake-ha` (made-up entities, nobody's real home).

| File | Shows |
|---|---|
| `dark-topbar.png`, `light-topbar.png` | two chips: a temperature, and a chores count with the alert label |
| `dark-quick-settings.png`, `light-quick-settings.png` | Quick Settings with the "Home" grid tile |
| `dark-grid.png`, `light-grid.png` | the grid open: lights, blinds, heating, chores |
| `dark-grid-detail.png`, `light-grid-detail.png` | the blinds detail: choices and position slider |
| `dark-grid-tasks.png`, `light-grid-tasks.png` | the chores detail: open to-do items |
| `dark-preferences.png`, `light-preferences.png` | the preferences, Connection page |
| `fr-dark-grid-tasks.png` | the chores detail in a French session: the extension's own strings from `po/fr.po`, state words ("Éteint", "Ouvert", "Chauffe") from Home Assistant's translations; texts written by the fixture's templates stay as written |
| `fr-dark-preferences.png` | the preferences, Connection page, in a French session (strings from `po/fr.po`) |

When a tile's menu is open, GNOME Shell dims the other Quick Settings tiles; that is stock behaviour.

## Taking them again

```sh
tests/screenshots/run.sh --out screenshots --scheme both
tests/screenshots/run.sh --out screenshots/fr --scheme dark --locale fr_FR.UTF-8   # then rename with the fr- prefix
```

On a machine whose Shell theme is replaced by a theme package, point the nested Shell at the stock theme, for
example (Debian with a diverted theme):

```sh
tests/screenshots/run.sh --out screenshots --scheme both \
    --shell-theme-resource /usr/share/gnome-shell/gnome-shell-theme.gresource.distrib
```

The runner starts the private session with only `LANG` set to `--locale`: a `LC_ALL`, `LC_MESSAGES` or `LANGUAGE`
of the calling shell would otherwise reach the preferences, which D-Bus starts with the bus's environment, and keep
them in that language.

The runner needs `gnome-shell`, `gnome-keyring`, `secret-tool` (libsecret-tools), `gdbus`, `dconf` and `msgfmt`.
