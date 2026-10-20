#!/usr/bin/env bash
# Prepare a release: build the extension zip that the one-line installer downloads and pin its SHA-256 in install.sh.
#
#   scripts/release.sh VERSION               1. checks that metadata.json (version-name), package.json and
#                                               CHANGELOG.md are already at VERSION, the tree is clean and the tag
#                                               does not exist yet,
#                                            2. sets RELEASE_VERSION in install.sh,
#                                            3. builds dist/<uuid>.shell-extension.zip from that tree,
#                                            4. writes its SHA-256 into install.sh (RELEASE_SHA256) and commits it as
#                                               "chore(release): VERSION". Then tag and push (printed, never run).
#   scripts/release.sh --build-only VERSION  release workflow: change nothing, rebuild the zip from HEAD (the tag) and
#                                            fail unless the versions say VERSION and the zip has the pinned SHA-256.
#
# VERSION is like 0.1.0 or 0.2.0-rc1, without the leading v. The zip is reproducible (git archive of the committed
# tree, scripts/pack.sh, scripts/normalize-zip.py), so the zip the workflow builds from the tag has the same bytes as
# the one pinned here, provided gnome-extensions and msgfmt are the same versions: the workflow builds in Debian
# testing, so cut releases on Debian testing too.
set -euo pipefail
export LC_ALL=C
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
uuid="home-assistant@maximeallanic.github.io"
zipname="$uuid.shell-extension.zip"
die() { echo "error: $*" >&2; exit 1; }

case "${1:-}" in -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
build_only=0
if [[ "${1:-}" == --build-only ]]; then build_only=1; shift; fi
version="${1:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] ||
    die "usage: release.sh [--build-only] VERSION (like 0.1.0 or 0.2.0-rc1)"

json_field() { # file key -> value of a top-level string field
    sed -n "s/^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1
}
pinned() { sed -n "s/^$1='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" install.sh; }

"$root/scripts/release-notes.sh" "$version" >/dev/null || die "CHANGELOG.md has no section [$version]"
found="$(json_field package.json version)"
[[ "$found" == "$version" ]] || die "package.json version is '$found', expected $version"
found="$(json_field "extension/$uuid/metadata.json" version-name)"
[[ "$found" == "$version" ]] || die "metadata.json version-name is '$found', expected $version"

# build TREE-ISH: dist/$zipname packed from the committed tree only (no stray or ignored file can reach the zip).
build() {
    local work
    mkdir -p dist
    work="$(mktemp -d "$root/dist/.build.XXXXXX")"
    git archive --format=tar "$1" | tar -x -C "$work"
    "$work/scripts/pack.sh" --out "$work/out" >/dev/null
    mv -f "$work/out/$zipname" "dist/$zipname"
    rm -rf -- "$work"
    sha256sum "dist/$zipname" | cut -d' ' -f1
}

if ((build_only)); then
    [[ "$(pinned RELEASE_VERSION)" == "$version" ]] ||
        die "install.sh pins release '$(pinned RELEASE_VERSION)', expected $version"
    built="$(build HEAD)"
    [[ "$(pinned RELEASE_SHA256)" == "$built" ]] ||
        die "install.sh pins '$(pinned RELEASE_SHA256)', this tree builds $built (run scripts/release.sh $version on Debian testing)"
    echo "dist/$zipname matches the pin ($built)"
    exit 0
fi

[[ -z "$(git status --porcelain)" ]] || die "the working tree is not clean: commit or stash first"
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then die "tag v$version already exists"; fi
sed -i "s/^RELEASE_VERSION=.*/RELEASE_VERSION=$version/" install.sh
git add install.sh
# The zip depends on extension/ and po/ only, so the commit below (which also changes the pin) builds the same bytes.
sha="$(build "$(git write-tree)")"
sed -i "s/^RELEASE_SHA256=.*/RELEASE_SHA256='$sha'/" install.sh
[[ "$(pinned RELEASE_SHA256)" == "$sha" ]] || die "could not write the pin into install.sh"
git add install.sh
git commit -q -m "chore(release): $version"
echo "Pinned $zipname ($sha) for $version in install.sh and committed. Not done by this script (run them yourself):"
echo "  git tag -s v$version -m 'v$version'     # or: git tag -a v$version -m 'v$version'"
echo "  git push origin main v$version          # the Release workflow rebuilds the zip, checks the pin and publishes"
