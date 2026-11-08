# Hmux

A terminal-first Herdr layout: a fixed 232px glass sidebar on the left, a
full-width 32px title bar above everything, and the active tab's panes filling
the rest. The sidebar stacks agents (with their sub-agents), then folders and
their sessions, then a session footer with folder, branch and SSH machines.
Two themes (white, black) follow the system appearance and crossfade when you
press the sun/moon button, instead of cutting.

![Hmux](preview.png)

## What you see

Top to bottom, left to right.

**Title bar — 32px tall, full width.** A block with `window_drag: true` and the
theme's `glass` background. It starts 78px from the left so the macOS window
buttons sit in it. Buttons are 12px icons with 4px padding in 5px rounded
corners, drawn in `dim` and turning `foreground` + `hover` background on hover,
one slightly lighter background when active.

- Sidebar toggle (`layout.toggle`), leftmost, active while the sidebar shows.
- Bell with a count badge: a 13px accent circle, 8.5px semibold
  `accent_foreground` text, showing up to `9+`.
- The middle label: the current space, then ` · `, then the session — its name
  if it has one, else `Command N`, in `dim`, truncated.
- Sun (in the dark theme) or moon (in the light theme) — the theme button.
- `+` — new session in the current space (`tab.new`).

**Sidebar — 232px, resizable between 180 and 380px.** `glass` background, a 1px
`edge` divider on its right, 12px text. It scrolls (a slim scrollbar) except
the Session footer, which stays pinned at the bottom.

- **Agents** header: `AGENTS`-style 10.5px semibold `dim` title with the agent
  count at 70% opacity.
- **Agent rows — 34px tall**, 4px side margin, 6px inner padding, 5px rounded,
  7px gap between icon and text. Program icon at 14px (tinted or full color),
  name in `foreground` when focused else `muted`, then a 10.5px `dim` sub-line
  `space · session`. Pinned agents show a 10px accent pin before the name. A
  blocked agent carries a `Needs you` chip: 16px tall, 5px side padding, 4px
  rounded, `blocked` at 15% as its background, 10px semibold `blocked` text.
  Otherwise a status mark sits at the right: a spinning ring (12px, 800ms per
  turn) while working, a 6px dot for blocked, done and idle (5px).
- **Sub-agent rows — 24px**, indented 14px per level (up to three levels),
  with a small elbow (8×12px, `input` colored left+bottom border) instead of the
  status mark; 11.5px `muted` name, 12px icon, 9px status mark.
- **Tabs** header with a `+` (`tab.new` in the focused space).
- **Folder rows — 22px**, 4px side margin, 5px rounded, a 5% `foreground` wash
  so folders read as groups; `foreground` when active. A 10px chevron
  (`chevron-right` folded, `chevron-down` open), a 6px 2px-rounded dot (`accent`
  when the space is active, `input` otherwise), the name 12px semibold
  (`foreground` active, `muted` else). A branch badge follows when the space is
  in a git repo: 10.5px `dim`, git-branch icon, name capped at 90px. A folded
  folder shows its session count (10.5px `dim`) and its status mark.
- **Session rows — 22px**, indented 6px inside the folder. A 22px-wide time
  column leads (10px: `now`, `12m`, `3h`, `2d`), `working` colored while the
  agent is working, else `dim`. Then the label (`foreground` when it is the
  active session, `muted` otherwise), `2 splits` when split (10px `dim`), a
  zoom icon when zoomed, and a 9px status mark. The active session gets an
  absolutely placed highlight: `selected` background, 2px `accent` left border,
  sliding vertically with a spring (smooth, response 314ms/damping 0.9) when the
  active session changes.
- **Session footer.** 10.5px `dim` text, top border. A `Session` title with
  `N spaces · M tabs` on the right; one chip per status present (6px dot +
  `Working 3`); then the focused pane's folder as `~/…` with a folder icon and
  its branch with a git-branch icon; then the machine fold: `This Mac + 2
  machines · 1 offline`. Opened, it lists each machine (22px row) with a server
  icon, its name, a 6px state dot and a word: Connected (done color),
  Connecting (working), Offline (idle); each machine folds open into its spaces
  and their sessions, with `No spaces on this machine yet.` when empty.

