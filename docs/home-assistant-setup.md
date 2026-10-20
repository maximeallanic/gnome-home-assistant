# Home Assistant setup

Everything the extension shows is decided in Home Assistant: you choose entities by putting a **label** on them, and
template sensors write the texts. Nothing in the extension is specific to one home.

## 1. Connect

1. In Home Assistant, open your profile (click your name at the bottom of the sidebar), tab **Security**, section
   **Long-lived access tokens**, and create a token. Copy it: Home Assistant shows it only once.
   The preferences have an **Open My Profile** button that opens this page once the address is filled in.
2. Open the extension preferences (`gnome-extensions prefs home-assistant@maximeallanic.github.io`, or the
   "Connect Home Assistant" notification).
3. On the **Connection** page, enter the address, for example `http://homeassistant.local:8123` or
   `https://ha.example.org`, paste the token and press **Test Connection**. On success it says
   "Connected to <your home name>" and the Home Assistant version. Press **Save**: the token goes to your keyring.

The token acts as your Home Assistant user. A dedicated, non-administrator user for the desktop works for the top
bar and the grid; the companion needs the rights of whoever may register devices (see
[Privacy and security](privacy-security.md)).

## 2. Create the labels

In **Settings > Areas, labels & zones > Labels**, create:

| Label | Purpose |
|---|---|
| `gnome-topbar` | entities shown as chips in the top bar |
| `gnome-topbar-alert` | among those chips, the ones drawn as alerts (red pill) |
| `gnome-grid` | the one entity that describes the Quick Settings grid |

The names can be changed on the preferences' **Connection** page, section **Labels**. The extension matches the
label **name** (case and surrounding spaces ignored), in any language or script you like.

## 3. A first chip, without any YAML

Put the `gnome-topbar` label on any existing entity, for example a temperature sensor: open the entity, then the
settings cog, and add the label. A chip appears in the top bar within a second, with the entity's state (translated
by Home Assistant into the desktop's language for words like "on" or "open") and its icon.

Chips are sorted by name. Prefix names with `1 · `, `2 · `... to choose the order; the prefix is not shown.
See [Top bar chips](chips.md) for the details.

## 4. The example packages

Most people want texts of their own ("21.4°", "2 to do"), which is what template sensors are for. Two ready-to-edit
packages are in [`ha/packages/`](../ha/packages):

- [`gnome_topbar.example.yaml`](../ha/packages/gnome_topbar.example.yaml): two chips (indoor temperature, chores
  count) and a grid (two lights, blinds with a slider and two scripts, heating with details, a to-do list).
- [`gnome_computer.example.yaml`](../ha/packages/gnome_computer.example.yaml): what the companion page generates for
  a computer named "My Computer" (do not copy it as is: use the one the preferences generate for your computer, see
  [Companion](companion.md)).

To use the first one:

1. Enable packages once in `configuration.yaml` (skip if you already have this):

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

2. Copy `gnome_topbar.example.yaml` to `packages/gnome_topbar.yaml` in your Home Assistant configuration folder
   (the folder that holds `configuration.yaml`).
3. Replace the example entity ids (`light.office`, `light.living_room`, `cover.living_room_blinds`,
   `climate.living_room`, `binary_sensor.living_room_window`, `sensor.indoor_temperature`, `todo.chores`,
   `script.open_blinds`, `script.close_blinds`) with yours, and translate the texts you wrote into your language.
4. **Developer tools > YAML > Check configuration**, then restart Home Assistant (afterwards, edits only need
   **Developer tools > YAML > Template entities**).
5. Put the labels:
   - `gnome-topbar` on `sensor.gnome_indoor` and `sensor.gnome_chores`;
   - `gnome-topbar-alert` on `sensor.gnome_chores` too;
   - `gnome-grid` on `sensor.gnome_home_grid` only.

The grid appears in Quick Settings as a "Home" tile. The contract of the `tiles` attribute is in
[Quick Settings grid](grid.md).

## 5. The companion (optional)

To make the computer a Home Assistant device (sensors such as locked, active, volume, battery; commands from
automations; notifications), see [Companion](companion.md).
