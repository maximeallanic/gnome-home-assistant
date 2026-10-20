#!/usr/bin/env bash
# Home Assistant for GNOME installer. Runs as your user (no root, except to install missing system packages when you
# agree), installs the GNOME Shell extension for your user only, and is undone by uninstall.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/maximeallanic/gnome-home-assistant/main/install.sh | bash
#   ./install.sh [options]          (from a clone: installs the checkout instead of a release)
#
# Options:
#   --release VERSION   release to download (default: the version this script was published with)
#   --zip FILE          install this extension zip instead of downloading one
#   --source            build and install the checkout this script is in (default when run from a clone)
#   --install-deps      install missing system packages (asks first; uses sudo)
#   -y, --yes           do not ask questions (with --install-deps: install without asking)
#   --no-enable         install but do not enable the extension
#   --dry-run           print what would be done, change nothing
#   --uninstall         remove the extension (same as uninstall.sh)
#   -h, --help
set -euo pipefail

UUID="home-assistant@maximeallanic.github.io"
REPO="maximeallanic/gnome-home-assistant"
PINNED_VERSION="0.1.0"
SUPPORTED_SHELL=(51)

VERSION="$PINNED_VERSION"
ZIP=""
FROM_SOURCE=0
INSTALL_DEPS=0
ASSUME_YES=0
ENABLE=1
DRY_RUN=0

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
run() {
    if ((DRY_RUN)); then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}
usage() {
    if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
        sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
    else
        say "Options: --release VERSION, --zip FILE, --install-deps, -y, --no-enable, --dry-run. Full help:"
        say "https://github.com/$REPO/blob/main/docs/installation.md"
    fi
}

# When piped into bash there is no script file: BASH_SOURCE is empty and the release is downloaded.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
[[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/extension/$UUID" ]] && FROM_SOURCE=1

while (($#)); do
    case "$1" in
        --release) (($# >= 2)) || die "--release needs a version"; VERSION="${2#v}"; FROM_SOURCE=0; shift ;;
        --zip) (($# >= 2)) || die "--zip needs a file"; ZIP="$2"; FROM_SOURCE=0; shift ;;
        --source) [[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/extension/$UUID" ]] || die "--source works only from a clone"
            FROM_SOURCE=1 ;;
        --install-deps) INSTALL_DEPS=1 ;;
        -y|--yes) ASSUME_YES=1 ;;
        --no-enable) ENABLE=0 ;;
        --dry-run) DRY_RUN=1 ;;
        --uninstall)
            [[ -n "$SCRIPT_DIR" && -x "$SCRIPT_DIR/uninstall.sh" ]] || die "uninstall.sh not found next to install.sh"
            exec "$SCRIPT_DIR/uninstall.sh" ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
done

ask() { # question -> 0 for yes
    ((ASSUME_YES)) && return 0
    local answer=""
    # Piped into bash: stdin is the script itself, so questions go to the terminal.
    if [[ -r /dev/tty ]]; then
        read -r -p "$1 [y/N] " answer </dev/tty || return 1
    fi
    [[ "$answer" == [yY]* ]]
}

# --- Checks -------------------------------------------------------------------------------------------------------

step "Checking the desktop"
command -v gnome-shell >/dev/null || die "GNOME Shell is not installed: this extension only runs in GNOME."
command -v gnome-extensions >/dev/null || die "the gnome-extensions command is missing (it comes with GNOME Shell)."
shell_major="$(gnome-shell --version 2>/dev/null | sed -n 's/^GNOME Shell \([0-9]*\).*/\1/p')"
say "GNOME Shell ${shell_major:-unknown}"
if [[ " ${SUPPORTED_SHELL[*]} " != *" ${shell_major:-?} "* ]]; then
    warn "this release declares GNOME Shell ${SUPPORTED_SHELL[*]} only; GNOME will refuse to enable it on ${shell_major:-this version}."
fi
if [[ "${XDG_CURRENT_DESKTOP:-}" != *GNOME* ]]; then
    warn "you do not seem to be in a GNOME session right now (XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-unset})."
fi

# A GObject introspection library is present when gjs can import it.
has_gi() { gjs -c "imports.gi.versions.$1 = '$2'; imports.gi.$1;" >/dev/null 2>&1; }

distro_family() {
    local id="" like=""
    if [[ -r /etc/os-release ]]; then
        # shellcheck source=/dev/null
        id="$(. /etc/os-release; echo "${ID:-}")"
        # shellcheck source=/dev/null
        like="$(. /etc/os-release; echo "${ID_LIKE:-}")"
    fi
    case " $id $like " in
        *" debian "*|*" ubuntu "*) echo debian ;;
        *" fedora "*|*" rhel "*) echo fedora ;;
        *" arch "*) echo arch ;;
        *" opensuse"*|*" suse "*) echo suse ;;
        *) echo unknown ;;
    esac
}

declare -A PKG_DEBIAN=([secret]=gir1.2-secret-1 [soup]=gir1.2-soup-3.0 [keyring]=gnome-keyring [gettext]=gettext)
declare -A PKG_FEDORA=([secret]=libsecret [soup]=libsoup3 [keyring]=gnome-keyring [gettext]=gettext)
declare -A PKG_ARCH=([secret]=libsecret [soup]=libsoup3 [keyring]=gnome-keyring [gettext]=gettext)
declare -A PKG_SUSE=([secret]=typelib-1_0-Secret-1 [soup]=typelib-1_0-Soup-3_0 [keyring]=gnome-keyring
    [gettext]=gettext-tools)

