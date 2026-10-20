# GitHub metadata, name and brand

Prepared for the owner before publication. Nothing here has been applied to GitHub. The extension's display name is
now **Hearth for Home Assistant** (short: Hearth); its UUID, GSettings schema and the repository slug are unchanged.
Research date: 2026-10-20.

## Pitch line

> Home Assistant in your GNOME top bar: label an entity, it's on your desktop.

French: « Home Assistant dans la barre du haut de GNOME : étiquetez une entité, elle est sur votre bureau. »

## Repository description (GitHub "About", 350 characters max)

> Unofficial GNOME Shell extension for Home Assistant: entity chips in the top bar, a Quick Settings grid for
> lights, covers, scripts and to-do lists, and your computer as a mobile_app device (sensors, commands,
> notifications). You choose what shows with Home Assistant labels. GNOME 51.

(about 300 characters). Website field: leave empty until there is an extensions.gnome.org page.

## Topics

`gnome`, `gnome-shell`, `gnome-shell-extension`, `gnome-extension`, `home-assistant`, `homeassistant`,
`home-automation`, `smart-home`, `quick-settings`, `mobile-app`, `linux`, `linux-desktop`, `gjs`, `wayland`

`homeassistant` (one word) is kept because many Home Assistant projects on GitHub are tagged that way. `hass` and
`ha` are left out: the Home Assistant name guide asks not to abbreviate the name.

## Social preview

Upload `docs/marketing/social-preview.png` (1280×640) in **Settings > General > Social preview**. It shows two real
captures (top bar chips, Quick Settings grid), the words "Unofficial GNOME Shell extension" and a non-affiliation
line, and no Home Assistant logo. The text does not contain the extension's name, so it survives a rename.

The PNGs are rendered from the SVG next to them. librsvg only loads images inside the SVG's folder, so render from a
scratch copy:

```sh
s=~/.cache/claude-scratch/gnome-ha-marketing && mkdir -p "$s/screenshots" && cp screenshots/*.png "$s/screenshots/"
for f in social-preview hero hero.fr; do
    sed 's#\.\./\.\./screenshots/#screenshots/#g' "docs/marketing/$f.svg" > "$s/$f.svg"
    rsvg-convert "$s/$f.svg" -o "docs/marketing/$f.png"
done
rm -r ~/.cache/claude-scratch/gnome-ha-marketing
```

`hero.png` and `hero.fr.png` are the images at the top of the READMEs: real captures placed side by side, scaled,
with captions, never retouched.

## What the brand rules say

Sources read on 2026-10-20:

- Home Assistant **Name and logo** guide, <https://contributors.home-assistant.io/brand/name-and-logo/>:
  - write "Home Assistant" in full; "HA", "HASS" and "Home-Assistant" are not to be used, and the name is not
    translated;
  - "The logo is a trademark and the property of the Open Home Foundation" and "It is not available for commercial
    use without written permission from the foundation" (commercial means promoting something for sale; requests to
    partner@openhomefoundation.org);
  - fan accounts, groups or channels must "Make clear in its name or description that it is not official";
  - certified partners may not call a device a "Home Assistant product"; "Works with Home Assistant" wording belongs
    to the certification programme.
- Home Assistant **Brand** page, <https://contributors.home-assistant.io/brand/>: community questions and accounts
  that look official go to community@openhomefoundation.org.
- There is no published Open Home Foundation trademark policy for software names. The Foundation's site has no
  trademark page; the closest rule is the logo rule above. **No rule explicitly allows or forbids "… for Home
  Assistant" in a community project's name.**
- **extensions.gnome.org review guidelines**, <https://gjs.guide/extensions/review-guidelines/review-guidelines.html>:
  "Extensions MUST NOT include copyrighted or trademarked content without proof of express permission from the
  owner", with brand names and phrases, and logos and artwork, as examples. In practice an extension named "Home
  Assistant Extension" (<https://extensions.gnome.org/extension/4170/home-assistant-extension/>) is listed and keeps
  receiving reviews, so the rule is not enforced word for word on descriptive use; it is still the rule a reviewer
  can apply.
