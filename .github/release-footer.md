## Tested on

- Debian (testing) with GNOME Shell 51, on the author's machine, plus the headless tests and a nested GNOME Shell
  connected to a fake Home Assistant (`tests/screenshots/run.sh`). Other distributions, GNOME versions and X11 are
  untested.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/maximeallanic/gnome-home-assistant/main/install.sh | bash -s -- --release VERSION
```

Or download `home-assistant@maximeallanic.github.io.shell-extension.zip` and run
`gnome-extensions install --force home-assistant@maximeallanic.github.io.shell-extension.zip`, then log out and in.

## Verify the download

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify home-assistant@maximeallanic.github.io.shell-extension.zip --repo maximeallanic/gnome-home-assistant
```