**Panes.** A 1px gap between panes, square corners, the `background` theme
color; the focused pane gets a 1px `focusring` border. Each pane has a 20px
header along its top: 8px inner padding, 11px text, program icon at 11px, the
program/title in medium (capped 220px), the folder as `~/…` in `dim`, a
`Needs you` tag when blocked, a 9px status mark, and — on hover — four 11px
icon buttons (split right, split down, zoom/unzoom, close) that fade in over
120ms.

## How it behaves

**Agent status.** Working: a spinning ring, `working` color, name at normal
weight. Blocked: the `Needs you` chip (and the tag in the pane header), a
`blocked` dot, sorted above everything except pinned agents. Done: a `done` dot;
Herdr turns it idle once the person looks at it. Idle: a 5px `idle` dot. The
sort is pinned first, then blocked > done > working > idle, then most recent.
The sidebar asks Herdr to keep agent navigation in this same order
(`setAgentOrder`).

**Clicks.** Folder row: click folds or unfolds — it never switches the space;
double-click renames it in place; right-click opens its menu. Session row:
click goes there (`space.select` then `tab.select`); double-click renames it;
right-click opens its menu. Agent row: click focuses it (`agent.focus`); right-
click offers Go to agent, Pin/Unpin (`terminal.pin`), Peek (`terminal.peek`).
Sub-agent: Go to agent, Peek, Open in new tab (`terminal.keep`, `place: tab`).
Title-bar buttons: sidebar toggle, bell (popup), sun/moon (crossfade), `+`
(new session). Pane header buttons: split (`pane.split`), zoom (`pane.zoom`),
close (`pane.close`); clicking the header focuses the pane.

**Menus.** A popup window (200×300) with 26px-tall rows, 5px rounded, hover
`hover`, 6px separators in `border`.
- Session: Go to session, Rename, Reset name (only when named), Split right,
  Split down, Close session (in `blocked` color).
- Folder: New session, Rename, Reset name (only when named), Reveal in Finder,
  Copy path, New worktree (only in a repo), Close folder.
- Closing a session or folder opens a 360×170 dialog: title, one line of
  consequence, `Keep` and a `Close session` / `Close folder` button in the
  blocked color; Enter and Escape both choose `Keep`.

**Rename.** Inline: the row turns into a text field pre-filled with the current
name (no placeholder), focused after 30ms. Enter or clicking away saves, Escape
cancels. An unchanged name is not written, so auto names keep following their
folder or first agent.