- GNOME Foundation trademarks, <https://foundation.gnome.org/legal-and-trademarks/>: fair use is allowed; other uses
  need permission from licensing@gnome.org. "GNOME" in an extension's name is common on extensions.gnome.org.

## The name

**Decided (2026-10-20): Hearth for Home Assistant**, short "Hearth". The extension has a name of its own and keeps
"for Home Assistant" as a descriptor, rather than shipping as "Home Assistant for GNOME" (its first name). The
reasoning that led there, kept for reference:

Why:

1. "Home Assistant for GNOME" puts the trademark first and reads like an official Home Assistant app for GNOME, in the
   same shape as the official companion apps. The name guide's one rule for unofficial things is that the name or
   description must make clear they are not official.
2. The extensions.gnome.org rule above asks for proof of permission for brand names. A distinct name with "for Home
   Assistant" in the description is the version a reviewer has the least reason to question, and the
   [extensions.gnome.org notes](../extensions-gnome-org.md) listed the name and the logo glyph as open points.
3. Findability does not depend on the name: the words "Home Assistant" and "GNOME" stay in the description, the
   topics, the README's first line and the extensions.gnome.org description, which is where people search.

"GNOME Shell extension for Home Assistant" would also have been nominative use; "Home Assistant for GNOME" was the
riskiest form. Asking the Open Home Foundation (community@openhomefoundation.org) is the only way to be sure; nothing
has been sent.

### Options that were considered

Searches on 2026-10-20 found no Home Assistant or GNOME project using names 1 and 2. They are not trademark
clearance; check the extensions.gnome.org search and GitHub before deciding.

| Option | Name on extensions.gnome.org | Findability | Trademark risk |
|---|---|---|---|
| 1 (chosen) | **Hearth for Home Assistant** | short, memorable, "home" meaning; search hits come from the descriptor | low |
| 2 | **Porchlight for Home Assistant** | evokes a glanceable light at the door, i.e. the top bar chip | low |
| 3 | **Home Panel for Home Assistant** | descriptive words people type ("home", "panel"), but generic and hard to own | low |
| 4 | **GNOME Shell extension for Home Assistant** | best literal match for searches, no identity of its own | low to medium (two marks, both descriptive) |
| 5 | keep **Home Assistant for GNOME** (the first name) | strongest keyword match | highest: reads as official, may be questioned at review |

Avoided on purpose: anything with "HA" or "Hass" (abbreviations the name guide rejects), "Companion" (the official
apps' name), "Works with Home Assistant" (a certification), and "Homebar" (an existing HomeKit app for the Mac).

The rename touched `metadata.json` (`name`, and the description now ends with the non-affiliation line), the
`mobile_app` `app_name`, the README titles, the docs and these drafts; the social preview and the hero images are
name-free. The UUID `home-assistant@maximeallanic.github.io`, the GSettings schema and the repository slug
`gnome-home-assistant` can stay: they are identifiers, and the slug keeps the search words.

## Logo

- The README, the hero images and the social preview use **no Home Assistant logo**; they show real captures in
  which the Home tile uses a generic house icon.
- The extension no longer ships the Material Design Icons `home-assistant` glyph (it depicted the Home Assistant
  logo). Its notifications use `go-home-symbolic` from the Adwaita icon theme, the same house as the Home tile.

## Non-affiliation notice

Present in `metadata.json` (so on extensions.gnome.org), `README.md`, `README.fr.md`, `NOTICE.md`, `docs/faq.md`
and on the social preview. Suggested wording for
any other place (release notes, extensions.gnome.org description, posts):

> Unofficial community project, not affiliated with or endorsed by Home Assistant or the Open Home Foundation.
