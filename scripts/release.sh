#!/usr/bin/env bash
# Check that the repository is ready to release VERSION, then print (never run) the tag commands.
#
#   scripts/release.sh [--ci] VERSION    VERSION like 0.1.0 or 0.2.0-rc1, without the leading v
#
# Checks: version format, CHANGELOG.md has a section for it, clean working tree, the tag does not exist yet, and the
# same version in metadata.json (version-name), package.json and install.sh (PINNED_VERSION, the release the one-line
# installer downloads). --ci (release workflow): skip the working-tree and tag checks, print nothing to run.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
uuid="home-assistant@maximeallanic.github.io"
die() { echo "error: $*" >&2; exit 1; }

case "${1:-}" in -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
ci=0
if [[ "${1:-}" == --ci ]]; then ci=1; shift; fi
version="${1:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "usage: release.sh VERSION (like 0.1.0 or 0.2.0-rc1)"

"$root/scripts/release-notes.sh" "$version" >/dev/null || die "CHANGELOG.md has no section [$version]"
if ((ci == 0)); then
    [[ -z "$(git -C "$root" status --porcelain)" ]] || die "the working tree is not clean"
    if git -C "$root" rev-parse -q --verify "refs/tags/v$version" >/dev/null; then die "tag v$version already exists"; fi
fi

json_field() { # file key -> value of a top-level string field
    sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1
}
found="$(json_field "$root/package.json" version)"
[[ "$found" == "$version" ]] || die "package.json version is '$found', expected $version"
found="$(json_field "$root/extension/$uuid/metadata.json" version-name)"
[[ "$found" == "$version" ]] || die "metadata.json version-name is '$found', expected $version"
found="$(sed -n 's/^PINNED_VERSION="\([^"]*\)"$/\1/p' "$root/install.sh")"
[[ "$found" == "$version" ]] || die "install.sh PINNED_VERSION is '$found', expected $version"

((ci == 0)) || { echo "versions consistent: $version"; exit 0; }
echo "Ready: v$version. Not done by this script (run them yourself, on main):"
echo "  git tag -s v$version -m 'v$version'     # or: git tag -a v$version -m 'v$version'"
echo "  git push origin v$version               # the Release workflow builds and publishes the release"
