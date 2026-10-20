#!/usr/bin/env bash
# Build the extension zip in dist/, ready for extensions.gnome.org or for `gnome-extensions install`.
#
#   scripts/pack.sh [--out DIR]
#
# Uses `gnome-extensions pack`: every module and directory is added with --extra-source, the po/ catalogues are
# compiled into the zip's locale/ tree, and the GSettings schema is included.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
uuid="home-assistant@maximeallanic.github.io"
src="$root/extension/$uuid"
out="$root/dist"
die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --out) [[ $# -ge 2 ]] || die "--out needs a directory"; out="$2"; shift ;;
        -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
    shift
done

command -v gnome-extensions >/dev/null || die "gnome-extensions is required (package gnome-shell or gnome-shell-extension-prefs)"
command -v msgfmt >/dev/null || die "msgfmt is required (package gettext)"
mkdir -p "$out"

args=(--force --quiet --out-dir "$out" --podir="$root/po" --gettext-domain="$uuid"
    --schema="schemas/org.gnome.shell.extensions.home-assistant.gschema.xml")
while IFS= read -r entry; do
    case "$entry" in
        extension.js|metadata.json|prefs.js|stylesheet.css|schemas|locale|po) ;;
        *) args+=("--extra-source=$src/$entry") ;;
    esac
done < <(find "$src" -mindepth 1 -maxdepth 1 ! -name 'gschemas.compiled' -printf '%f\n' | sort)

gnome-extensions pack "${args[@]}" "$src"
zip="$out/$uuid.shell-extension.zip"
[[ -f "$zip" ]] || die "expected $zip was not produced"
echo "packed $zip"
