## What and why

<!-- What does this change, and what problem does it solve? -->

Fixes #

## Type of change

<!-- feat / fix / docs / refactor / test / ci / chore. The PR title must be a Conventional Commit, e.g. "fix(grid): ..." -->

## How I checked it

<!-- Commands you ran, GNOME version, distribution, session type (Wayland/X11). -->

## Screenshots (visual changes)

<!-- Before / after, taken with tests/screenshots/run.sh (fake Home Assistant). No personal data: your entities, names, Wi-Fi networks, addresses. -->

## Checklist

- [ ] `tests/run.sh` passes locally
- [ ] `disable()` restores everything `enable()` touched (no leaked signal, source, actor or patched method)
- [ ] `CHANGELOG.md` updated
- [ ] New user-visible strings go through gettext and `po/fr.po` is updated (`scripts/update-po.sh`)
- [ ] Code, comments and messages are in English; no language, locale or script is hard-coded
- [ ] No source file over 500 lines
- [ ] I fixed the cause, not the symptom (no swallowed errors, no special cases)
- [ ] I read [CONTRIBUTING.md](https://github.com/maximeallanic/gnome-home-assistant/blob/main/CONTRIBUTING.md) and the PR title is a Conventional Commit
