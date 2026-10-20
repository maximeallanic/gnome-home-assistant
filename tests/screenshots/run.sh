#!/usr/bin/env bash
# Real screenshots of the extension, taken in an isolated headless GNOME Shell connected to the fake Home Assistant of
# tests/fake-ha. Nothing is drawn by hand: every image is what GNOME Shell renders.
#
#   tests/screenshots/run.sh [--out DIR] [--scheme dark|light|both] [--locale LOCALE] [--scale 1|2]
#                            [--shell-theme-resource FILE]
#
#   --shell-theme-resource FILE  load this gnome-shell-theme.gresource in the nested Shell instead of the installed
#                                one (for a machine whose Shell theme is replaced, e.g. the stock file kept by a theme
#                                package as gnome-shell-theme.gresource.distrib).
#
# The nested Shell has its own D-Bus session bus, XDG_RUNTIME_DIR, XDG_CONFIG/DATA/CACHE/STATE directories, dconf
# database and keyring, a virtual monitor and no window in your session. It installs the zip built by scripts/pack.sh,
# exactly as a user would get it. The real dconf database is checked before and after: if it changed, the run fails.
# Requires gnome-shell, gnome-keyring, secret-tool (libsecret-tools), gdbus, dconf, msgfmt.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
UUID="home-assistant@maximeallanic.github.io"

if [[ "${1:-}" != "--inner" ]]; then
    OUT="$HERE/out"
    SCHEMES=(dark light)
    LOCALE="en_US.UTF-8"
    SCALE=2
    THEME_RESOURCE=''
    while (($#)); do
        case "$1" in
            --out) OUT="${2:?}"; shift ;;
            --scheme) case "${2:-}" in dark|light) SCHEMES=("$2") ;; both) ;; *) echo "--scheme dark|light|both" >&2; exit 2 ;; esac
                shift ;;
            --locale) [[ "${2:-}" =~ ^[A-Za-z0-9_.@-]+$ ]] || { echo "--locale: invalid" >&2; exit 2; }; LOCALE="$2"; shift ;;
            --scale) [[ "${2:-}" == 1 || "${2:-}" == 2 ]] || { echo "--scale 1 or 2" >&2; exit 2; }; SCALE="$2"; shift ;;
            --shell-theme-resource) [[ -f "${2:-}" ]] || { echo "--shell-theme-resource: no such file" >&2; exit 2; }
                THEME_RESOURCE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift ;;
            -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
            *) echo "unknown option: $1" >&2; exit 2 ;;
        esac
        shift
    done
    for tool in gnome-shell gnome-keyring-daemon secret-tool gdbus dconf msgfmt dbus-daemon; do
        command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 2; }
    done
    mkdir -p "$OUT" && OUT="$(cd "$OUT" && pwd)" || exit 2
    DCONF_REAL="${XDG_CONFIG_HOME:-$HOME/.config}/dconf/user"
    dconf_date() { stat -c '%y' "$DCONF_REAL" 2>/dev/null || echo absent; }
    DCONF_BEFORE="$(dconf_date)"
    TMP="$(mktemp -d "${TMPDIR:-/tmp}/gnome-ha-shots.XXXXXX")" || exit 2
    # A FUSE mount left by a service of the private bus (document portal, gvfs) is unmounted before the removal.
    # shellcheck disable=SC2317,SC2329  # called by the EXIT trap
    remove_tmp() {
        local m
        while read -r m; do
            fusermount3 -u -z "$m" 2>/dev/null || fusermount -u -z "$m" 2>/dev/null
        done < <(awk -v t="$TMP/" 'index($2, t) == 1 { print $2 }' /proc/mounts)
        if awk -v t="$TMP/" 'index($2, t) == 1 { found = 1 } END { exit !found }' /proc/mounts; then
            echo "run.sh: a mount is still active under $TMP: left in place" >&2
        else
            rm -rf -- "$TMP"
        fi
    }
    trap remove_tmp EXIT
    "$REPO/scripts/pack.sh" --out "$TMP/dist" >/dev/null || exit 1
    code=0
    for scheme in "${SCHEMES[@]}"; do
        mkdir -m 0700 "$TMP/$scheme" "$TMP/$scheme/run" || exit 2
        # Set BEFORE dbus-run-session: services activated on the private bus (dconf-service, the keyring, the
        # Extensions app for the preferences) inherit the bus daemon's environment, so they stay private too.
        env -u WAYLAND_DISPLAY -u DISPLAY XDG_RUNTIME_DIR="$TMP/$scheme/run" XDG_CONFIG_HOME="$TMP/$scheme/config" \
            XDG_DATA_HOME="$TMP/$scheme/data" XDG_CACHE_HOME="$TMP/$scheme/cache" XDG_STATE_HOME="$TMP/$scheme/state" \
            GHA_SHOTS_REAL_BUS="${DBUS_SESSION_BUS_ADDRESS:-}" GSETTINGS_BACKEND=dconf GHA_SHOTS_THEME="$THEME_RESOURCE" \
            dbus-run-session -- bash "$HERE/run.sh" --inner "$TMP/$scheme" "$TMP/dist" "$OUT" "$scheme" "$LOCALE" "$SCALE" \
            2>"$OUT/$scheme-session.log" || code=1
        # Any JavaScript error of the extension or of its preferences fails the run, even if every picture was taken.
        if grep -h -A3 'JS ERROR\|Gjs-CRITICAL\|Gtk-CRITICAL\|Gtk-WARNING.*markup' "$OUT/$scheme-shell.log" \
            "$OUT/$scheme-session.log" | grep -B1 -A2 "$UUID\|org.gnome.Shell.Extensions\|markup"; then
            echo "run.sh [$scheme]: errors above (logs in $OUT)" >&2
            code=1
        fi
    done
    if [[ "$(dconf_date)" != "$DCONF_BEFORE" ]]; then
        echo "run.sh: $DCONF_REAL changed during the run: check it (your session may also have written)" >&2
        code=3
    fi
    exit $code
