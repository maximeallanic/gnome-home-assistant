#!/usr/bin/env bash
# Regenerate the translation template from the sources and merge it into every catalogue listed in po/LINGUAS.
#
#   scripts/update-po.sh            update po/*.pot and po/*.po
#   scripts/update-po.sh --check    fail when po/*.pot is not up to date with the sources
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
domain="home-assistant@maximeallanic.github.io"
pot="$root/po/$domain.pot"
cd "$root"

generate() { # output
    find "extension/$domain" -name '*.js' | sort > po/POTFILES
    xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=C_:1c,2 --keyword=ngettext:1,2 \
        --package-name=gnome-home-assistant \
        --package-version="$(sed -n 's/.*"version-name": "\([^"]*\)".*/\1/p' "extension/$domain/metadata.json")" \
        --msgid-bugs-address="https://github.com/maximeallanic/gnome-home-assistant/issues" \
        -o "$1" -f po/POTFILES
}

if [[ "${1:-}" == "--check" ]]; then
    tmp="$(mktemp)"
    trap 'rm -f -- "$tmp"' EXIT
    generate "$tmp"
    if ! diff -q <(grep -v '^"POT-Creation-Date:' "$tmp") <(grep -v '^"POT-Creation-Date:' "$pot") >/dev/null; then
        echo "po/$domain.pot is out of date: run scripts/update-po.sh" >&2
        exit 1
    fi
    exit 0
fi

generate "$pot"
while read -r lang; do
    [[ -n "$lang" && "$lang" != \#* ]] || continue
    msgmerge --quiet --update --backup=none "po/$lang.po" "$pot"
done < po/LINGUAS