**Drag to reorder.** Press a folder (the whole group moves) or a session. After
4px of travel it lifts: `raised` background, medium shadow, 1px accent border,
nudged up 2px. Other rows spring aside live (smooth spring) to show where it
will land; a folder's whole group moves with it. Release sends one
`space.move` (`index` = first sibling's index + target + 1) or `tab.move`
(`index` = target + 1); the preview is held until the new order arrives
(fallback 1200ms) so nothing slides back. Released outside the sidebar, the
next click anywhere cancels.

**Folders unfold by themselves** the first time their space is shown.

**Theme crossfade.** Press the sun/moon. The mod takes `herdr-app shot` of the
window into `.cache/hmux/`, opens a borderless window overlay (`kind: "window"`,
`frame: "none"`, `key: "hmux-fade"`, at 0,0) with the picture at the window's
size — the title bar's width divided by `settings().zoom`, height from
`window.json` bounds aspect — flips `settings.json`'s `appearance` underneath
(after 120ms), waits 180ms for the new theme to draw, then fades the picture's
opacity to 0 over 700ms ease-in-out and deletes it. While fading, further
presses are ignored. If Reduce Motion is on (`defaults read
com.apple.universalaccess reduceMotion`) or the shot fails, it just writes the
appearance. The cover never blocks the crossfade: the whole WINDOW's colors go
through the transition.

**Notifications.** The title bar watches agent statuses. The first render seeds
without posting. Every later change into blocked or done appends
`{id, address, status, title, where, icon, tint, at}` to the shared list
(capped at 60), newest first. The bell shows the number newer than
`hmux.inboxSeen` (set when the popup opens). The popup (320×380, 34px header,
`Clear all`, list 346px) shows icon, title, time, `Needs your input.` /
`Finished its work.` in the status color and `space · session`; live items
jump to the agent when clicked, ended ones say `· Agent has ended`. Empty:
`No new notifications.` and `When an agent finishes or needs you, it shows up
here.`

**Motion.** Tokens only (no ms values in components): 120ms fast, 200ms base,
320ms slow, 700ms theme fade; springs snappy (237ms, ζ0.945), smooth
(314ms, ζ0.9), gentle (424ms, ζ0.944); spinner loop 800ms. Everything collapses
to instant (or opacity-only 120ms) under Reduce Motion. Elapsed labels refresh
every 30s; nothing else polls.

## Built from

**Layout `layouts/hmux.json`** — root `column`:

- root look: `theme {light: "hmux-white", dark: "hmux-black"}`, font Menlo 13px,
  ui font Geist, `terminal_padding [4,6]`, `titlebar "none"`,
  `traffic_lights [12,10]`, background gradient `[wash_top, wash_bottom]` at
  160°, `preview "layouts/hmux.svg"`.
- `titlebar` — `block`, 32px, `window_drag: true`, background `glass`,
  `content {mod: "hmux", props: {role: "top"}}`.
- `body` — `row` (divider 1px `edge`) of two children:
  - `sidebar` — `column`, 232px, min 180, max 380, background `glass`, one
    block `{mod: "hmux", props: {role: "sidebar"}}`.
  - `work` — `column`, `resizable: false`, one block:
    `main` — `block`, background `hairline`, `content`:
    `{tab: "active", pane: {gap: 1, radius: 0, background: "background",
    lone: false, border {width: 0}, focus {width: 1, color: "focusring"},
    header {content: {mod: "hmux", props: {role: "pane"}}, height: 20,
    position: "top", reveal: "always"}}}`.

**`mods/hmux`** — one View class with seven roles read from
`props().role`: `top`, `sidebar` (default), `pane`, `inbox`, `menu`, `confirm`,
`fade`. It imports `View, div, svg, image` from `gpui-kit`, `v_flex, h_flex,
InputState, Input` from `gpui-base`, and from `herdr`: `agents, spaces, panes,
focused, machines, terminals, props, run, theme, settings, appHome,
readTextFile, writeTextFile, notify, shared, setShared, openOverlay,
closeOverlay, exec`. `motion.js` holds the tokens and the Reduce Motion read.

State keys: `hmux.inbox`, `hmux.inboxSeen`, `hmux.rename` (shared) and
`expanded` (localStorage, the folded set).

Commands it runs: `layout.toggle`, `tab.new`, `space.select`, `tab.select`,
`space.move`, `tab.move`, `tab.rename`, `space.rename`, `tab.close`,
`space.close` (both `confirmed: true`), `agent.focus`, `terminal.pin`,
`terminal.peek`, `terminal.keep`, `pane.split`, `pane.zoom`, `pane.close`,
`pane.focus`. Overlays: `hmux` (menu 200×300 popup, confirm 360×170 dialog,
inbox 320×380 popup, fade window `frame: "none"`), and the shipped `worktree`
dialog (440×260) for New worktree.

Programs it starts through `exec`: `herdr-app shot` (cover), `mkdir -p` and
`rm -f` (the snapshot folder), `open` (Reveal in Finder), `sh -c printf |
pbcopy` (Copy path), `defaults read com.apple.universalaccess reduceMotion`.
Nothing touches the network.

Icons: `workspace-chrome` (plus, spinner, git-branch, folder, pin,
chevron-right/down), `pane` (split-right/down, zoom, unzoom, close) — all
shipped with Herdr. The mod's own five (`bell`, `sun`, `moon`, `sidebar`,
`server`) are Lucide; see THIRD_PARTY_NOTICES.md.

