# Companion (mobile_app)

Off by default. When turned on (preferences, **This Computer** page, **Register this computer**), the extension
registers the computer with Home Assistant's `mobile_app` integration, the way the phone apps do. The computer then
appears under **Settings > Devices & services > Mobile App** with sensors, accepts commands from automations and
shows notifications.

- **Device name:** the **Device name** field; empty means the computer's host name. It names the device and its
  entities (`sensor.<device>_volume`...) and the notify service (`notify.mobile_app_<device>`).
- **Registration:** kept in `~/.local/share/gnome-home-assistant/registration.json` (mode 0600). It holds the webhook
  id, which grants access to this device in Home Assistant: treat it like a password. Changing the Home Assistant
  address registers a new device. If the device is deleted in Home Assistant, the extension registers again and
  says so in a notification.
- **App id:** `io.github.maximeallanic.GnomeHomeAssistant`.
- Sensors keep reporting on the lock screen (that is why the extension also runs in the `unlock-dialog` session
  mode). A "Last contact" sensor is sent every minute, which the generated package turns into an "online" sensor.

## Sensors

Names are translated into the desktop language at registration; entity ids are built from those names by Home
Assistant. A sensor whose hardware or service is missing is not declared (the preferences show how many were).

| Sensor | Type | Notes |
|---|---|---|
| Last contact | sensor (timestamp) | every 60 s |
| Locked | binary_sensor | screen locked |
| Active | binary_sensor (occupancy) | session active, not idle |
| Screen on | binary_sensor (power) | |
| Fullscreen | binary_sensor | a fullscreen window is focused |
| Active app | sensor | name of the focused application |
| Displays | sensor | number of monitors |
| Volume | sensor (%) | default output |
| Muted | binary_sensor | |
| Brightness | sensor (%) | built-in screen, when GNOME can set it |
| Keyboard backlight | sensor (%) | when the keyboard has one |
| Do Not Disturb | binary_sensor | |
| Caffeine | binary_sensor | only with the [Caffeine](https://extensions.gnome.org/extension/517/caffeine/) extension |
| Theme | sensor | `light` or `dark` |
| Media | sensor | what the current MPRIS player plays |
| CPU, Memory | sensor (%) | diagnostic, every 30 s |
| Temperature, Fan | sensor | diagnostic, when the hardware exposes them (hwmon) |
| Free disk space | sensor | diagnostic |
| Wi-Fi network, IP address | sensor | diagnostic, from NetworkManager |
| Battery, Charging, AC power | sensor / binary_sensor | from UPower, on laptops |

Changes are sent batched over one second; nothing is sent while nothing changes.

## Commands

A command is a notification whose message starts with `command_`, sent to the computer's notify service:

```yaml
action: notify.mobile_app_my_computer
data:
  message: command_volume
  data:
    level: 30
```

| Message | `data` | Allowed while locked |
|---|---|---|
| `command_volume` | `level`: 0 to 100 | yes |
| `command_volume_up`, `command_volume_down` | `step`: 1 to 50 (default 5) | yes |
| `command_mute` | `state`: `on`, `off` or `toggle` | yes |
| `command_brightness` | `level`: 0 to 100 | yes |
| `command_keyboard_backlight` | `level`: 0 to 100 | yes |
| `command_do_not_disturb` | `state`: `on`, `off` or `toggle` | yes |
| `command_caffeine` | `state`: `on`, `off` or `toggle` (needs the Caffeine extension) | yes |
| `command_theme` | `theme`: `light` or `dark` | yes |
| `command_screen` | `state`: `on` or `off` | yes |
| `command_lock` | none | yes |
| `command_media` | `action`: `play_pause`, `next` or `previous` | yes |
| `command_open_url` | `url`: an http or https address | no |
| `command_launch_app` | `app`: a desktop file id such as `org.gnome.Calculator.desktop` | no |

Nothing else is accepted: there is no way to run a shell command. Each command answers with a
`gnome_home_assistant_command` event:

```yaml
event_type: gnome_home_assistant_command
data:
  command: volume
  result: ok          # ok, error or refused (refused: not allowed while the screen is locked)
  detail: ""          # the reason, in the desktop language, when result is not ok
```

## The generated package

Commands are easier to use as entities. Once the computer is registered, the **This Computer** page shows a Home
Assistant package built from the entity ids Home Assistant really gave this device: an "online" binary sensor, and
numbers, switches, buttons and scripts that send the commands above (volume, brightness, keyboard backlight, mute, Do
Not Disturb, caffeine, screen, dark style, lock, media keys, open a web address, launch an application). Press
**Copy**, save it as `packages/gnome_computer.yaml` in the Home Assistant configuration folder, and restart Home
Assistant (packages must be enabled, see [Home Assistant setup](home-assistant-setup.md#4-the-example-packages)).
[`ha/packages/gnome_computer.example.yaml`](../ha/packages/gnome_computer.example.yaml) shows what it looks like for
a computer named "My Computer".

The notify service name is `notify.mobile_app_` followed by the device name in lower case with anything other than
Latin letters and digits replaced by `_`. For a device name without Latin letters, Home Assistant transliterates and
the extension cannot guess the result: the package then uses the service Home Assistant reports once it is
available, and the page says so until then. Check it under **Developer tools > Actions**.

## Notifications

Any other message sent to the notify service is shown as a GNOME notification:

```yaml
action: notify.mobile_app_my_computer
data:
  title: Washing machine
  message: The cycle is finished.
  data:
    tag: laundry              # a later notification with the same tag replaces this one
    url: https://example.org  # opened when the notification is clicked
    importance: high          # urgent notification
    actions:
      - action: LAUNDRY_DONE
        title: Emptied
```

A button fires `mobile_app_notification_action` with `action` (and `tag`), like the phone apps. `message:
clear_notification` with a `tag` removes that notification.

## Turning it off

Turning **Register this computer** off stops the sensors, commands and notifications. The device stays in Home
Assistant; delete it there if you no longer want it. `uninstall.sh --purge` deletes the registration file.