fi

# --- inner part: inside the private session bus ------------------------------------------------------------------
DIR="$2"; DIST="$3"; OUT="$4"; SCHEME="$5"; LOCALE="$6"; SCALE="$7"
fail() { echo "run.sh [$SCHEME]: $*"; exit 1; }  # stdout: stderr goes to the session log
[[ "$XDG_RUNTIME_DIR" == "$DIR/run" && "$XDG_CONFIG_HOME" == "$DIR/config" ]] || fail "XDG directories are not private"
[[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" && "$DBUS_SESSION_BUS_ADDRESS" != "$GHA_SHOTS_REAL_BUS" ]] || fail "real session bus"
mkdir -p "$XDG_CONFIG_HOME/dconf" "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
LOG="$OUT/$SCHEME-shell.log"
HA_PID=''
SHELL_PID=''
SYSTEM_BUS_PID=''
# shellcheck disable=SC2317,SC2329  # called by the EXIT trap
cleanup() {
    # The Shell first, then the fake Home Assistant: the extension must not see its server vanish while the Shell is
    # tearing its actors down.
    for pid in $SHELL_PID $HA_PID $SYSTEM_BUS_PID; do
        kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null
    done
}
trap cleanup EXIT

# A private, empty system bus: the nested Shell must not show this machine's networks, VPN, battery or Bluetooth
# devices (NetworkManager, UPower, BlueZ live on the system bus), nor register itself with GDM and logind.
cat >"$DIR/system-bus.conf" <<C
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=$DIR/system-bus</listen>
  <auth>EXTERNAL</auth>
  <policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>
C
dbus-daemon --config-file="$DIR/system-bus.conf" --nofork --nopidfile >/dev/null 2>&1 &
SYSTEM_BUS_PID=$!
for _ in $(seq 1 50); do [[ -S "$DIR/system-bus" ]] && break; sleep 0.1; done
[[ -S "$DIR/system-bus" ]] || fail "the private system bus did not start"
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$DIR/system-bus"

# The extension, from the release zip.
EXT="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
mkdir -p "$EXT"
python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' \
    "$DIST/$UUID.shell-extension.zip" "$EXT" || fail "cannot unpack the zip"
glib-compile-schemas "$EXT/schemas"

# The fake Home Assistant.
gjs -m "$REPO/tests/fake-ha/server.js" --port-file "$DIR/port" >"$OUT/$SCHEME-fake-ha.log" 2>&1 &
HA_PID=$!
for _ in $(seq 1 100); do [[ -s "$DIR/port" ]] && break; sleep 0.1; done
[[ -s "$DIR/port" ]] || fail "the fake Home Assistant did not start"
URL="http://127.0.0.1:$(cat "$DIR/port")"
TOKEN="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["token"])' "$REPO/tests/fake-ha/fixture.json")"

# A private keyring, unlocked, holding the token as the preferences would store it.
printf 'nested' | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1
gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1
printf '%s' "$TOKEN" | secret-tool store --label="Home Assistant access token for $URL" \
    xdg:schema io.github.maximeallanic.HomeAssistant url "$URL" || fail "cannot store the token"

case "$SCHEME" in dark) color_scheme=prefer-dark ;; *) color_scheme=prefer-light ;; esac
mkdir -p "$DIR/dconf-src"
cat >"$DIR/dconf-src/shots.keyfile" <<K
[org/gnome/shell]
enabled-extensions=['$UUID']
disable-user-extensions=false
welcome-dialog-last-shown-version='999'