step "Checking dependencies"
command -v gjs >/dev/null || die "gjs is missing (it comes with GNOME Shell)."
missing=()
has_gi Secret 1 || missing+=(secret)
has_gi Soup 3.0 || missing+=(soup)
# A Secret Service provider keeps the access token: GNOME Keyring, or another one such as KeePassXC.
busctl --user --list 2>/dev/null | grep -q '^org.freedesktop.secrets' || command -v gnome-keyring-daemon >/dev/null ||
    missing+=(keyring)
if ((FROM_SOURCE)); then
    command -v msgfmt >/dev/null || missing+=(gettext)
fi
command -v curl >/dev/null || command -v wget >/dev/null || ((FROM_SOURCE)) || [[ -n "$ZIP" ]] ||
    die "curl or wget is needed to download the release."

if ((${#missing[@]})); then
    family="$(distro_family)"
    pkgs=()
    for m in "${missing[@]}"; do
        case "$family" in
            debian) pkgs+=("${PKG_DEBIAN[$m]}") ;;
            fedora) pkgs+=("${PKG_FEDORA[$m]}") ;;
            arch) pkgs+=("${PKG_ARCH[$m]}") ;;
            suse) pkgs+=("${PKG_SUSE[$m]}") ;;
        esac
    done
    case "$family" in
        debian) cmd=(sudo apt-get install -y "${pkgs[@]}") ;;
        fedora) cmd=(sudo dnf install -y "${pkgs[@]}") ;;
        arch) cmd=(sudo pacman -S --needed --noconfirm "${pkgs[@]}") ;;
        suse) cmd=(sudo zypper install -y "${pkgs[@]}") ;;
        *) die "missing: ${missing[*]} (libsecret and libsoup 3 GObject introspection, a keyring, gettext). Install them with your package manager, then run this again." ;;
    esac
    say "Missing: ${missing[*]}"
    say "Packages for your system: ${pkgs[*]}"
    if ((INSTALL_DEPS)) && ask "Run: ${cmd[*]} ?"; then
        run "${cmd[@]}"
    else
        die "install them with: ${cmd[*]}   (or run this installer again with --install-deps)"
    fi
else
    say "All dependencies are present."
fi

# --- Get the extension zip ----------------------------------------------------------------------------------------

cache="${XDG_CACHE_HOME:-$HOME/.cache}"
mkdir -p "$cache"
work="$(mktemp -d "$cache/gnome-home-assistant-install.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

download() { # url output
    if command -v curl >/dev/null; then
        run curl -fsSL --retry 2 -o "$2" "$1"
    else
        run wget -q -O "$2" "$1"
    fi
}

if [[ -n "$ZIP" ]]; then
    step "Using $ZIP"
    [[ -f "$ZIP" ]] || die "$ZIP not found"
elif ((FROM_SOURCE)); then
    step "Building the extension from $SCRIPT_DIR"
    run "$SCRIPT_DIR/scripts/pack.sh" --out "$work"
    ZIP="$work/$UUID.shell-extension.zip"
else
    step "Downloading release $VERSION"
    base="https://github.com/$REPO/releases/download/v$VERSION"
    ZIP="$work/$UUID.shell-extension.zip"
    download "$base/$UUID.shell-extension.zip" "$ZIP"
    download "$base/SHA256SUMS" "$work/SHA256SUMS"
    if ((!DRY_RUN)); then
        (cd "$work" && grep " $UUID.shell-extension.zip\$" SHA256SUMS | sha256sum --check --quiet) ||
            die "the downloaded zip does not match SHA256SUMS: not installed."
        say "Checksum verified."
    fi
fi

# --- Install ------------------------------------------------------------------------------------------------------

step "Installing $UUID for $(id -un)"
run gnome-extensions install --force "$ZIP"
if ((ENABLE)); then
    # A Shell that has never seen the extension cannot enable it before the next login (Wayland cannot restart the
    # Shell in place); the enabled-extensions setting is still recorded, so it starts at the next login.
    if run gnome-extensions enable "$UUID" 2>/dev/null; then
        say "Enabled."
    else
        run gsettings set org.gnome.shell enabled-extensions \
            "$(python3 -c 'import sys, ast; l = ast.literal_eval(sys.argv[1].replace("@as ", "")); u = sys.argv[2]
print(repr(l + [u] if u not in l else l))' "$(gsettings get org.gnome.shell enabled-extensions)" "$UUID")"
        say "It will be enabled at your next login."
    fi
fi

step "Done"
cat <<EOF
Next steps:
  1. Log out and back in (needed the first time on Wayland), then a notification asks you to connect
     Home Assistant. Or open the settings now:  gnome-extensions prefs $UUID
  2. In the settings, enter the address of Home Assistant and a long-lived access token, then Test Connection.
  3. In Home Assistant, put the label "gnome-topbar" on the entities to show in the top bar.
     Step-by-step guide: https://github.com/$REPO/blob/main/docs/home-assistant-setup.md
Check the installation at any time:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/verify.sh | bash
Remove it:
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/uninstall.sh | bash
(or ./verify.sh and ./uninstall.sh from a clone)
EOF
