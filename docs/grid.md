# Quick Settings grid

One entity carrying the grid label (`gnome-grid` by default) becomes a Quick Settings tile. Its menu is a two-column
grid of mini-tiles, described by the entity's `tiles` attribute. Home Assistant writes every text; the extension lays
them out and calls the services.

| Part of the tile | Comes from |
|---|---|
| Title | the grid entity's name (an order prefix such as `1 · ` is removed) |
| Subtitle | its state (empty, `unknown`, `unavailable`, `none`: no subtitle) |
| Icon | its `icon` attribute (`mdi:` names) |
| Mini-tiles | its `tiles` attribute: a list, or a template that renders a list |

If several entities carry the grid label, the first by name is used and a warning is logged.

## Keys of a mini-tile

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | unique within the grid; also what [keyboard shortcuts](configuration.md#shortcuts) refer to |
| `entity` | yes | the entity the mini-tile shows. Its state sets the look: active (`on`, `open`, `opening`, `closing`, `heat`, `cool`, `heat_cool`, `auto`, `dry`, `fan_only`), inactive, or unavailable (dimmed). An entity Home Assistant does not know is shown "Not found" |
| `name` | no | title; default: the entity's friendly name |
| `icon` | no | `mdi:` icon; default: the entity's `icon` attribute, then the icon set in Home Assistant |
| `text` | no | second line, shown as written (`''` for none); default: the entity state, translated by Home Assistant for state words, formatted for the locale for numbers |
| `action` | no | what a click does. Default: `entity`. An entity id: switches, lights, fans and input_booleans are toggled; scripts and scenes turned on; buttons pressed; covers toggled. `none`: the click opens the detail instead |
| `wide` | no | `true`: spans both columns |
| `choices` | no | a row of buttons in the detail: entity ids, or `{entity, name, active}` objects (`active` is a boolean you compute, it highlights the button). Each entity must be one a click can act on (see `action`) |
| `slider` | no | an entity driven by a slider in the detail: `light` (brightness), `cover` (position), `number` or `input_number` (its min, max and step) |
| `details` | no | entity ids listed in the detail: switches, actions, values, and the open items of a to-do list, which can be ticked |

A mini-tile with `choices`, `slider` or `details` has an arrow that unfolds its detail below the grid; when `action`
is `none`, the whole mini-tile does.

`choices` and `details` accept a list or a template string rendering one (`"['script.a', 'script.b']"` or
`"script.a, script.b"`).

## Example

From [`ha/packages/gnome_topbar.example.yaml`](../ha/packages/gnome_topbar.example.yaml):

```yaml
template:
  - sensor:
      - name: "Home"
        unique_id: gnome_home_grid
        default_entity_id: sensor.gnome_home_grid
        state: >
          {{ [('Lights', is_state('light.living_room', 'on') or is_state('light.office', 'on')),
              ('Blinds', states('cover.living_room_blinds') in ['open', 'opening', 'closing'])]
             | selectattr(1) | map(attribute=0) | join(' · ') }}
        attributes:
          icon: mdi:home
          tiles: >
            {{ [
              {'id': 'living_room_light', 'entity': 'light.living_room', 'name': 'Living room', 'icon': 'mdi:sofa'},
              {'id': 'blinds', 'entity': 'cover.living_room_blinds', 'name': 'Blinds', 'icon': 'mdi:blinds',
               'action': 'none', 'slider': 'cover.living_room_blinds',
               'choices': [{'entity': 'script.open_blinds', 'name': 'Open'},
                           {'entity': 'script.close_blinds', 'name': 'Close'}]},
              {'id': 'heating', 'entity': 'climate.living_room', 'name': 'Heating', 'icon': 'mdi:radiator',
               'action': 'none', 'details': ['climate.living_room', 'binary_sensor.living_room_window']},
            ] }}
```

The `tiles` attribute changes often and has no history value: the example package excludes the grid entity from the
recorder.

## When the grid cannot be read

- `tiles` missing or not a list: the menu says "The grid sent by Home Assistant cannot be read".
- A mini-tile without `id` or `entity`, a duplicate `id`, a choice that cannot be pressed or an `active` that is not a
  boolean: that entry is left out and the journal says which one (`journalctl -b -o cat /usr/bin/gnome-shell | grep home-assistant`,
  look for `grid:`). See [Troubleshooting](troubleshooting.md).
