#!/usr/bin/env bash
# Check that Hearth for Home Assistant is installed and set up, and say what to do when something is missing.
# Read-only: changes nothing.
#
#   ./verify.sh [--online]
#
# Options:
#   --online    also connect to Home Assistant with the saved token (GET /api/config)
#   -h, --help
set -uo pipefail

UUID="home-assistant@maximeallanic.github.io"
SCHEMA_ID="org.gnome.shell.extensions.home-assistant"
SECRET_SCHEMA="io.github.maximeallanic.HomeAssistant"
ONLINE=0
failures=0

while (($#)); do
    case "$1" in
        --online) ONLINE=1 ;;
        -h|--help) if [[ -f "${BASH_SOURCE[0]:-}" ]]; then sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
            else echo "See https://github.com/maximeallanic/gnome-home-assistant/blob/main/docs/installation.md"; fi
            exit 0 ;;
        *) printf 'error: unknown option: %s\n' "$1" >&2; exit 2 ;;
    esac
    shift
done

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n        -> %s\n' "$1" "$2"; failures=$((failures + 1)); }
note() { printf '  note  %s\n' "$1"; }

ext_dir=""
for d in "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID" "/usr/share/gnome-shell/extensions/$UUID"; do
    [[ -f "$d/metadata.json" ]] && { ext_dir="$d"; break; }
done

echo "Desktop"
shell_major="$(gnome-shell --version 2>/dev/null | sed -n 's/^GNOME Shell \([0-9]*\).*/\1/p')"
if [[ -z "$shell_major" ]]; then
    bad "GNOME Shell not found" "this extension only runs in GNOME Shell"
elif [[ -n "$ext_dir" ]] && ! grep -q "\"$shell_major\"" "$ext_dir/metadata.json"; then
    bad "GNOME Shell $shell_major is not supported by the installed version" \
        "install a release that lists $shell_major (see the compatibility table in the README)"
else
    ok "GNOME Shell $shell_major"
fi

echo "Dependencies"
has_gi() { gjs -c "imports.gi.versions.$1 = '$2'; imports.gi.$1;" >/dev/null 2>&1; }
if has_gi Secret 1; then ok "libsecret (GObject introspection)"; else
    bad "libsecret introspection is missing" "run install.sh --install-deps, or install gir1.2-secret-1 / libsecret"; fi
if has_gi Soup 3.0; then ok "libsoup 3 (GObject introspection)"; else
    bad "libsoup 3 introspection is missing" "run install.sh --install-deps, or install gir1.2-soup-3.0 / libsoup3"; fi

echo "Extension"
if [[ -z "$ext_dir" ]]; then
    bad "not installed" "run install.sh"
else
    ok "installed in $ext_dir ($(sed -n 's/.*"version-name": *"\([^"]*\)".*/\1/p' "$ext_dir/metadata.json"))"
    state="$(gnome-extensions info "$UUID" 2>/dev/null | sed -n 's/^ *State: *//p')"
    case "$state" in
        ACTIVE|ENABLED) ok "enabled and running" ;;
        "") note "GNOME Shell does not know it yet: log out and back in" ;;
        ERROR) bad "GNOME Shell reports an error" "see: journalctl --user -b -g home-assistant" ;;
        OUT_OF_DATE) bad "out of date for this GNOME Shell" "install a release made for GNOME Shell $shell_major" ;;
        *) bad "state $state" "enable it: gnome-extensions enable $UUID" ;;
    esac
fi

echo "Settings"
gs() { # key: read with the installed schema when the system one is absent
    if [[ -n "$ext_dir" && -d "$ext_dir/schemas" ]]; then
        gsettings --schemadir "$ext_dir/schemas" get "$SCHEMA_ID" "$1" 2>/dev/null
    else
        gsettings get "$SCHEMA_ID" "$1" 2>/dev/null
    fi
}
url="$(gs url | sed "s/^'\(.*\)'$/\1/")"
if [[ -z "$url" ]]; then
    bad "no Home Assistant address" "open the settings: gnome-extensions prefs $UUID"
else
    ok "Home Assistant address: $url"
fi

# The token is looked up through libsecret, as the extension does; it is never printed. The gjs programs are in single
# quotes on purpose: their ${...} are JavaScript template strings.
# shellcheck disable=SC2016
token_state="$(URL="$url" SCHEMA="$SECRET_SCHEMA" gjs -c '
imports.gi.versions.Secret = "1";
const {Secret, GLib} = imports.gi;
const schema = new Secret.Schema(GLib.getenv("SCHEMA"), Secret.SchemaFlags.NONE,
    {url: Secret.SchemaAttributeType.STRING});
try {
    print(Secret.password_lookup_sync(schema, {url: GLib.getenv("URL")}, null) ? "present" : "absent");
} catch (e) {
    print(`error ${e.message}`);
}' 2>/dev/null)"
case "$token_state" in
    present) ok "access token saved in the keyring" ;;
    absent) [[ -n "$url" ]] && bad "no access token for this address" \
        "create a long-lived access token in your Home Assistant profile and paste it in the settings" ;;
    *) bad "the keyring cannot be reached (${token_state#error })" \
        "a Secret Service provider such as GNOME Keyring must be running and unlocked" ;;
esac

companion="$(gs companion-enabled)"
if [[ "$companion" == true ]]; then
    reg="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-home-assistant/registration.json"
    if [[ -f "$reg" ]]; then ok "this computer is registered as a Home Assistant device"; else
        note "the computer is not registered yet: it registers on the next connection"; fi
else
    note "the computer is not shared with Home Assistant (optional, see docs/companion.md)"
fi

if ((ONLINE)) && [[ -n "$url" && "$token_state" == present ]]; then
    echo "Connection"
    # The token goes to curl on stdin (-H @-), never on a command line that other users could read in ps.
    # shellcheck disable=SC2016
    code="$(URL="$url" SCHEMA="$SECRET_SCHEMA" gjs -c '
imports.gi.versions.Secret = "1";
const {Secret, GLib} = imports.gi;
const schema = new Secret.Schema(GLib.getenv("SCHEMA"), Secret.SchemaFlags.NONE,
    {url: Secret.SchemaAttributeType.STRING});
print(`Authorization: Bearer ${Secret.password_lookup_sync(schema, {url: GLib.getenv("URL")}, null)}`);' |
        curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H @- "${url%/}/api/config")"
    case "$code" in
        200) ok "Home Assistant answered and accepted the token" ;;
        401|403) bad "Home Assistant refused the token (HTTP $code)" "create a new token and save it in the settings" ;;
        000) bad "Home Assistant cannot be reached at $url" "check the address and that this computer can reach it" ;;
        *) bad "unexpected answer HTTP $code from $url/api/config" "check the address (no path after the port)" ;;
    esac
fi

echo
if ((failures)); then
    echo "$failures problem(s) found. docs/troubleshooting.md has more help."
    exit 1
fi
echo "Everything looks right."