[org/gnome/desktop/interface]
color-scheme='$color_scheme'
enable-animations=false
scaling-factor=uint32 $SCALE
clock-format='24h'

[org/gnome/desktop/search-providers]
disable-external=true

[org/gnome/desktop/notifications]
show-banners=false

[org/gnome/shell/extensions/home-assistant]
url='$URL'
companion-enabled=true
device-name='Demo Laptop'
K
dconf compile "$XDG_CONFIG_HOME/dconf/user" "$DIR/dconf-src" || fail "dconf compile failed"

DISPLAY_NAME="gha-shots-$$"
LOCALE_ENV=()
for v in $(compgen -e); do [[ "$v" =~ ^(LANG|LANGUAGE|LC_[A-Z]+)$ ]] && LOCALE_ENV+=(-u "$v"); done
env "${LOCALE_ENV[@]}" LANG="$LOCALE" gnome-shell --headless --unsafe-mode --wayland \
    --virtual-monitor "$((1440 * SCALE))x$((900 * SCALE))" --wayland-display "$DISPLAY_NAME" >"$LOG" 2>&1 &
SHELL_PID=$!
# The preferences window is a Wayland client of the nested Shell, started by D-Bus activation.
# No accessibility bus in this session: without GTK_A11Y=none GTK fails to register the application.
dbus-update-activation-environment WAYLAND_DISPLAY="$DISPLAY_NAME" LANG="$LOCALE" GTK_A11Y=none

ev() { # JavaScript -> its result, evaluated in the nested Shell
    local reply
    reply="$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>&1)" || return 1
    # gdbus prints a GVariant: (true, 'value'), its string quoted as Python does; the value is the JSON of the result.
    # A string result is printed bare, anything else as JSON.
    python3 -c 'import ast, json, re, sys
ok, value = re.fullmatch(r"\((true|false), (.*)\)", sys.stdin.read().strip(), re.S).groups()
value = ast.literal_eval(value)
if ok == "true" and value:
    value = json.loads(value)
print(value if isinstance(value, str) else json.dumps(value))
sys.exit(0 if ok == "true" else 1)' <<<"$reply"
}
wait_for() { # description JavaScript-condition [seconds]
    local last=''
    for _ in $(seq 1 $((${3:-30} * 4))); do
        kill -0 "$SHELL_PID" 2>/dev/null || fail "GNOME Shell stopped (see $LOG)"
        last="$(ev "$2" 2>&1)" && [[ "$last" == true ]] && return 0
        sleep 0.25
    done
    fail "timed out waiting for $1: $last (see $LOG)"
}
shot_area() { # name JavaScript-returning-[x,y,w,h]
    local box
    box="$(ev "$2")" || fail "no area for $1: $box"
    python3 -c 'import json, sys; x, y, w, h = json.loads(sys.argv[1]); print(f"{x} {y} {w} {h}")' "$box" >"$DIR/box" ||
        fail "bad area for $1: $box"
    read -r x y w h <"$DIR/box"
    gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.ScreenshotArea "$x" "$y" "$w" "$h" false "$OUT/$SCHEME-$1.png" >/dev/null ||
        fail "screenshot $1 failed"
    echo "wrote $OUT/$SCHEME-$1.png"
}

