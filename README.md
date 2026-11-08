# Hmux

A terminal-first Herdr layout with a fixed, glassy sidebar: agents on top, then
sessions you file into your own groups, then a session footer with your working
folder, branch and machines. Sessions are roomy two-line rows — name on top,
folder below — and the active one fills with the accent color. The whole window
follows a light and a dark theme, switched from the title bar with a crossfade
instead of a hard cut.

![Hmux](preview.png)

Built for macOS (the title bar leaves room for the traffic lights and the
session menu uses Finder and `pbcopy`).

## What you get

- **Top strip (32px, over the sidebar):** the traffic lights, then the sidebar
  toggle and the notification bell with its unread badge — cmux's top-left.
- **Title bar (32px):** it starts at the sidebar's divider (the layout's one
  vertical line) with the macOS folder icon and the selected session's working
  path; on the right, the sun/moon theme switch and new session. Drag the
  window by this bar (or by the strip above the sidebar); double-click
  maximizes.
- **Agents:** one compact line per agent with its program icon and status; the
  header folds the whole section. Pinned agents stay on top, then by urgency:
  needs you, done, working, idle. Sub-agents nest under the agent that started
  them (three levels). Right-click: Go to agent, Pin/Unpin, Peek, **Delete
  agent** (asks first).
- **Sessions:** one flat list, not tied to Herdr's folder spaces.
  - `+` starts a new session right away — no folder picker, always a fresh one.
  - The folder-plus button next to it creates a **group** (shaded, with a folder
    icon).
  - Sessions that share a working folder on the same machine form an **auto
    group** on their own (macOS folder icon, same shade as a manual group). It
    appears and dissolves as sessions start, end or `cd` — no setup. A session
    you put in a manual group stays there. The Sessions list covers this
    computer; a machine's sessions live under it in the footer.
  - Sessions in no group sit below an `UNGROUPED` rule, so they never read as a
    group's children.
  - SSH sessions are in the same list too; click one to switch straight to it.
  - Each session is a two-line row: its name, then the folder it works in, with
    the working time on the right and its status mark at the far right (a 14px
    spinner while working). Hover a row and the mark becomes an × that closes
    it (with a confirmation). The active session is filled with the accent
    color and white text.
  - **Drag a session onto a group header** to file it there; drag it onto the
    Sessions header to take it back out. Dragging inside a group reorders it.
  - Click a group to fold it; double-click to rename; right-click for Rename
    and Delete (deleting a group keeps its sessions, ungrouped).
- **Pane tabs:** each pane carries its own cmux-style tab bar — the macOS
  Terminal icon, title, ×, then split and zoom tools; the focused tab is white
  with a thin accent line on top. Drag panes with the native grip on a pane's
  top edge; right-click a tab for Move left/right/up/down and Close.
- **Session footer:** status counts, the focused pane's folder and branch, and
  `This Mac + N` — each SSH machine with its connection state. Open a machine
  to see **its sessions right under it** (the login tab too); click one to
  switch straight to it. An offline machine offers `Connect…` (its login
  prompt). The `+` on a machine row opens it (its first space, or a new one);
  the header's `+` opens Settings → Machines. Right-click a machine for
  Connect (offline), New space and Forget machine.
- **Panes:** a 20px header with the program, folder, branch and status; on
  hover, split right/down, zoom and close.
- **Right-click a session:** go to it, rename, reset the name, split right or
  down, close. Closing asks first.
- **Drag to reorder:** grabbed sessions lift; the rows spring aside live and
  the drop lands where the preview showed it.
- **Theme crossfade:** the sun/moon button takes a picture of the window, flips
  the theme underneath and fades the picture out in 0.7s. Reduce Motion is
  respected.
- **Notifications:** agents that turn "needs you" or "done" land in the bell's
  popup (a sheet with a small tail under the bell). Each row shows the agent's
  logo; click it to jump to that agent, or hover and use the × that appears to
  drop just that entry.

## Install

Hmux is a folder laid out like `~/.config/herdr-app`:

```sh
git clone https://github.com/cuqe/Hmux.git
cd Hmux
cp layouts/hmux.json layouts/hmux.svg ~/.config/herdr-app/layouts/
cp -R mods/hmux ~/.config/herdr-app/mods/
cp themes/hmux-white.json themes/hmux-black.json ~/.config/herdr-app/themes/
herdr-app do layout.switch --name hmux
```

Herdr reloads mods live. Switch back with `ctrl-shift-l`; delete the files to
remove it. The layout needs the mods Herdr ships (`workspace-chrome`, `pane`,
`worktree`) for its icons and the New worktree dialog.

## Customize

- `themes/hmux-white.json` and `themes/hmux-black.json` hold every color.
- Sizes live in `layouts/hmux.json` (sidebar 232px, title bar 32px, pane header
  20px) and in `mods/hmux/main.js` (`ROW = 22` for headers, `SESSION_H = 58` for
  session rows).
- Motion durations and springs are tokens in `mods/hmux/motion.js`.
- Groups live in the mod's shared state: `hmux.groups` (the groups),
  `hmux.groupOf` (session → group) and `hmux.order` (the order of each list).

## License

MIT — see `LICENSE`. The Lucide icons here (`bell`, `sun`, `moon`, `sidebar`,
`server`, `folder-plus`, `link`; three derived from Feather, MIT) are ISC —
see `THIRD_PARTY_NOTICES.md`. `spinner-macos.svg` is original.
