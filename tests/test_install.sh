#!/usr/bin/env bash
# The one-line install path of install.sh, fed to bash through a pipe as by `curl ... | bash`, against a throw-away
# HOME: refused without a pin, installs a release that matches the pin, refuses a tampered one, refuses a non-HTTPS
# URL. A zip packed from this checkout and served from a file:// URL stands for the GitHub release. Nothing touches the
# real session: no D-Bus, and a gnome-extensions wrapper that only lets `install` (which just unpacks files) through.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID=home-assistant@maximeallanic.github.io
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gnome-ha-install-test.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

REAL_GNOME_EXTENSIONS="$(command -v gnome-extensions)" || fail "gnome-extensions is needed"
export REAL_GNOME_EXTENSIONS
"$ROOT/scripts/pack.sh" --out "$WORK/release" >/dev/null || fail "pack.sh"
zip="$WORK/release/$UUID.shell-extension.zip"
sum="$(sha256sum "$zip" | cut -d' ' -f1)"
mkdir -p "$WORK/shims" "$WORK/home" "$WORK/run"
cat >"$WORK/shims/gnome-extensions" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == install ]] || { echo "test shim: gnome-extensions $1 refused" >&2; exit 1; }
exec "$REAL_GNOME_EXTENSIONS" "$@"
EOF
# The keyring check asks the session bus, which the test does not reach: answer that a Secret Service is there.
cat >"$WORK/shims/busctl" <<'EOF'
#!/usr/bin/env bash
echo "org.freedesktop.secrets"
EOF
chmod +x "$WORK/shims/gnome-extensions" "$WORK/shims/busctl"
unset DBUS_SESSION_BUS_ADDRESS
export PATH="$WORK/shims:$PATH" HOME="$WORK/home" XDG_RUNTIME_DIR="$WORK/run" XDG_DATA_HOME="$WORK/home/data" \
    XDG_CACHE_HOME="$WORK/home/cache" XDG_CURRENT_DESKTOP=GNOME
dest="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"

# piped PIN URL [PROTOCOLS]: install.sh through a pipe, with the pin and the download URL replaced. The pin is set
# here (blanked for the first case), so the test does not depend on whether the checkout is a release commit.
# PROTOCOLS widens curl's protocol list so that a file:// URL can stand for the release; left empty, the installer
# keeps its own HTTPS-only list.
piped() {
    sed -e "s|^RELEASE_SHA256=.*|RELEASE_SHA256='$1'|" -e "s|^RELEASE_URL=.*|RELEASE_URL='$2'|" \
        -e "s|--proto '=https'|--proto '=${3:-https}'|" "$ROOT/install.sh" | bash -s -- --no-enable
}
no_download_left() {
    ! compgen -G "$XDG_CACHE_HOME/gnome-home-assistant-install.*" >/dev/null || fail "download dir left: $1"
}
for line in "^RELEASE_SHA256=" "^RELEASE_URL=" "--proto '=https' " "--proto-redir '=https'"; do
    grep -q -- "$line" "$ROOT/install.sh" || fail "install.sh has no '$line' for these tests to replace"
done

echo "== no pin: refused, nothing downloaded or created"
if out="$(piped '' "file://$zip" https,file 2>&1)"; then fail "installed without a pin"; fi
grep -q "no release of Hearth for Home Assistant is pinned" <<<"$out" || fail "no clear refusal: $out"
grep -q "git clone https://github.com/maximeallanic/gnome-home-assistant" <<<"$out" || fail "no clone path: $out"
grep -q "Downloading" <<<"$out" && fail "downloaded without a pin: $out"
[[ -z "$(ls -A "$HOME")" ]] || fail "the refusal created files: $(ls -A "$HOME")"

echo "== pinned release: installed"
piped "$sum" "file://$zip" https,file >"$WORK/good.log" 2>&1 || { cat "$WORK/good.log"; fail "pinned install"; }
grep -q "Checksum verified" "$WORK/good.log" || fail "checksum not reported"
[[ -f "$dest/metadata.json" && -f "$dest/extension.js" ]] || fail "not installed in $dest"
no_download_left "after an install"
rm -rf -- "$dest"

echo "== tampered release: refused"
cp "$zip" "$WORK/tampered.zip"
printf 'x' >>"$WORK/tampered.zip"
if piped "$sum" "file://$WORK/tampered.zip" https,file >"$WORK/bad.log" 2>&1; then fail "a tampered zip was installed"; fi
grep -q "does not match the pinned SHA-256" "$WORK/bad.log" || { cat "$WORK/bad.log"; fail "no checksum refusal"; }
[[ ! -e "$dest" ]] || fail "files installed from a tampered zip"
no_download_left "after a refused checksum"

echo "== non-HTTPS URL: refused"
if piped "$sum" "file://$zip" '' >"$WORK/proto.log" 2>&1; then fail "a non-HTTPS URL was downloaded"; fi
grep -qi "protocol" "$WORK/proto.log" || { cat "$WORK/proto.log"; fail "not refused by curl's protocol list"; }
[[ ! -e "$dest" ]] || fail "files installed from a non-HTTPS URL"
no_download_left "after a refused protocol"
echo "installer tests: OK"