wait_for "GNOME Shell" "true" 60
if [[ -n "${GHA_SHOTS_THEME:-}" ]]; then
    ev "{ const r = imports.gi.Gio.Resource.load('$GHA_SHOTS_THEME'); r._register(); Main.loadTheme(); 'ok'; }" >/dev/null ||
        fail "cannot load $GHA_SHOTS_THEME"
fi
EXT_JS="Main.extensionManager.lookup('$UUID')"
STATE_JS="$EXT_JS?.stateObj"
wait_for "the extension to connect" \
    "($STATE_JS?._indicator?.get_children().filter(c => c.visible).length ?? 0) >= 2 && !!$STATE_JS?._grid?.visible"
sleep 2  # icons: downloaded once from the MDI CDN into the private cache

# Margin around an actor, in logical pixels, kept inside the screen (the Screenshot API refuses an area outside it).
BOX='(a, m = 12) => { const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size();
    const s = global.display.get_monitor_geometry(0);
    const l = Math.max(0, Math.round(x - m)), t = Math.max(0, Math.round(y - m));
    const r = Math.min(s.width, Math.round(x + w + m)), b = Math.min(s.height, Math.round(y + h + m));
    return JSON.stringify([l, t, r - l, b - t]); }'

# 1. The top bar: the chips, at the full height of the panel.
shot_area topbar "{ const i = $STATE_JS._indicator; const [x] = i.get_transformed_position(); const [w] = i.get_transformed_size();
    const l = Math.max(0, Math.round(x - 6)); JSON.stringify([l, 0, Math.round(w + 12), Math.round(Main.panel.height)]); }"

# 2. Quick Settings open, the Home tile among the system tiles.
ev "Main.panel.statusArea.quickSettings.menu.open(false)" >/dev/null
sleep 1
shot_area quick-settings "($BOX)(Main.panel.statusArea.quickSettings.menu.box)"

# 3. The Home grid unfolded.
ev "$STATE_JS._grid.menu.open(false)" >/dev/null
sleep 1
shot_area grid "($BOX)(Main.panel.statusArea.quickSettings.menu.box)"

# 4. The detail of the blinds mini-tile: choices and a position slider.
ev "$STATE_JS._grid._toggleDetail('blinds')" >/dev/null
sleep 1
shot_area grid-detail "($BOX)(Main.panel.statusArea.quickSettings.menu.box)"

# 5. The chips' menus: the to-do list of the alert chip.
ev "$STATE_JS._grid._toggleDetail('chores')" >/dev/null
sleep 1
shot_area grid-tasks "($BOX)(Main.panel.statusArea.quickSettings.menu.box)"
ev "Main.panel.statusArea.quickSettings.menu.close(false)" >/dev/null

# 6. The preferences window.
ev "Main.extensionManager.openExtensionPrefs('$UUID', '', {})" >/dev/null
PREFS_JS="global.display.list_all_windows().find(w => w.get_wm_class() === 'org.gnome.Shell.Extensions')"
wait_for "the preferences window" "!!$PREFS_JS" 30
sleep 3
ev "{ const w = $PREFS_JS; w.activate(global.get_current_time()); 'ok'; }" >/dev/null
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.ScreenshotWindow true false false "$OUT/$SCHEME-preferences.png" >/dev/null ||
    fail "screenshot preferences failed"
echo "wrote $OUT/$SCHEME-preferences.png"

# The companion, end to end: this computer registered with the fake Home Assistant, sensors registered and updated,
# the registration file private.
for event in 'POST /api/mobile_app/registrations' '"type":"register_sensor"' '"type":"update_sensor_states"'; do
    for _ in $(seq 1 60); do grep -qF "$event" "$OUT/$SCHEME-fake-ha.log" && break; sleep 0.5; done
    grep -qF "$event" "$OUT/$SCHEME-fake-ha.log" || fail "companion: no $event (see $OUT/$SCHEME-fake-ha.log)"
done
REG="$XDG_DATA_HOME/gnome-home-assistant/registration.json"
[[ "$(stat -c '%a' "$REG" 2>/dev/null)" == 600 ]] || fail "companion: $REG missing or not 0600"
echo "companion: registered, sensors sent, registration file 0600"
exit 0
