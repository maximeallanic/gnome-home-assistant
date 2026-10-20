# Theming

The extension ships two small stylesheets, `stylesheet-dark.css` and `stylesheet-light.css`; GNOME Shell loads the one
matching the current style. They use the Shell's neutral surfaces and the system accent colour, so the extension
looks like stock GNOME with any accent. Both files share an identical layout block (sizes, spacing, radii; checked by
`tests/run.sh`) and differ only in colours.

## Style classes

| Class | Element |
|---|---|
| `ha-indicator` | the box holding the chips in the top bar |
| `ha-chip` | one chip (icon and text) |
| `ha-chip-alert` | a chip carrying the alert label |
| `ha-chip-inactive` | a switch-like chip that is off (the dimming itself is set on the actor: St ignores CSS `opacity`) |
| `ha-grid` | the two-column grid in the Quick Settings menu |
| `ha-tile` | a mini-tile (a button) |
| `ha-tile-on`, `ha-tile-off`, `ha-tile-unavailable` | its look, from the entity state |
| `ha-tile-open` | the mini-tile whose detail is unfolded |
| `ha-tile-body`, `ha-tile-top` | its inner boxes |
| `ha-tile-icon`, `ha-tile-name`, `ha-tile-text` | its icon, title and second line |
| `ha-tile-arrow` | the round button that unfolds the detail |
| `ha-choice-group`, `ha-choice` | the segmented row of choices in a detail; `:checked` marks the active one |
| `ha-slider-row`, `ha-slider-value` | the slider row of a detail and its value label |
| `ha-line-value` | the value of a read-only line in a detail |

Detail lines (switches, actions, to-do items) are the Shell's own `PopupSwitchMenuItem` and `PopupMenuItem`, so they
follow the Shell theme with no extra rule.

## Overriding from a Shell theme

GNOME Shell loads extension stylesheets after the theme's, so at equal specificity the extension wins. A theme that
restyles these classes should either use more specific selectors, for example `.quick-settings .ha-tile` or
`#panel .ha-chip-alert`, or load its sheet for extensions after the extensions' own (which is what
[M3E for Extensions](https://github.com/maximeallanic/m3e-gnome-extensions) does for the
[m3e-gnome](https://github.com/maximeallanic/m3e-gnome) theme).

## Material 3 Expressive

The extension does not depend on m3e-gnome. Its tiles already follow the shapes of the Shell's quick settings, which
m3e-gnome restyles; the `ha-*` classes above are the hooks if m3e-gnome (or any theme) wants to give them its own
shapes and colours. No such rules are published yet.
