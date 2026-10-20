#!/usr/bin/env bash
# Remove Home Assistant for GNOME for the current user.
#
#   ./uninstall.sh [--purge] [--dry-run]
#   curl -fsSL https://raw.githubusercontent.com/maximeallanic/gnome-home-assistant/main/uninstall.sh | bash -s -- --purge
#
# Without --purge, your settings, the access token and the device registration are kept, so reinstalling picks up
# where you left off.
#
# Options:
#   --purge     also delete the access tokens from the keyring, the settings, the mobile_app registration file and the
#               icon cache. The device stays listed in Home Assistant: delete it there under Settings > Devices.
#   --dry-run   print what would be done, change nothing
#   -h, --help
set -euo pipefail

UUID="home-assistant@maximeallanic.github.io"
SECRET_SCHEMA="io.github.maximeallanic.HomeAssistant"
DCONF_PATH="/org/gnome/shell/extensions/home-assistant/"
PURGE=0
DRY_RUN=0

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
run() {
    if ((DRY_RUN)); then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

while (($#)); do
    case "$1" in
        --purge) PURGE=1 ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help) if [[ -f "${BASH_SOURCE[0]:-}" ]]; then sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
            else echo "See https://github.com/maximeallanic/gnome-home-assistant/blob/main/docs/installation.md"; fi
            exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
done

if command -v gnome-extensions >/dev/null && gnome-extensions info "$UUID" >/dev/null 2>&1; then
    run gnome-extensions disable "$UUID" || true
    run gnome-extensions uninstall "$UUID"
    say "Extension removed."
elif [[ -d "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID" ]]; then
    # The Shell is not running (or does not know the extension yet): remove the files directly.
    run rm -rf -- "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
    say "Extension files removed."
else
    say "The extension is not installed for $(id -un)."
fi

purge_failed=0
if ((PURGE)); then
    if ! command -v secret-tool >/dev/null; then
        say "secret-tool is missing (package libsecret-tools or libsecret): delete the \"Home Assistant access token\""
        say "items yourself in Passwords and Keys (Seahorse)."
        purge_failed=1
    elif run secret-tool clear xdg:schema "$SECRET_SCHEMA"; then
        say "Access tokens deleted from the keyring."
    else
        say "Could not reach the keyring: delete the \"Home Assistant access token\" items yourself in Passwords and"
        say "Keys (Seahorse)."
        purge_failed=1
    fi
    if command -v dconf >/dev/null && run dconf reset -f "$DCONF_PATH"; then
        say "Settings reset."
    else
        say "Could not reset the settings: run  dconf reset -f $DCONF_PATH"
        purge_failed=1
    fi
    run rm -rf -- "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-home-assistant" \
        "${XDG_CACHE_HOME:-$HOME/.cache}/gnome-home-assistant"
    say "Registration file and icon cache deleted."
    say "If this computer was registered as a device, delete it in Home Assistant: Settings > Devices & services >"
    say "Mobile App."
fi
say "Log out and back in if the indicator is still in the top bar."
exit "$purge_failed"
