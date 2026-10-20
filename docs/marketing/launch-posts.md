# Launch posts

Drafts for the owner. Nothing has been posted. Every claim below is backed by the README, `docs/` or the changelog
of version 0.1.0; do not add numbers, users or compatibility that the repository does not show.

**Read this first.** These drafts were written with an AI assistant, and the project's commits carry an AI co-author.
Several venues care about both:

| Venue | Rule that matters (checked 2026-10-20) | What to do |
|---|---|---|
| Home Assistant forum | Moderators' working rule (not yet in the official rules): a post sharing a project "that includes AI-generated code or content" must disclose it in the first post; LLM help for translation or grammar should preferably be disclosed too. Source: [forum thread 1012933](https://community.home-assistant.io/t/turn-your-ai-chats-into-community-knowledge-before-forums-disappear/1012933) | Keep the disclosure line, filled in honestly |
| Hacker News | [Guidelines](https://news.ycombinator.com/newsguidelines.html): "Don't post generated text or AI-edited text." [Show HN](https://news.ycombinator.com/showhn.html): the project must be "something you've worked on personally and which you're around to discuss"; "Don't post quickly-generated one-offs"; no vote or comment solicitation | Use the title as is; **write the first comment yourself** from the fact list below. Do not paste AI text |
| r/gnome and GNOME Discourse | GNOME Discourse adopted r/gnome's policy (Emmanuele Bassi, 2026-07-01): topics "written entirely via LLM" and topics announcing "projects that are entirely written by an LLM" are removed. [Source](https://discourse.gnome.org/t/llm-generated-projects-and-content-on-gnomes-discourse-instance/36006) | Rewrite the post in your own words and disclose AI use. If most of the code was written by an AI, expect removal: decide before posting |
| extensions.gnome.org | [Review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html): AI as a tool is fine, but developers must "justify and explain the code they submit"; signs of mostly AI-generated code lead to rejection | Not a post, but the same question decides whether "coming to extensions.gnome.org" can be promised. The drafts do not promise it |
| r/homeassistant | Rules could not be fetched (Reddit blocks automated reading). Check the sidebar, the required flair and any AI rule before posting | Use the draft only after reading the rules |
| Mastodon / Fediverse | No network-wide rule; each instance has its own. Hashtags make posts discoverable | Disclose AI use if your instance asks; CamelCase hashtags for screen readers |

Self-promotion in general: post once per venue, answer every comment, do not ask anyone to upvote.

Placeholders: `[MOTIVATION]` is why you built it, in your words. `[AI USE]` is an honest sentence on how AI tools were
used (code, docs, these posts). `[REPO]` is `https://github.com/maximeallanic/gnome-home-assistant` once it is public.

---

## Home Assistant community forum, "Share your Projects"

**Title:** GNOME Shell extension: Home Assistant chips in the top bar, a Quick Settings grid, and the computer as a
mobile_app device

**Body:**

Hi all,

[MOTIVATION]

I made an unofficial GNOME Shell extension that brings Home Assistant into the GNOME desktop. It is version 0.1.0, a
pre-release, for GNOME Shell 51 only.

What it does:

- **Top bar chips.** Put the label `gnome-topbar` on an entity and it becomes a chip with its state and icon. Add
  `gnome-topbar-alert` to make it red. An empty state hides the chip, so a template sensor can show "2 to do" only
  when there is something to do.
- **Quick Settings grid.** One template sensor labelled `gnome-grid` describes a grid of mini-tiles: lights,
  scripts, choices, sliders (brightness, cover position, number) and to-do items. Any mini-tile can get a keyboard
  shortcut.
- **The computer as a device (optional).** It registers through `mobile_app`, like the phone apps: up to 25 sensors
  (locked, active, volume, brightness, battery, media, CPU...), 14 commands sent as `command_*` notifications
  (volume, lock, screen off, dark style, media keys, open a URL, launch an app), and notifications with action
  buttons that fire `mobile_app_notification_action`. The preferences generate a package with switches, numbers and
  buttons for the commands.
- **Setup from the preferences:** address, long-lived token, Test Connection, Save. The token goes to the GNOME
  keyring.

Choosing entities with labels means nothing about your home lives in the extension: you add or remove a label in
Home Assistant and the desktop follows. State words ("on", "open", "heat") use Home Assistant's own translations for
the desktop language.

Privacy: it talks only to your Home Assistant, plus jsDelivr for `mdi:` icons the first time they are shown (can be
turned off). No analytics. Home Assistant can only send the 14 listed commands; there is no "run a shell command".

Limitations, honestly: GNOME Shell 51 only; the Caffeine sensor needs the Caffeine extension; only Debian package
names were checked on a real system; tested against a fake Home Assistant and a nested GNOME Shell, not yet on many
machines. Not on extensions.gnome.org yet.

Install, screenshots and docs: [REPO]

Feedback from other distributions and hardware is what I need most.

Disclosure: [AI USE]

Not affiliated with or endorsed by Home Assistant or the Open Home Foundation.

*(Attach `docs/marketing/hero.png` and `screenshots/light-preferences.png`.)*

---

## r/homeassistant

**Title:** I made a GNOME Shell extension: label an entity in Home Assistant, it shows up in the top bar

**Body:**

[MOTIVATION]

It is an unofficial GNOME Shell 51 extension (MIT, pre-release 0.1.0):

- entities labelled `gnome-topbar` become top bar chips (state + icon; `gnome-topbar-alert` makes them red);
- one template sensor labelled `gnome-grid` gives a Quick Settings grid: lights, scripts, sliders, cover position,
  to-do lists, with optional keyboard shortcuts;
- optional `mobile_app` registration, like the phone apps: sensors such as locked, active, volume and battery, 14
  commands from automations (volume, lock, screen off, dark style, media keys...), and actionable notifications.
  No MQTT broker, no separate agent.

Setup is in the preferences (URL + token + Test Connection), token in the keyring. Only GNOME 51 for now, and it has
been tested in a nested Shell against a fake Home Assistant rather than on many machines, so reports are very welcome.

[REPO]

Disclosure: [AI USE]. Not affiliated with Home Assistant or the Open Home Foundation.

*(Image post alternative: `docs/marketing/hero.png` with the link in the first comment, if the subreddit prefers.)*

---

## r/gnome

Rewrite in your own words before posting (see the table above).

**Title:** Home Assistant in the top bar and Quick Settings: an extension for GNOME 51

**Body:**

[MOTIVATION]

The extension adds chips next to the system status icons and a "Home" tile in Quick Settings with mini-tiles
(toggles, choices, sliders, to-do items), with light and dark stylesheets that follow the system accent colour.
What appears is decided in Home Assistant with labels, so the preferences never need a list of entities. The token
is kept with libsecret.

GNOME-side details people may ask about:

- one WebSocket connection; nothing created before `enable()`, everything released in `disable()`;
- it also runs in the `unlock-dialog` session mode, only so the optional companion's "locked" and "active" sensors
  keep reporting; chips and tiles are hidden there and shortcuts are released;
- strings through gettext (English, French); numbers follow the locale;
- GNOME Shell 51 only, because it builds on Quick Settings internals; not on extensions.gnome.org yet.

[REPO]

Disclosure: [AI USE]

---

## Show HN

**Title (72 characters):**

> Show HN: A GNOME Shell extension that puts Home Assistant in the top bar

(Avoid "HA" in the title: the Home Assistant name guide asks for the name in full.)

**URL:** [REPO]

**First comment: write it yourself.** HN forbids generated or AI-edited text. Facts you can draw on, in your own
sentences:

- [MOTIVATION]: why you built it, what you use it for.
- Design choice: entities are chosen by Home Assistant labels, so the extension holds no list of entity ids; a
  template sensor describes the Quick Settings grid.
- The computer registers through Home Assistant's `mobile_app` webhook API, the same one the phone apps use; 14
  allow-listed commands, no shell command, some refused while the screen is locked.
- It runs in the `unlock-dialog` session mode only for the lock and activity sensors.
- Token in the keyring via libsecret; the only third-party request is the jsDelivr CDN for icons, and it can be off.
- Tests: unit and integration tests against a fake Home Assistant server, screenshots from a nested headless GNOME
  Shell 51.
- Limits: GNOME 51 only; pre-release; not on extensions.gnome.org.
- [AI USE]: HN readers will ask; say it plainly.

---

## Mastodon (under 500 characters)

> I made an unofficial GNOME Shell extension for #HomeAssistant: label an entity and it becomes a chip in the top
> bar; one template sensor gives a Quick Settings grid (lights, sliders, to-do lists). Optionally the computer
> registers as a mobile_app device: sensors, commands, notifications. No MQTT. Token in the keyring. GNOME 51 only,
> pre-release, feedback welcome.
>
> [REPO]
>
> #GNOME #Linux #SmartHome #OpenSource

About 430 characters as Mastodon counts them (every link counts as 23); the French version is about 470. Add `[AI USE]` in a reply or a
content note if your instance or audience expects it, and alt text on the image, for example: "Top bar chips showing
21.4° and a red chores count, and the Quick Settings Home grid with lights, blinds, heating and a to-do list."

French version:

> J'ai fait une extension GNOME Shell non officielle pour #HomeAssistant : posez une étiquette sur une entité, elle
> devient une puce dans la barre du haut ; un capteur de modèle donne une grille dans les réglages rapides
> (lumières, curseurs, listes de tâches). En option, l'ordinateur devient un appareil mobile_app : capteurs,
> commandes, notifications. Sans MQTT. GNOME 51, préversion, retours bienvenus.
>
> [REPO]
>
> #GNOME #Linux #Domotique #LogicielLibre
