# Top bar chips

Every entity carrying the top bar label (`gnome-topbar` by default) becomes a chip in the top bar, next to the system
status icons.

| What | Comes from |
|---|---|
| Text | the entity state. A state word Home Assistant translates (`on`, `open`, `heat`...) is shown in the desktop's language, through Home Assistant's own translations; a number with a `unit_of_measurement` is formatted for the desktop locale; any other text is shown exactly as Home Assistant sends it |
| Icon | the `icon` attribute, else the icon set on the entity in Home Assistant. only `mdi:` names are understood; each is downloaded once from the Material Design Icons package (see [Privacy](privacy-security.md)). Without an icon the chip shows its text only |
| Order | the name (friendly name), compared the way the desktop's language sorts, digits as numbers. A leading `1 · `, `2 - ` or `3. ` sets the order and is removed |
| Alert style | the entity also carries the alert label (`gnome-topbar-alert`) |

A chip is hidden when the state is empty, `unknown`, `unavailable` or `none`. A switch, light, fan or input_boolean
chip shows only its icon, dimmed when off. Chips only display; what you want to switch or run goes in the
[grid](grid.md).

While Home Assistant cannot be reached, a single `mdi:home-off` icon replaces the chips. On the lock screen chips are
hidden.

## A template chip

```yaml
template:
  - sensor:
      - name: "1 · Indoor"
        unique_id: gnome_indoor
        default_entity_id: sensor.gnome_indoor
        state: >
          {% set t = states('sensor.indoor_temperature') %}
          {{ (t | float | round(1)) ~ '°' if t | is_number else '' }}
        attributes:
          icon: mdi:home-thermometer
```

An empty state hides the chip, which is how a "only when there is something to say" chip is written (see
`sensor.gnome_chores` in the example package).
