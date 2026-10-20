# Security policy

## Reporting a vulnerability

Please report security issues **privately** through GitHub: *Security* tab, *Report a vulnerability*. Do not open a
public issue. Include the version, your GNOME Shell version and what an attacker can do. You will get an answer
within a week.

## Scope

GNOME Shell extensions run inside the Shell process with its full privileges. Hearth for Home Assistant:

- connects only to the Home Assistant address the user enters and, for icons, to `cdn.jsdelivr.net`;
- keeps the access token in the user's keyring and never writes it to a file, a setting or the log;
- keeps the companion registration (including the webhook id, which grants access to the device in Home Assistant)
  in `~/.local/share/gnome-home-assistant/registration.json` with mode 0600;
- runs no subprocess, and accepts from Home Assistant only the commands listed in `docs/companion.md`, with
  validated parameters.

In scope: anything in this repository that breaks one of those properties; a way for Home Assistant data (states,
attributes, notifications, translations) to run code, open arbitrary files or crash the Shell; a way for another
local user or a web page to obtain the token or the webhook id; the installer downloading or running something
other than the release whose SHA-256 is pinned in `install.sh`.

The one-line installer carries the SHA-256 of the release zip in its own text (`RELEASE_SHA256`, written by
`scripts/release.sh` in the release commit), downloads over HTTPS only and checks the zip before installing it.
A release file replaced on GitHub is therefore refused; the pin is only as trustworthy as the `install.sh` you run,
which comes from the repository's `main` branch. The release workflow rebuilds the zip from the tag and fails unless
it has exactly the pinned SHA-256.

Out of scope: vulnerabilities of Home Assistant, GNOME Shell, libsoup or libsecret themselves; someone who already
controls your Home Assistant account sending you the commands the companion documents.

## Supported versions

Only the latest release.
