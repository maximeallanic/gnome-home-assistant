# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The extension is now called **Hearth for Home Assistant** (short: Hearth). The UUID, the GSettings schema and the
  repository stay the same, so settings and the saved token are kept. New `mobile_app` registrations report this
  name as the app name; an existing registration keeps "Home Assistant for GNOME" until it is made again.
- Notifications use the Adwaita house icon (`go-home-symbolic`) instead of the Home Assistant logo glyph, which is no
  longer shipped.
- The metadata description says the project is unofficial and not affiliated with Home Assistant or the Open Home
  Foundation.

### Fixed

- The screenshot runner passed `LC_ALL`, `LC_MESSAGES` or `LANGUAGE` from the calling shell to the preferences,
  which overrode `--locale`: the French preferences capture was in English. It is taken again.

## [0.1.0] - 2026-10-20

First public release, extracted from a private desktop setup. Pre-release: tested with unit tests against fake Home
Assistant servers and in a nested headless GNOME Shell 51; not yet on extensions.gnome.org.

### Added

- Top bar chips: every entity carrying the `gnome-topbar` label becomes a chip showing its state and icon;
  `gnome-topbar-alert` shows it as an alert.
- Quick Settings grid: the entity carrying the `gnome-grid` label describes a grid of mini-tiles (toggle, action,
  choices, slider, details with switches, actions, values and to-do items), with optional keyboard shortcuts per
  mini-tile or choice.
- Entity states ("on", "heat", "open"...) shown in the session language through Home Assistant's own translations.
- Optional mobile_app companion: registers the computer as a Home Assistant device with up to 25 sensors, 14
  commands (`command_*` notifications) answered by the `gnome_home_assistant_command` event, and notifications
  with actions.
- Preferences: connection page (address, access token in the keyring, connection test), label names, icon
  downloads, companion page with the generated Home Assistant package ready to copy, shortcuts page.
- First-run notification that opens the preferences; notification when the token is refused.
- Neutral light and dark stylesheets following the system accent colour; class names documented for themes.
- English source strings, French translation, number formatting that follows the session locale.
- `install.sh` (one-line install of a pinned, checksum-verified release; dependency check for Debian/Ubuntu,
  Fedora, Arch and openSUSE), `uninstall.sh` (with `--purge`), `verify.sh` (with `--online`), `scripts/pack.sh`
  (extensions.gnome.org zip), example Home Assistant packages.
- Unit tests, an integration test against a fake Home Assistant server (`tests/fake-ha`), a screenshot runner
  driving a nested headless GNOME Shell, CI and a tag-triggered release workflow.

### Known limitations

- Only GNOME Shell 51 is declared and tested.
- The notify service name of a device whose name has no Latin letters cannot be guessed; the preferences say so and
  explain how to find it.
- Material Design Icons are downloaded from the jsDelivr CDN the first time they are shown (can be turned off).
- State words are translated through Home Assistant's per-domain and per-device-class translations; the
  per-integration `translation_key` level is not used yet, and template text is shown as written.
- The Caffeine sensor and command need the Caffeine extension.

[Unreleased]: https://github.com/maximeallanic/gnome-home-assistant/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/maximeallanic/gnome-home-assistant/releases/tag/v0.1.0