Themes `hmux-white.json` / `hmux-black.json`: full `ansi` + `colors`. White —
background `#ffffff`, canvas `#eceef2`, chrome `#f3f4f6`, accent `#2f6fde`,
blocked `#c27a12`, done `#1f9d55`, idle `#9aa1aa`, glass `#ffffffb3`, edge
`#0000001a`, wash `#eef1f7`→`#dfe3ea`. Black — background `#15171b`, canvas
`#101114`, chrome `#1a1c21`, accent `#5b8def`, blocked `#e8a33d`, done
`#4fbf7f`, glass `#1b1e26b8`, edge `#ffffff14`, wash `#222736`→`#0e0f12`.

## Watch out

- **macOS first.** 78px title-bar inset and `traffic_lights [12,10]` assume
  macOS buttons; Reveal in Finder (`open`), Copy path (`pbcopy`) and the Reduce
  Motion read (`defaults`) are macOS-only. Elsewhere the buttons fall back to
  no-ops / the fade switches instantly.
- **Icons come from shipped mods.** `mods/workspace-chrome/*.svg` and
  `mods/pane/*.svg` must exist; a Herdr version that renames them leaves blank
  icons. Bundle copies if that matters.
- **Both themes must be installed.** `glass`, `hairline`, `edge`, `focusring`,
  `wash_top`, `wash_bottom` are custom color names — without
  `themes/hmux-*.json` they fall back to the built-in themes and the layout
  loses its look.
- **Row height is a constant.** The session highlight is placed at
  `index × ROW` (22px) and springs `top`; changing row height without changing
  `ROW` misaligns it.
- **Move indices.** `space.move` wants a 1-based index inside that machine's
  block; `tab.move` a 1-based index in the space. Settled tabs are not shown
  and are not part of the drag list.
- **The fade overlay** is a separate window over everything: a layout switch
  closes it (theme already flipped — safe), and `settings().zoom` must exist; at
  zoom 1 with a missing `window.json` it assumes 3:2. The snapshot lives in
  `.cache/hmux/` and is deleted after the fade; a crash can leave one behind.
- **Overlay heights are fixed** (inbox 380, header 34, list 346, menu 300):
  `flex_1` did not stretch inside these popups, which is why the notification
  list once looked empty.
- **Sub-agents** show three levels; deeper ones are silently skipped. Only live
  terminals with `parent` set are shown.
- **Rename writes only changed names.** Writing the same value would pin an
  auto name; the mod deliberately skips it.
- **The sidebar never switches spaces on a folder click** (by request). The
  only way a folder opens is its chevron/row click; agents and sessions do the
  navigation.
- **`hmux.inbox` is capped at 60.** `Clear all` empties it; nothing else trims.
- Controls that do nothing yet: none known.

## Done when

1. `herdr-app check ~/.config/herdr-app/mods/hmux` prints `check passed`.
2. `herdr-app do layout.switch --name hmux` and `herdr-app status` reports
   `"layout": "hmux"` with `"errors": []`.
3. The window shows the 32px title bar with the two buttons left of the label,
   the 232px sidebar (Agents / Tabs / Session) and the active tab in panes with
   20px headers.
4. Clicking a folder folds it and does NOT change the space; clicking a session
   inside goes there; double-clicking a session gives an input already
   containing its name; Escape restores it untouched.
5. Dragging a session 30px: the row lifts with a shadow and accent border, the
   other rows spring aside, release reorders and nothing slides back.
6. Pressing sun/moon: the window crossfades (intermediate colors visible) in
   about 0.7s; with Reduce Motion on it switches at once;
   `settings.json`'s `appearance` flips.
7. The bell badge matches unread entries; an agent turning blocked or done adds
   one; `Clear all` empties the list; clicking a live entry focuses that agent.
8. Splitting a pane adds a header and hover shows the four tools; they split,
   zoom and close.
9. `herdr-app shot` shows the traffic lights inside the 78px inset, no gaps
   between title bar, sidebar and panes.
