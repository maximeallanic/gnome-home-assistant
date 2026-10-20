#!/usr/bin/env bash
# Run every headless check of the repository. Safe in any session: no window is opened, nothing is installed, nothing
# is written outside the repository and temporary directories. The screenshot runner (tests/screenshots) is not run.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 2
ext="extension/home-assistant@maximeallanic.github.io"
status=0
scratch="$(mktemp -d "${TMPDIR:-/tmp}/gnome-ha-run-XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT

step() { # name command...
    local name="$1"; shift
    if out="$("$@" 2>&1)"; then
        echo "PASS  $name"
    else
        echo "FAIL  $name"; echo "$out"; status=1
    fi
}

for f in tests/unit/test_*.js tests/integration/test_*.js; do
    step "$f" gjs -m "$f"
done
step "GSettings schema compiles" glib-compile-schemas --strict --dry-run "$ext/schemas"
step "French catalogue complete" bash -c "msgfmt --check -o /dev/null po/fr.po && msgcmp po/fr.po po/$(basename "$ext").pot"
step "translation template up to date" scripts/update-po.sh --check
step "POTFILES lists every module" bash -c "diff <(find '$ext' -name '*.js' | sort) <(sort po/POTFILES)"
step "dark and light stylesheets share their layout" bash -c "diff \
    <(sed -n '/LAYOUT START/,/LAYOUT END/p' '$ext/stylesheet-dark.css') \
    <(sed -n '/LAYOUT START/,/LAYOUT END/p' '$ext/stylesheet-light.css')"
step "example package up to date" bash -c "diff <(gjs -m scripts/example-package.js) ha/packages/gnome_computer.example.yaml"
if python3 -c 'import yaml' 2>/dev/null; then
    step "example YAML parses" python3 -c 'import sys, yaml
for f in sys.argv[1:]: yaml.safe_load(open(f))' ha/packages/*.yaml
else
    echo "SKIP  example YAML parses (python3-yaml not installed)"
fi
step "no source file over 500 lines" bash -c "! git ls-files -co --exclude-standard -- '*.js' '*.sh' '*.py' '*.css' | \
    grep -v '^node_modules/' | xargs -r wc -l | grep -v ' total$' | awk '\$1 > 500 {print; bad=1} END {exit !bad}'"
if command -v gnome-extensions >/dev/null; then
    step "extensions.gnome.org zip" bash -c "scripts/pack.sh --out '$scratch/dist' && python3 tests/check_packs.py '$scratch/dist'"
    step "zip is reproducible" bash -c "scripts/pack.sh --out '$scratch/again' >/dev/null && \
        cmp '$scratch/dist/'*.zip '$scratch/again/'*.zip"
    step "one-line install: pin, checksum, HTTPS only" tests/test_install.sh
else
    echo "SKIP  extensions.gnome.org zip, reproducible zip, one-line install (gnome-extensions not installed)"
fi
step "release notes for the current version" bash -c "scripts/release-notes.sh \
    \"\$(sed -n 's/.*\"version-name\": \"\\([^\"]*\\)\".*/\\1/p' '$ext/metadata.json')\" >/dev/null"
if [[ -x node_modules/.bin/eslint ]]; then
    step "eslint" node_modules/.bin/eslint .
else
    echo "SKIP  eslint (run 'npm ci' first)"
fi
if command -v shellcheck >/dev/null; then
    step "shellcheck" bash -c "git ls-files -co --exclude-standard -z -- '*.sh' | xargs -0 -r shellcheck -x"
else
    echo "SKIP  shellcheck (not installed)"
fi
[[ $status -eq 0 ]] && echo "All checks passed." || echo "Some checks failed."
exit $status
