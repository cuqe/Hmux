// hmux-style chrome for the hmux layout. One mod, several roles (props.role):
//   "top"     the full-width title bar: sidebar toggle, notifications, theme, new tab
//   "sidebar" agents (with sub-agents), this computer's folders and their sessions, session status with SSH machines
//   "pane"    a slim per-pane header with split / zoom / close on hover
//   "inbox"   the notifications popup (opened by "top")
//   "menu"    right-click menus for a session (tab), a folder (space) or an agent
//   "confirm" asks before closing a session or folder
//   "fade"    the theme crossfade: a picture of the window that fades out over the new theme

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  agents, spaces, panes, focused, machines, terminals, props, run, theme, themes, home, layout, setAgentOrder,
  settings, appHome, readTextFile, writeTextFile, notify, shared, setShared, openOverlay, closeOverlay, exec, nextCommand,
} from "herdr";
import { detectReducedMotion, isReduced, transition, spring, loopMs, durationMs, fadeDelay, fadeTotalMs } from "./motion.js";

const ROW = 22; // header/folder row height: their lists spring by this step
const SESSION_H = 58; // a session row: name on top, folder below (the highlight springs by this)
const THEME = { light: "hmux-white", dark: "hmux-black" };
const INBOX_KEY = "hmux.inbox";
const INBOX_SEEN = "hmux.inboxSeen";
const RENAME_KEY = "hmux.rename"; // menu → sidebar: start editing a name
// Groups are this mod's own collections (display only): sessions are Herdr tabs,
// grouped by these ids, never by their Herdr space. "u" holds the loose sessions.
const GROUPS_KEY = "hmux.groups"; // [{ id, name }]
const ASSIGN_KEY = "hmux.groupOf"; // { [tabId]: groupId }
const ORDER_KEY = "hmux.order"; // { u: [tabId…], <groupId>: [tabId…] }
const UNGROUPED = "u";
const SIDEBAR_W = "hmux.sidebarW"; // the sidebar's live width (measured, layout px)
const INBOX_MAX = 60;
const INBOX_W = 320;
const INBOX_H = 380;
const INBOX_HEAD = 44;
const DRAG_START = 4; // px the pointer travels before a press becomes a drag
const ICON = {
  plus: "mods/workspace-chrome/plus.svg",
  spinner: "mods/hmux/spinner-macos.svg",
  branch: "mods/workspace-chrome/git-branch.svg",
  folder: "mods/workspace-chrome/folder.svg",
  pin: "mods/workspace-chrome/pin.svg",
  splitRight: "mods/pane/split-right.svg",
  splitDown: "mods/pane/split-down.svg",
  zoom: "mods/pane/zoom.svg",
  unzoom: "mods/pane/unzoom.svg",
  close: "mods/pane/close.svg",
  chevronRight: "mods/workspace-chrome/chevron-right.svg",
  chevronDown: "mods/workspace-chrome/chevron-down.svg",
  sun: "mods/hmux/sun.svg",
  moon: "mods/hmux/moon.svg",
  bell: "mods/hmux/bell.svg",
  sidebar: "mods/hmux/sidebar.svg",
  server: "mods/hmux/server.svg",
  folderPlus: "mods/hmux/folder-plus.svg",
  link: "mods/hmux/link.svg",
  folderMac: "mods/hmux/folder-macos.png",
  terminal: "mods/hmux/terminal.svg",
  terminalMac: "mods/hmux/terminal-macos.png",
  tail: "mods/hmux/popover-tail.svg",
  tailOutline: "mods/hmux/popover-tail-outline.svg",
};
const STATUS_LABEL = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };
const INBOX_TEXT = { blocked: "Needs your input.", done: "Finished its work." };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function shortPath(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Short elapsed time: now · 12m · 3h · 2d
function elapsed(since) {
  if (!since) return "";
  const m = Math.floor((Date.now() - since) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

async function writeAppearance(value) {
  const path = `${appHome()}/settings.json`;
  const text = await readTextFile(path);
  const data = text ? JSON.parse(text) : {};
  data.appearance = value;
  await writeTextFile(path, JSON.stringify(data, null, 2) + "\n", text);
}

// ── theme crossfade ─────────────────────────────────────────────────────────
const SNAP_DIR = ".cache/hmux"; // under appHome: hidden, so saving a picture reloads nothing

function themeFailed() {
  notify({ title: "Couldn't switch the theme.", body: "Check settings.json, then try again.", level: "warning" });
}

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Status mark: spinner while working (a static dot under reduced motion). On an
// accent-filled row the marks keep their meaning: white spinner, yellow blocked,
// light green done, a half-white idle dot.
function statusMark(t, status, size = 10, onAccent = false, dot = 6) {
  if (status === "working") {
    return isReduced()
      ? div().size(dot).flex_none().rounded(dot / 2).bg(onAccent ? t.accent_foreground : t.working)
      : svg(ICON.spinner).size(size).flex_none().text_color(onAccent ? t.accent_foreground : t.working).spin(loopMs("spinner"));
  }
  if (status === "blocked") return div().size(dot).flex_none().rounded(dot / 2).bg(onAccent ? "#ffd60a" : t.blocked);
  if (status === "done") return div().size(dot).flex_none().rounded(dot / 2).bg(onAccent ? "#5ee6a0" : t.done);
  if (status === "idle") {
    const d = Math.max(5, dot - 1);
    const mark = div().size(d).flex_none().rounded(d / 2).bg(onAccent ? "#ffffff" : t.idle);
    return onAccent ? mark.opacity(0.55) : mark;
  }
  return null;
}

// onClick gets the press position (window coordinates) for popups, and the click's cx.
function iconButton(t, id, icon, onClick, size = 12, { active = false } = {}) {
  let pressed = null;
  return div()
    .id(id)
    .flex_none()
    .p(4)
    .rounded(5)
    .text_color(active ? t.foreground : t.dim)
    .when(active, (el) => el.bg(t.hover))
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (e, cx) => {
      pressed = e.position;
      cx.stop_propagation();
    })
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick(pressed, cx);
    })
    .child(svg(icon).size(size));
}

function sectionTitle(t, label, count, trailing) {
  return h_flex()
    .h(22)
    .px(10)
    .pt(6)
    .gap(6)
    .items_center()
    .flex_none()
    .text_size(10.5)
    .font_semibold()
    .text_color(t.dim)
    .child(div().child(label))
    .when(count != null, (el) => el.child(div().text_color(t.dim).opacity(0.7).child(String(count))))
    .child(div().flex_1())
    .when(Boolean(trailing), (el) => el.child(trailing));
}

const inbox = () => (Array.isArray(shared(INBOX_KEY)) ? shared(INBOX_KEY) : []);
const unread = () => {
  const seen = Number(shared(INBOX_SEEN) ?? 0);
  return inbox().filter((n) => n.at > seen).length;
};

// ── groups and sessions ─────────────────────────────────────────────────────
const groups = () => (Array.isArray(shared(GROUPS_KEY)) ? shared(GROUPS_KEY) : []);
const groupOf = () => {
  const m = shared(ASSIGN_KEY);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
};
const orderOf = () => {
  const m = shared(ORDER_KEY);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
};
const setGroups = (list) => setShared(GROUPS_KEY, list);
const setOrder = (section, ids) => setShared(ORDER_KEY, { ...orderOf(), [section]: ids });

// This computer's sessions (tabs), before grouping. A machine's sessions and
// its login tab live under the machine in the session footer instead.
function allSessions() {
  const out = [];
  for (const s of spaces()) {
    if (s.machine) continue;
    for (const tb of s.tabs) {
      if (tb.settled && !tb.active) continue;
      if (LOGIN_TAB.test(tb.name ?? "")) continue;
      out.push({ space: s, tab: tb });
    }
  }
  return out;
}

// Every tab on this computer, machine logins included.
function localTabs() {
  const out = [];
  for (const s of spaces()) {
    if (s.machine) continue;
    for (const tb of s.tabs) out.push({ space: s, tab: tb });
  }
  return out;
}

// The folder a session works in: its first pane's cwd, else its space's folder.
function sessionFolder(e) {
  const p = panes().find((x) => x.tab === e.tab.id && x.cwd);
  return p?.cwd ?? e.space.folder ?? "";
}

// A session's auto-group key: its machine and its working folder. A tab named
// "login <machine>" belongs to that machine instead (it runs on this computer).
const LOGIN_TAB = /^login (.+)$/;
const autoKey = (e) => {
  const cwd = sessionFolder(e);
  return cwd ? cwd : "";
};

// Sessions on the same folder form an automatic group (two or more). A manual
// group always wins.
function autoGroups() {
  const gof = groupOf();
  const buckets = new Map();
  for (const e of allSessions()) {
    if (gof[e.tab.id]) continue;
    const key = autoKey(e);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, { key, cwd: sessionFolder(e), entries: [] });
    buckets.get(key).entries.push(e);
  }
  return [...buckets.values()].filter((b) => b.entries.length > 1).sort((a, b) => a.cwd.localeCompare(b.cwd));
}

// The sessions of one manual section (a group id or UNGROUPED), in the user's order.
function sessionsIn(section) {
  const gof = groupOf();
  const auto = new Set(autoGroups().map((b) => b.key));
  const list = allSessions();
  const own = section === UNGROUPED
    ? list.filter((e) => !gof[e.tab.id] && !auto.has(autoKey(e)))
    : list.filter((e) => gof[e.tab.id] === section);
  const seen = new Map(list.map((e, i) => [e.tab.id, i]));
  const rank = new Map((orderOf()[section] ?? []).map((id, i) => [id, i]));
  return own
    .sort((a, b) => (rank.get(a.tab.id) ?? 1e9) - (rank.get(b.tab.id) ?? 1e9) || seen.get(a.tab.id) - seen.get(b.tab.id));
}

// The sessions of one auto group (key = machine|folder), in the user's order.
function autoSessions(key) {
  const gof = groupOf();
  const list = allSessions();
  const seen = new Map(list.map((e, i) => [e.tab.id, i]));
  const rank = new Map((orderOf()[`a:${key}`] ?? []).map((id, i) => [id, i]));
  return list
    .filter((e) => !gof[e.tab.id] && autoKey(e) === key)
    .sort((a, b) => (rank.get(a.tab.id) ?? 1e9) - (rank.get(b.tab.id) ?? 1e9) || seen.get(a.tab.id) - seen.get(b.tab.id));
}

// Section ids starting with "a:" are automatic folder groups.
function sectionEntries(section) {
  return section.startsWith("a:") ? autoSessions(section.slice(2)) : sessionsIn(section);
}

// Move a session into a group (or out, with UNGROUPED), keeping the order lists tidy.
function setGroupOf(tabId, section) {
  const gof = { ...groupOf() };
  if (section === UNGROUPED) delete gof[tabId];
  else gof[tabId] = section;
  const order = {};
  for (const [key, ids] of Object.entries(orderOf())) order[key] = ids.filter((id) => id !== tabId);
  order[section] = [...(order[section] ?? []), tabId];
  setShared(ASSIGN_KEY, gof);
  setShared(ORDER_KEY, order);
}

// Sub-agents: live terminals another one started (`hc run`), keyed by their parent's address.
function subAgentsOf(address) {
  return terminals().filter((x) => x.parent === address && (x.state ?? "live") === "live");
}
const subStatus = (s) => (s === "error" ? "blocked" : s === "done" ? "idle" : s);

function openMenu(spec, at) {
  openOverlay({ mod: "hmux", props: { role: "menu", ...spec }, kind: "popup", width: 200, height: 300, at: at ?? "pointer" });
}

function askToClose(title, body, yes, command) {
  openOverlay({ mod: "hmux", props: { role: "confirm", title, body, yes, command }, kind: "dialog", width: 360, height: 170 });
}

export default class Hmux extends View {
  init(_props, cx) {
    this.hovered = false;
    this.rowHover = null; // the session row under the pointer (shows its ×)
    this.machineHover = null; // the machine session row under the pointer
    this.inboxHover = null; // the notification row under the pointer (shows its ×)
    this.drag = null; // { kind: "space" | "tab", id, scope, label, start: {x,y}, active }
    this.pending = null; // after a drop: keep the preview until the new order arrives
    this.heights = {}; // measured folder group heights, for the live preview
    this.dropGroup = null; // group under the pointer while a session drag is active
    this.gen = 0; // bumped after a drop so rows remount in their new places without sliding back
    this.edit = null; // { kind, id, input }
    this.renameSeen = Date.now();
    try {
      this.expanded = new Set(JSON.parse(localStorage.getItem("expanded") ?? "null") ?? []);
    } catch {
      this.expanded = new Set();
    }
    cx.spawn(async (cx) => {
      await detectReducedMotion();
      cx.notify();
    });
    const role = props()?.role;
    if (role === "top") exec("rm", ["-f", `${appHome()}/mods/hmux/.morph-backup.json`]).catch(() => {}); // the old morph's leftover
    // cmd-1…cmd-9: jump to the Nth machine session (machines in order).
    if ((role ?? "sidebar") === "sidebar") {
      cx.spawn(async (cx) => {
        for (;;) {
          const command = String((await nextCommand()) ?? "");
          const m = /^selectMachine:(\d+)$/.exec(command);
          if (!m) continue;
          const n = Number(m[1]);
          const cur = spaces().find((sp) => sp.active);
          if (!cur) continue;
          if (cur.machine) {
            // An SSH session has the keyboard: pick from that machine's sessions.
            const list = [];
            for (const sp of spaces()) if (sp.machine === cur.machine) for (const tb of sp.tabs) list.push({ space: sp, tab: tb });
            const pick = list[n - 1];
            if (pick) {
              if (!pick.space.active) run("space.select", { id: pick.space.id });
              run("tab.select", { id: pick.tab.id });
            }
          } else {
            // A normal session: the Nth session of the section it is shown in
            // (its group, its folder group, or the loose list), in list order.
            const tb = cur.tabs.find((x) => x.active);
            if (tb) {
              const gof = groupOf();
              let section = UNGROUPED;
              if (gof[tb.id]) section = gof[tb.id];
              else {
                const e = allSessions().find((x) => x.tab.id === tb.id);
                const key = e ? autoKey(e) : "";
                section = key && autoGroups().some((b) => b.key === key) ? `a:${key}` : UNGROUPED;
              }
              const pick = sectionEntries(section)[n - 1];
              if (pick) {
                if (!pick.space.active) run("space.select", { id: pick.space.id });
                run("tab.select", { id: pick.tab.id });
              }
            }
          }
          cx.notify();
        }
      });
    }
    if (role === "fade") this.startFade(cx);
    if (role === "confirm") {
      this.handle = cx.focus_handle();
      this.handle.focus();
    }
    // Elapsed times in the session list move on their own.
    if ((role ?? "sidebar") === "sidebar") cx.timer.every(30000, (cx) => cx.notify());
  }

  render(cx) {
    const role = props()?.role ?? "sidebar";
    if (role === "sidetop") return this.renderSideTop();
    if (role === "spacer") return div();
    if (role === "top") return this.renderTop();
    if (role === "fade") return this.renderFade();
    if (role === "pane") return this.renderPane();
    if (role === "inbox") return this.renderInbox();
    if (role === "menu") return this.renderMenu();
    if (role === "confirm") return this.renderConfirm();
    return this.renderSidebar(cx);
  }

  // ── title bar ──────────────────────────────────────────────────────────────
  // The bell with its unread badge (used in the sidebar top strip and, with the
  // sidebar hidden, in the title bar).
  inboxBell(t) {
    const count = unread();
    return div()
      .relative()
      .flex_none()
      .child(iconButton(t, "hmux-top-bell", ICON.bell, (at) => this.openInbox(at), 13))
      .when(count > 0, (el) =>
        el.child(
          div().absolute().top(0).right(-2).min_w(13).h(13).px(3).rounded(7).bg(t.accent)
            .flex().items_center().justify_center()
            .text_size(8.5).font_semibold().text_color(t.accent_foreground)
            .child(count > 9 ? "9+" : String(count)),
        ),
      );
  }

  // The strip above the sidebar (over the traffic lights), like cmux: toggle, bell.
  renderSideTop() {
    const t = theme();
    const hidden = Boolean(findNode(layout(), "sidebar")?.hidden);
    return h_flex()
      .id("hmux-sidetop")
      .size_full()
      .pl(78)
      .pr(8)
      .gap(2)
      .items_center()
      .child(iconButton(t, "hmux-top-sidebar", ICON.sidebar, () => run("layout.toggle", { id: "sidebar" }), 13, { active: !hidden }))
      .child(this.inboxBell(t));
  }

  renderTop() {
    const t = theme();
    this.trackInbox();
    const sidebarHidden = Boolean(findNode(layout(), "sidebar")?.hidden);
    const count = unread();
    const space = spaces().find((s) => s.active);
    const tab = space?.tabs.find((tb) => tb.active);
    const f = focused();
    const pane = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
    const cwd = shortPath(pane?.cwd ?? f?.cwd ?? space?.folder ?? "");
    const where = space ? `${space.name}${tab ? ` · ${this.tabLabel(tab)}` : ""}` : "";
    const bell = this.inboxBell(t);
    const sideNode = findNode(layout(), "sidebar");
    const measured = Number(shared(SIDEBAR_W) ?? 0);
    const sideW = measured > 0 ? measured : (sideNode?.size?.px ?? 232);
    return h_flex()
      .id("hmux-top")
      .on_size_change((size) => {
        this.topWidth = size.width;
      })
      .size_full()
      // The title bar lives in the work column, so the body's divider is the
      // only vertical line. With the sidebar hidden it starts at the window
      // edge and leaves room for the traffic lights.
      .pl(sidebarHidden ? 88 : 10)
      .pr(8)
      .gap(2)
      .items_center()
      .text_size(11.5)
      .when(sidebarHidden, (el) =>
        el.child(iconButton(t, "hmux-top-sidebar", ICON.sidebar, () => run("layout.toggle", { id: "sidebar" }), 13, { active: false }))
          .child(bell)
          .child(div().flex_none().w(6)),
      )
      // The session's folder, like cmux: the macOS folder icon and its path.
      .child(image(ICON.folderMac).w(14).h(14).flex_none())
      .child(div().flex_none().max_w(300).truncate().px(6).text_color(t.muted).child(cwd))
      .child(div().flex_1())
      .child(iconButton(t, "hmux-top-theme", settings()?.dark ? ICON.sun : ICON.moon, (_at, cx) => this.flipTheme(cx), 13))
      .child(iconButton(t, "hmux-top-new", ICON.plus, () => run("tab.new", {}), 13));
  }

  // Records agents turning blocked or done, for the notifications popup. Only the title bar does this.
  trackInbox() {
    const list = agents();
    const prev = this.lastStatus;
    this.lastStatus = new Map(list.map((a) => [a.address, a.status]));
    if (!prev) return; // first look: today's states aren't news
    const fresh = list
      .filter((a) => (a.status === "blocked" || a.status === "done") && prev.get(a.address) !== a.status)
      .map((a) => ({
        id: `${a.address}-${Date.now()}`,
        address: a.address,
        status: a.status,
        title: clean(a.title) || a.program?.name || "agent",
        where: `${a.space_name} · ${a.tab_name}`,
        icon: a.program?.icon ?? null,
        tint: Boolean(a.program?.tint),
        at: Date.now(),
      }));
    if (fresh.length) setShared(INBOX_KEY, [...fresh, ...inbox()].slice(0, INBOX_MAX));
  }

  openInbox(at) {
    setShared(INBOX_SEEN, Date.now());
    openOverlay({
      mod: "hmux",
      props: { role: "inbox" },
      kind: "popup",
      frame: "none",
      width: INBOX_W,
      height: INBOX_H + 8,
      at: at ? { x: at.x - 26, y: at.y + 14 } : "pointer",
    });
  }

  // Crossfade: a picture of the window as it is covers it, the theme switches underneath,
  // then the picture fades out natively (every frame, not file by file). Under reduced
  // motion the theme switches at once.
  flipTheme(cx) {
    if (this.fading) return;
    const to = settings()?.dark ? "light" : "dark";
    if (isReduced() || !this.topWidth) {
      writeAppearance(to).catch(themeFailed);
      return;
    }
    this.fading = true;
    cx.spawn(async (cx) => {
      try {
        const rel = `${SNAP_DIR}/snap-${Date.now()}.png`;
        await exec("mkdir", ["-p", `${appHome()}/${SNAP_DIR}`]);
        const shot = await exec("herdr-app", ["shot", `${appHome()}/${rel}`]);
        if (shot.code !== 0) throw new Error(shot.stderr);
        const bounds = JSON.parse((await readTextFile(`${appHome()}/window.json`)) ?? "{}").bounds;
        // The title bar reports the work column; add the sidebar back for a
        // cover the size of the whole window. The cover's pixels get zoomed,
        // so divide the zoom out.
        const sideHidden = Boolean(findNode(layout(), "sidebar")?.hidden);
        const full = this.topWidth + (sideHidden ? 0 : Number(shared(SIDEBAR_W) ?? 232));
        const width = full / (settings()?.zoom ?? 1);
        const height = bounds ? (width * bounds[3]) / bounds[2] : width * 0.66;
        openOverlay({
          mod: "hmux",
          props: { role: "fade", image: rel, to, width, height },
          kind: "window",
          key: "hmux-fade",
          frame: "none",
          width,
          height,
          at: { x: 0, y: 0 },
        });
      } catch {
        writeAppearance(to).catch(themeFailed);
      }
      cx.timer.after(fadeTotalMs(), () => {
        this.fading = false;
      });
    });
  }

  // ── theme crossfade cover ──────────────────────────────────────────────────
  startFade(cx) {
    const p = props();
    this.faded = false;
    // Give the picture a moment to load, then switch the theme under it.
    cx.timer.after(fadeDelay("imageLoad"), (cx) => {
      writeAppearance(p.to).catch(themeFailed);
      // Once the new theme is drawn underneath, let the picture go.
      cx.timer.after(fadeDelay("themeApply"), (cx) => {
        this.faded = true;
        cx.notify();
        cx.timer.after(durationMs("themeFade") + 60, () => {
          closeOverlay(props().overlay);
          exec("rm", ["-f", `${appHome()}/${p.image}`]).catch(() => {});
        });
      });
    });
  }

  renderFade() {
    const p = props();
    return div()
      .id("hmux-fade")
      .w(p.width)
      .h(p.height)
      .opacity(this.faded ? 0 : 1)
      .transition("opacity", transition("themeFade", "inOut"))
      .child(image(p.image).w(p.width).h(p.height));
  }

  // ── notifications popup ────────────────────────────────────────────────────
  renderInbox() {
    const t = theme();
    const items = inbox();
    const live = new Set(agents().map((a) => a.address));
    const badge = items.length
      ? div()
        .flex_none()
        .min_w(18)
        .h(18)
        .px(5)
        .rounded(9)
        .flex()
        .items_center()
        .justify_center()
        .bg(t.accent)
        .text_size(10)
        .font_semibold()
        .text_color(t.accent_foreground)
        .child(String(items.length))
      : div();
    const clear = div()
      .id("hmux-inbox-clear")
      .h(26)
      .px(11)
      .rounded(7)
      .flex()
      .items_center()
      .bg(t.foreground + "0d")
      .text_size(11.5)
      .text_color(t.muted)
      .hover((s) => s.bg(t.foreground + "16").text_color(t.foreground))
      .on_click(() => setShared(INBOX_KEY, []))
      .child("Clear all");
    return div()
      .id("hmux-inbox")
      .relative()
      .w_full()
      .h(INBOX_H + 8)
      .child(
        v_flex()
          .id("hmux-inbox-panel")
          .mt(8)
          .w_full()
          .h(INBOX_H)
          .rounded(12)
          .bg(t.popover)
          .border_1()
          .border_color(t.border)
          .shadow_lg()
          .overflow_hidden()
          .text_size(12)
          .text_color(t.foreground)
      .child(
        h_flex().h(INBOX_HEAD).px(14).gap(8).items_center().flex_none().border_b(1).border_color(t.border)
          .child(div().font_semibold().text_size(13).child("Notifications"))
          .child(badge)
          .child(div().flex_1())
          .when(items.length > 0, (el) => el.child(clear)),
      )
      .child(
        items.length
          ? v_flex().id("hmux-inbox-list").w_full().h(INBOX_H - INBOX_HEAD).flex_none().overflow_y_scrollbar().children(
            items.map((n) => {
              const alive = live.has(n.address);
              const hovered = this.inboxHover === n.id;
              const pic = n.icon
                ? n.tint
                  ? svg(n.icon).size(16).flex_none().text_color(t.muted)
                  : image(n.icon).w(16).h(16).flex_none()
                : div().size(16).flex_none();
              return h_flex()
                .id(`hmux-inbox-${n.id}`)
                .relative()
                .pl(12)
                .pr(10)
                .py(7)
                .gap(8)
                .items_center()
                .when(hovered, (el) => el.bg(t.hover))
                .on_hover((h, cx) => {
                  this.inboxHover = h ? n.id : this.inboxHover === n.id ? null : this.inboxHover;
                  cx.notify();
                })
                .on_click(() => {
                  if (!alive) return;
                  run("agent.focus", { terminal: n.address });
                  closeOverlay(props().overlay);
                })
                .child(pic)
                .child(
                  v_flex().flex_1().min_w(0).gap(2)
                    .child(
                      h_flex().gap(8).items_center().min_w(0)
                        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().child(n.title))
                        .child(div().flex_none().text_size(11).text_color(t.dim).child(clock(n.at))),
                    )
                    .child(div().truncate().text_size(11).text_color(t.dim).child(alive ? n.where : `${n.where} · ended`))
                    .child(div().text_size(11).text_color(t.dim).child(INBOX_TEXT[n.status] ?? "")),
                )
                // The × column is always reserved, so the time never moves; the
                // button itself only shows under the pointer.
                .child(
                  div()
                    .flex_none()
                    .size(18)
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(hovered, (el) =>
                      el.child(
                        div()
                          .id(`hmux-inbox-x-${n.id}`)
                          .size(18)
                          .rounded(9)
                          .flex()
                          .items_center()
                          .justify_center()
                          .bg(t.foreground + "14")
                          .hover((s) => s.bg(t.foreground + "26"))
                          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                          .on_click((_e, cx) => {
                            cx.stop_propagation();
                            setShared(INBOX_KEY, inbox().filter((x) => x.id !== n.id));
                          })
                          .child(svg(ICON.close).size(9).flex_none().text_color(t.muted)),
                      ),
                    ),
                );
            }),
          )
          : v_flex().w_full().h(INBOX_H - INBOX_HEAD).flex_none().p(16).gap(4).items_center().justify_center().text_color(t.dim)
            .child(div().child("No new notifications."))
            .child(div().text_size(11).child("When an agent finishes or needs you, it shows up here.")),
      )
      )
      .child(div().absolute().top(0).left(14).child(svg(ICON.tail).w(24).h(9).flex_none().text_color(t.popover)))
      .child(div().absolute().top(0).left(14).child(svg(ICON.tailOutline).w(24).h(9).flex_none().text_color(t.border)));
  }

  // ── right-click menus ──────────────────────────────────────────────────────
  menuItems() {
    const p = props();
    const all = spaces();
    if (p.kind === "group") {
      const g = groups().find((x) => x.id === p.id);
      if (!g) return [];
      return [
        ["Rename group", () => setShared(RENAME_KEY, { kind: "group", id: g.id, at: Date.now() })],
        null,
        ["Delete group", () => this.deleteGroup(g.id), true],
      ];
    }
    if (p.kind === "panetab") {
      const move = (dir) => {
        run("pane.focus", { pane: p.id });
        run("pane.swap", { direction: dir });
      };
      return [
        ["Focus", () => run("pane.focus", { pane: p.id })],
        null,
        ["Move left", () => move("left")],
        ["Move right", () => move("right")],
        ["Move up", () => move("up")],
        ["Move down", () => move("down")],
        null,
        ["Close pane", () => run("pane.close", { pane: p.id }), true],
      ];
    }
    if (p.kind === "machine") {
      const m = machines().find((x) => x.name === p.name);
      if (!m) return [];
      const items = [];
      if (m.layout === "unavailable") {
        items.push(["Connect", () => run("tab.new", { argv: ["hc", "machine", "login", m.name], name: `login ${m.name}` })]);
        items.push(null);
      }
      items.push(["New space", () => run("space.new", { machine: m.name })]);
      items.push(null);
      items.push(["Forget machine", () => askToClose(`Forget ${m.name}?`, "Herdr forgets this machine. Its terminals keep running there.", "Forget machine", { exec: ["hc", ["machine", "rm", m.name]] }), true]);
      return items;
    }
    if (p.kind === "tab") {
      const s = all.find((x) => x.tabs.some((tb) => tb.id === p.id));
      const tb = s?.tabs.find((x) => x.id === p.id);
      if (!tb) return [];
      const go = () => {
        if (!s.active) run("space.select", { id: s.id });
        run("tab.select", { id: tb.id });
      };
      return [
        ["Go to session", go],
        ["Rename", () => setShared(RENAME_KEY, { kind: "tab", id: tb.id, at: Date.now() })],
        ...(tb.named ? [["Reset name", () => run("tab.rename", { id: tb.id, name: "" })]] : []),
        null,
        ["Split right", () => { go(); run("pane.split", { direction: "right" }); }],
        ["Split down", () => { go(); run("pane.split", { direction: "down" }); }],
        null,
        ["Close session", () => askToClose("Close this session?", "Its terminals and agents will end. This can't be undone.", "Close session", { name: "tab.close", args: { id: tb.id, confirmed: true } }), true],
      ];
    }
    if (p.kind === "space") {
      const s = all.find((x) => x.id === p.id);
      if (!s) return [];
      const folder = s.folder || panes().find((x) => x.tab === s.tabs[0]?.id && x.cwd)?.cwd || "";
      const local = !s.machine;
      return [
        ["New session", () => run("tab.new", { space: s.id })],
        ["Rename", () => setShared(RENAME_KEY, { kind: "space", id: s.id, at: Date.now() })],
        ...(s.named ? [["Reset name", () => run("space.rename", { id: s.id, name: "" })]] : []),
        null,
        ...(local && folder ? [["Reveal in Finder", () => exec("open", [folder]).catch(() => {})]] : []),
        ...(folder ? [["Copy path", () => exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", folder]).then(() => notify({ title: "Copied the path.", body: shortPath(folder), level: "info", timeout: 2500 })).catch(() => {})]] : []),
        ...(s.branch ? [["New worktree", () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: s.id, action: "new" } })]] : []),
        null,
        ["Close folder", () => askToClose("Close this folder?", "Its sessions and terminals will end. Files on disk stay as they are.", "Close folder", { name: "space.close", args: { id: s.id, confirmed: true } }), true],
      ];
    }
    if (p.kind === "agent") {
      const a = agents().find((x) => x.address === p.id);
      const kill = (id) =>
        askToClose("Delete this agent?", "Its terminal and process will end. This can't be undone.", "Delete agent", { name: "terminal.kill", args: { terminal: id } });
      if (p.sub) {
        return [
          ["Go to agent", () => run("agent.focus", { terminal: p.id })],
          ["Peek", () => run("terminal.peek", { terminal: p.id })],
          ["Open in new tab", () => run("terminal.keep", { terminal: p.id, place: "tab" })],
          null,
          ["Delete agent", () => kill(p.id), true],
        ];
      }
      if (!a) return [];
      return [
        ["Go to agent", () => run("agent.focus", { terminal: a.address })],
        [a.pinned ? "Unpin" : "Pin to top", () => run("terminal.pin", { terminal: a.address, pinned: !a.pinned })],
        ["Peek", () => run("terminal.peek", { terminal: a.address })],
        null,
        ["Delete agent", () => kill(a.address), true],
      ];
    }
    return [];
  }

  renderMenu() {
    const t = theme();
    const items = this.menuItems();
    return v_flex()
      .id("hmux-menu")
      .w_full()
      .p(4)
      .bg(t.popover)
      .text_size(12)
      .children(
        items.map((it, i) =>
          it === null
            ? div().h(1).my(3).mx(6).bg(t.border)
            : h_flex()
              .id(`hmux-menu-${i}`)
              .h(26)
              .px(10)
              .items_center()
              .rounded(5)
              .text_color(it[2] ? t.blocked : t.foreground)
              .hover((s) => s.bg(t.hover))
              .on_click(() => {
                closeOverlay(props().overlay);
                it[1]();
              })
              .child(it[0]),
        ),
      );
  }

  renderConfirm() {
    const t = theme();
    const p = props() ?? {};
    const keep = () => closeOverlay(p.overlay);
    const yes = () => {
      closeOverlay(p.overlay);
      if (p.command.exec) {
        const [cmd, args] = p.command.exec;
        exec(cmd, args).catch(() => {});
      } else {
        run(p.command.name, p.command.args ?? {});
      }
    };
    const button = (id, label, danger, onClick) =>
      h_flex().id(id).h(30).px(14).items_center().rounded(6)
        .border_1().border_color(danger ? t.blocked : t.input)
        .when(danger, (el) => el.bg(t.blocked).text_color("#ffffff"))
        .when(!danger, (el) => el.text_color(t.foreground))
        .hover((s) => s.opacity(0.85))
        .on_click(onClick)
        .child(label);
    return v_flex()
      .id("hmux-confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" || e.key === "enter") keep(); // Enter keeps: the safe choice is the default
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .text_color(t.foreground)
      .child(div().font_semibold().child(p.title ?? ""))
      .child(div().flex_1().text_size(12).text_color(t.muted).child(p.body ?? ""))
      .child(h_flex().gap(8).justify_end()
        .child(button("hmux-confirm-keep", "Keep", false, keep))
        .child(button("hmux-confirm-yes", p.yes ?? "Close", true, yes)));
  }

  // ── sidebar ────────────────────────────────────────────────────────────────
  renderSidebar(cx) {
    const t = theme();
    const list = agents();
    // "Rename" from a right-click menu.
    const ask = shared(RENAME_KEY);
    if (ask && ask.at > this.renameSeen) {
      this.renameSeen = ask.at;
      this.startEdit(ask.kind, ask.id, cx);
    }
    this.settlePending(cx);
    return v_flex()
      .id("hmux-sidebar")
      .relative()
      .size_full()
      .on_size_change((size) => {
        // The title bar's divider follows the sidebar's live width.
        const w = Math.round(size.width);
        if (w > 0 && Math.abs(w - Number(shared(SIDEBAR_W) ?? 0)) >= 1) setShared(SIDEBAR_W, w);
      })
      .text_size(12)
      .text_color(t.foreground)
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const dx = e.position.x - d.start.x;
        const dy = e.position.y - d.start.y;
        if (!d.active && Math.hypot(dx, dy) < DRAG_START) return;
        d.active = true;
        d.dy = dy;
        d.target = this.targetFor(d);
        cx.notify();
      })
      // Release: drop where the preview shows it.
      .on_mouse_up("left", (_e, cx) => {
        if (!this.drag) return;
        if (this.drag.active) this.commitDrag(cx);
        else this.endDrag();
        cx.notify();
      })
      // Released outside the sidebar: the next press anywhere cancels it.
      .on_mouse_down_out((_e, cx) => {
        if (this.edit) this.commitEdit(cx);
        if (!this.drag) return;
        this.endDrag();
        cx.notify();
      })
      .child(
        v_flex()
          .id("hmux-sidebar-scroll")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .pb(6)
          .child(this.agentsSection(t, list))
          .child(this.sessionsSection(t)),
      )
      .child(this.sessionSection(t, list));
  }

  endDrag() {
    this.drag = null;
    this.dropGroup = null;
  }

  saveExpanded() {
    try {
      localStorage.setItem("expanded", JSON.stringify([...this.expanded]));
    } catch {}
  }

  toggleExpanded(id, open = !this.expanded.has(id)) {
    if (open) this.expanded.add(id);
    else this.expanded.delete(id);
    this.saveExpanded();
  }

  // ── inline rename ──────────────────────────────────────────────────────────
  // Space names are Herdr's labels only (space.rename): the folder on disk keeps its name.
  // Group names are the mod's own state.
  startEdit(kind, id, cx) {
    let shownName = "";
    let placeholder = null;
    if (kind === "group") {
      const g = groups().find((x) => x.id === id);
      if (!g) return;
      shownName = g.name;
    } else {
      const all = spaces();
      const s = kind === "space" ? all.find((x) => x.id === id) : all.find((x) => x.tabs.some((tb) => tb.id === id));
      const tb = kind === "tab" ? s?.tabs.find((x) => x.id === id) : null;
      if (!s || (kind === "tab" && !tb)) return;
      if (kind === "tab") {
        const cwd = shortPath(panes().find((p) => p.tab === tb.id && p.cwd)?.cwd ?? s.folder);
        const auto = s.machine ? cwd || this.tabLabel(tb) : this.tabLabel(tb);
        shownName = tb.named ? tb.name : "";
        placeholder = auto;
      } else {
        shownName = s.name;
      }
    }
    // A named tab starts with its name; an unnamed one starts empty and shows
    // the automatic name as a placeholder.
    const input = InputState.new(placeholder ? { placeholder, value: shownName } : { value: shownName });
    this.edit = { kind, id, input, done: false, original: shownName };
    input.on("submit", (_e, cx) => this.commitEdit(cx));
    input.on("blur", (_e, cx) => this.commitEdit(cx));
    cx.timer.after(30, () => input.focus());
  }

  commitEdit(cx, cancel = false) {
    const e = this.edit;
    if (!e || e.done) return;
    e.done = true;
    const name = e.input.value().trim();
    // An empty name clears it back to the automatic one; an unchanged name is
    // left alone, so an automatic name keeps following its folder or agent.
    if (!cancel && name !== e.original) {
      if (e.kind === "group") setGroups(groups().map((g) => (g.id === e.id ? { ...g, name } : g)));
      else run(e.kind === "tab" ? "tab.rename" : "space.rename", { id: e.id, name });
    }
    this.edit = null;
    cx.notify();
  }

  editor(t, kind, id) {
    if (this.edit?.kind !== kind || this.edit.id !== id) return null;
    return div()
      .id(`hmux-edit-${id}`)
      .flex_1()
      .min_w(0)
      .h(22)
      .px(6)
      .flex()
      .items_center()
      .rounded(5)
      .bg(t.popover)
      .border_1()
      .border_color(t.accent)
      .shadow_sm()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        this.commitEdit(cx, true);
        cx.stop_propagation();
      })
      .child(Input.new(this.edit.input).w_full().text_size(12).text_color(t.foreground));
  }

  // ── drag (sessions, and machine folders) ───────────────────────────────────
  // Live reorder: past DRAG_START px the grabbed row lifts and follows the pointer, and the other
  // rows spring aside to show where it will land. Dropping a session on a group header files it
  // there; any other release saves the order. The preview stays until the rows settle (gen).
  heightOf(kind, id) {
    return kind === "tab" ? SESSION_H : this.heights[id] ?? ROW;
  }

  // Where the grabbed row would land among its siblings, from how far it has moved.
  targetFor(d) {
    const ids = d.siblings;
    const from = ids.indexOf(d.id);
    if (from < 0) return 0;
    let top = 0;
    for (let i = 0; i < from; i++) top += this.heightOf(d.kind, ids[i]);
    const center = top + d.dy + this.heightOf(d.kind, d.id) / 2;
    let y = 0;
    let target = 0;
    for (const id of ids) {
      if (id === d.id) continue;
      const h = this.heightOf(d.kind, id);
      if (y + h / 2 < center) target++;
      y += h;
    }
    return target;
  }

  // Each sibling's vertical offset for an order: new top minus original top.
  offsetsFor(kind, ids, order) {
    const orig = {};
    let y = 0;
    for (const id of ids) { orig[id] = y; y += this.heightOf(kind, id); }
    const out = {};
    y = 0;
    for (const id of order) { out[id] = y - (orig[id] ?? y); y += this.heightOf(kind, id); }
    return out;
  }

  previewOrder(d) {
    const others = d.siblings.filter((id) => id !== d.id);
    others.splice(d.target ?? d.siblings.indexOf(d.id), 0, d.id);
    return others;
  }

  // The offset this row shows right now (0 when nothing is being dragged in its list).
  offsetOf(kind, scope, id) {
    const d = this.drag;
    if (d?.active && d.kind === kind && d.scope === scope) {
      if (id === d.id) return d.dy;
      return this.offsetsFor(kind, d.siblings, this.previewOrder(d))[id] ?? 0;
    }
    const p = this.pending;
    if (p && p.kind === kind && p.scope === scope) return p.offsets[id] ?? 0;
    return 0;
  }

  commitDrag(cx) {
    const d = this.drag;
    const drop = this.dropGroup;
    this.endDrag();
    // A session dropped on a group header (or the header above the loose list) moves there.
    if (d.mode === "local" && drop != null && drop !== d.section) {
      setGroupOf(d.id, drop);
      cx.notify();
      return;
    }
    const order = this.previewOrder(d);
    const from = d.siblings.indexOf(d.id);
    const target = order.indexOf(d.id);
    if (target === from) return; // springs back into its own slot
    // Hold the landing layout (the grabbed row snaps into its slot) until the data catches up.
    this.pending = { kind: d.kind, scope: d.section, mode: d.mode, order, offsets: this.offsetsFor(d.kind, d.siblings, order) };
    if (d.mode === "local") {
      setOrder(d.section, order);
    } else if (d.kind === "space") {
      const base = spaces().findIndex((x) => x.id === d.siblings[0]);
      run("space.move", { id: d.id, index: base + target + 1 });
    } else {
      run("tab.move", { id: d.id, index: target + 1 });
    }
    cx.timer.after(1200, (cx) => {
      if (!this.pending) return;
      this.pending = null;
      this.gen++;
      cx.notify();
    });
  }

  // The new order arrived: drop the preview and remount rows where they now are.
  settlePending() {
    const p = this.pending;
    if (!p) return;
    const now = p.mode === "local"
      ? sectionEntries(p.scope).map((e) => e.tab.id)
      : p.kind === "space"
        ? spaces().filter((x) => (x.machine ?? "") === p.scope).map((x) => x.id)
        : (spaces().find((x) => x.id === p.scope)?.tabs ?? []).filter((tb) => p.order.includes(tb.id)).map((tb) => tb.id);
    if (now.join() !== p.order.join()) return;
    this.pending = null;
    this.gen++;
  }

  // Lift style and press/click/menu handling. `offset: false` when the caller moves a wrapper instead.
  draggable(el, t, { kind, id, scope, section, mode = "machine", siblings, onClick, onDouble, onMenu, offset = true }) {
    const key = section ?? scope;
    const lifted = this.drag?.active && this.drag.id === id;
    let row = el
      .border_1()
      .border_color(lifted ? t.accent : "#00000000")
      .when(lifted, (r) => r.bg(t.raised).shadow_md())
      .on_mouse_down("left", (e, cx) => {
        if (this.edit) {
          this.commitEdit(cx);
          return;
        }
        this.drag = { kind, id, scope: key, section: key, mode, siblings, start: e.position, active: false, dy: 0, target: siblings.indexOf(id) };
      })
      .on_mouse_up("left", (e, cx) => {
        const d = this.drag;
        if (d?.active) return; // the sidebar commits the drop
        this.endDrag();
        cx.stop_propagation();
        if (d?.id === id) {
          if (e.click_count >= 2 && onDouble) onDouble(cx);
          else onClick(cx);
        }
        cx.notify();
      })
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        onMenu(e.position);
      });
    return offset ? this.slide(row, kind, key, id) : row;
  }

  // Moves a row (or a folder's whole group) by its live offset, springing between positions.
  slide(el, kind, scope, id) {
    const lifted = this.drag?.active && this.drag.id === id;
    const sp = spring(lifted ? "snappy" : "smooth");
    let out = el.relative().top(this.offsetOf(kind, scope, id) + (lifted ? -2 : 0));
    if (sp) out = out.spring("top", sp);
    return out;
  }

  // ── agents ─────────────────────────────────────────────────────────────────
  // One compact line per agent; the header folds the whole section.
  agentsSection(t, list) {
    const sorted = [...list].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.seq - a.seq,
    );
    setAgentOrder(sorted.map((a) => a.address));
    const open = !this.expanded.has("agents:off");
    const body = !open
      ? []
      : sorted.length
        ? sorted.flatMap((a) => [this.agentRow(t, a), ...this.subAgentRows(t, a.address, 1)])
        : [div().px(10).py(4).text_size(11).text_color(t.dim).child("Agents you start show up here.")];
    const fold = div()
      .id("hmux-agents-fold")
      .flex_none()
      .p(2)
      .rounded(4)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.toggleExpanded("agents:off");
        cx.notify();
      })
      .child(svg(open ? ICON.chevronDown : ICON.chevronRight).size(10).flex_none().text_color(t.dim));
    return v_flex()
      .child(
        h_flex()
          .h(22)
          .px(6)
          .pt(6)
          .gap(5)
          .items_center()
          .flex_none()
          .text_size(10.5)
          .font_semibold()
          .text_color(t.dim)
          .child(fold)
          .child(div().child("Agents"))
          .when(list.length > 0, (el) => el.child(div().text_color(t.dim).opacity(0.7).child(String(list.length))))
          .child(div().flex_1()),
      )
      .children(body);
  }

  agentRow(t, a) {
    const name = clean(a.title) || a.program?.name || "agent";
    const where = `${a.space_name} · ${a.tab_name}`;
    return h_flex()
      .id(`hmux-agent-${a.address}`)
      .mx(4)
      .px(6)
      .h(28)
      .gap(6)
      .items_center()
      .rounded(5)
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(a.focused ? t.selected : t.hover))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        openMenu({ kind: "agent", id: a.address }, e.position);
      })
      .child(programIcon(a.program, 13, t.muted) ?? div().size(13).flex_none())
      .when(a.pinned, (el) => el.child(svg(ICON.pin).size(9).flex_none().text_color(t.accent)))
      .child(div().flex_none().max_w(140).truncate().text_size(11.5).text_color(a.focused ? t.foreground : t.muted).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.dim).child(where))
      .when(a.status === "blocked", (el) =>
        el.child(div().flex_none().px(5).h(15).flex().items_center().rounded(4).bg(t.blocked + "26").text_size(9.5).font_semibold().text_color(t.blocked).child(STATUS_LABEL.blocked)),
      )
      .when(a.status !== "blocked", (el) => el.child(statusMark(t, a.status, 9) ?? div()));
  }

  // Sub-agents under their parent, indented by depth (at most 3 deep).
  subAgentRows(t, parent, depth) {
    if (depth > 3) return [];
    return subAgentsOf(parent).flatMap((k) => {
      const st = subStatus(k.status);
      const name = clean(k.name) || clean(k.report?.title) || k.program?.name || (k.argv ?? [])[0] || k.address;
      const row = h_flex()
        .id(`hmux-sub-${k.address}`)
        .mx(4)
        .pl(6 + depth * 14)
        .pr(6)
        .h(22)
        .gap(6)
        .items_center()
        .rounded(5)
        .hover((s) => s.bg(t.hover))
        .on_click(() => run("agent.focus", { terminal: k.address }))
        .on_mouse_down("right", (e, cx) => {
          cx.stop_propagation();
          openMenu({ kind: "agent", id: k.address, sub: true }, e.position);
        })
        .child(div().w(8).h(10).flex_none().border_l(1).border_b(1).border_color(t.input))
        .child(programIcon(k.program, 11, t.dim) ?? div().size(11).flex_none())
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(name))
        .child(statusMark(t, st, 8) ?? div());
      return [row, ...this.subAgentRows(t, k.address, depth + 1)];
    });
  }

  // ── groups and sessions ────────────────────────────────────────────────────
  // Sessions are listed flat, by the mod's own groups, not by Herdr space.
  // Drag a session onto a group header to file it; drag it back to the header
  // above the loose list to take it out. + starts a new session with no group.
  sessionsSection(t) {
    const addGroup = iconButton(t, "hmux-group-new", ICON.folderPlus, () => this.createGroup(), 11);
    const addSession = iconButton(t, "hmux-session-new", ICON.plus, () => run("tab.new", {}), 11);
    const auto = autoGroups();
    const loose = sessionsIn(UNGROUPED);
    const separated = (groups().length > 0 || auto.length > 0) && loose.length > 0;
    return v_flex()
      .pt(4)
      .child(
        div()
          .on_hover((hovered, cx) => {
            if (!this.drag?.active) return;
            this.dropGroup = hovered ? UNGROUPED : this.dropGroup === UNGROUPED ? null : this.dropGroup;
            cx.notify();
          })
          .child(sectionTitle(t, "Sessions", null, h_flex().gap(1).child(addGroup).child(addSession))),
      )
      .children(groups().map((g) => this.groupBlock(t, g)))
      .children(auto.map((a) => this.autoGroupBlock(t, a)))
      // Sessions in no group sit below their own label, so they never read as a
      // group's children.
      .when(separated, (el) =>
        el.child(
          h_flex().pt(10).pb(1).px(10).gap(6).items_center()
            .child(div().text_size(9.5).font_semibold().text_color(t.dim).child("UNGROUPED"))
            .child(div().flex_1().h(1).bg(t.border)),
        ),
      )
      .child(this.rowsBlock(t, UNGROUPED));
  }

  // An automatic group: the sessions that share one working folder. Unlike a
  // manual group it has no fill and a link icon, so the two never read alike.
  autoGroupBlock(t, a) {
    const key = `a:${a.key}`;
    const open = this.expanded.has(key);
    const entries = autoSessions(a.key);
    const label = shortPath(a.cwd);
    const head = h_flex()
      .id(`hmux-auto-${a.key}`)
      .mx(4)
      .pl(2)
      .pr(6)
      .h(ROW)
      .gap(5)
      .items_center()
      .rounded(5)
      .bg(t.foreground + "0d")
      .hover((st) => st.bg(t.hover))
      .on_mouse_up("left", (e, cx) => {
        if (this.drag?.active) return;
        cx.stop_propagation();
        this.toggleExpanded(key);
        cx.notify();
      })
      .child(svg(open ? ICON.chevronDown : ICON.chevronRight).size(10).flex_none().text_color(t.dim))
      .child(image(ICON.folderMac).w(12).h(12).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(label))
      .when(!open, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${entries.length}`)));
    return v_flex().child(head).when(open, (el) => el.child(this.rowsBlock(t, key)));
  }

  // A group: a header that folds and takes drops, then its sessions.
  groupBlock(t, g) {
    const key = `g:${g.id}`;
    const open = this.expanded.has(key);
    const entries = sessionsIn(g.id);
    const editing = this.editor(t, "group", g.id);
    const hovering = this.drag?.active && this.dropGroup === g.id;
    const head = h_flex()
      .id(`hmux-group-${g.id}`)
      .mx(4)
      .pl(2)
      .pr(6)
      .h(ROW)
      .gap(5)
      .items_center()
      .rounded(5)
      .bg(t.foreground + "0d")
      .when(hovering, (el) => el.bg(t.selected).border_1().border_color(t.accent))
      .when(!hovering, (el) => el.hover((st) => st.bg(t.hover)))
      .on_hover((hovered, cx) => {
        if (!this.drag?.active) return;
        this.dropGroup = hovered ? g.id : this.dropGroup === g.id ? null : this.dropGroup;
        cx.notify();
      })
      .on_mouse_up("left", (e, cx) => {
        if (this.drag?.active) return; // the sidebar commits the drop
        cx.stop_propagation();
        if (e.click_count >= 2) this.startEdit("group", g.id, cx);
        else this.toggleExpanded(key);
        cx.notify();
      })
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        openMenu({ kind: "group", id: g.id }, e.position);
      })
      .child(svg(open ? ICON.chevronDown : ICON.chevronRight).size(10).flex_none().text_color(t.dim))
      .child(image(ICON.folderMac).w(12).h(12).flex_none())
      .when(Boolean(editing), (el) => el.child(editing))
      .when(!editing, (el) => el.child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.muted).child(g.name)))
      .when(!open, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(`${entries.length}`)));
    return v_flex().child(head).when(open, (el) => el.child(this.rowsBlock(t, g.id)));
  }

  // The sessions of one section.
  rowsBlock(t, section) {
    const entries = sectionEntries(section);
    if (!entries.length) {
      return section === UNGROUPED
        ? div().px(10).py(4).text_size(11).text_color(t.dim).child("No sessions yet. + starts one.")
        : div();
    }
    const ids = entries.map((e) => e.tab.id);
    const rows = entries.map((e) => this.tabRow(t, e.space, e.tab, ids, { section }));
    return div().pl(6).child(v_flex().children(rows));
  }

  createGroup() {
    const id = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    setGroups([...groups(), { id, name: `Group ${groups().length + 1}` }]);
    this.toggleExpanded(`g:${id}`, true);
    setShared(RENAME_KEY, { kind: "group", id, at: Date.now() });
  }

  deleteGroup(id) {
    const gof = { ...groupOf() };
    const order = { ...orderOf() };
    const moved = (order[id] ?? []).filter((tabId) => gof[tabId] === id);
    for (const tabId of moved) delete gof[tabId];
    delete order[id];
    if (moved.length) order[UNGROUPED] = [...(order[UNGROUPED] ?? []), ...moved];
    setGroups(groups().filter((g) => g.id !== id));
    setShared(ASSIGN_KEY, gof);
    setShared(ORDER_KEY, order);
    this.expanded.delete(`g:${id}`);
    this.saveExpanded();
  }

  // Unnamed sessions are called by their index: use the agent's title.
  tabLabel(tb) {
    if (tb.named) return tb.name;
    const lead = agents().find((a) => a.tab === tb.id);
    return clean(lead?.title) || lead?.program?.name || `Command ${tb.index}`;
  }

  // A session row: name on top, its folder below, working time at the right of
  // the name. The active session fills with accent. No close button: the status
  // mark takes that spot, larger (right-click → Close session still closes it).
  tabRow(t, s, tb, siblings, opts = {}) {
    const here = tb.active && s.active;
    const splits = tb.panes > 1 ? `${tb.panes} splits` : "";
    const label = this.tabLabel(tb);
    const time = elapsed(tb.working_since ?? tb.changed_at);
    const cwd = shortPath(panes().find((p) => p.tab === tb.id && p.cwd)?.cwd ?? s.folder);
    const editing = this.editor(t, "tab", tb.id);
    const fg = here ? t.accent_foreground : t.foreground;
    const sub = here ? t.accent_foreground : t.dim;
    const go = () => {
      if (!s.active) run("space.select", { id: s.id });
      run("tab.select", { id: tb.id });
    };
    const mark = statusMark(t, tb.status, 14, here, 8);
    const hovered = this.rowHover === tb.id;
    const closeBox = div()
      .id(`hmux-tab-x-${tb.id}`)
      .flex_none()
      .size(18)
      .rounded(9)
      .flex()
      .items_center()
      .justify_center()
      .bg(here ? "#ffffff26" : t.foreground + "12")
      .hover((st) => st.bg(here ? "#ffffff40" : t.foreground + "24"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        askToClose("Close this session?", "Its terminals and agents will end. This can't be undone.", "Close session", { name: "tab.close", args: { id: tb.id, confirmed: true } });
      })
      .child(svg(ICON.close).size(9).flex_none().text_color(here ? t.accent_foreground : t.muted));
    const row = h_flex()
      .id(`hmux-tab-${tb.id}-${this.gen}`)
      .h(SESSION_H)
      .mx(4)
      .pl(12)
      .pr(10)
      .py(7)
      .gap(8)
      .items_center()
      .rounded(8)
      .when(here, (el) => el.bg(t.accent))
      .when(!here, (el) => el.hover((st) => st.bg(t.hover)))
      .on_hover((h, cx) => {
        this.rowHover = h ? tb.id : this.rowHover === tb.id ? null : this.rowHover;
        cx.notify();
      })
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(3)
          .child(
            h_flex().items_center().min_w(0)
              .when(Boolean(editing), (el) => el.child(editing))
              .when(!editing, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(fg).child(label))),
          )
          .child(
            h_flex().gap(8).items_center().min_w(0)
              .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(sub).opacity(here ? 0.8 : 1).child(cwd))
              .when(Boolean(splits), (el) => el.child(div().flex_none().text_size(9.5).text_color(sub).opacity(here ? 0.7 : 1).child(splits)))
              .child(div().flex_none().text_size(9.5).text_color(sub).opacity(here ? 0.7 : 1).child(time)),
          ),
      )
      .when(hovered, (el) => el.child(closeBox))
      .when(!hovered && Boolean(mark), (el) => el.child(mark));
    return this.draggable(row, t, {
      kind: "tab",
      id: tb.id,
      scope: s.id,
      section: opts.section,
      mode: opts.mode ?? (opts.section ? "local" : "machine"),
      siblings,
      onClick: go,
      onDouble: (cx) => this.startEdit("tab", tb.id, cx),
      onMenu: (at) => openMenu({ kind: "tab", id: tb.id }, at),
    });
  }

  // SSH machines in the session footer: each folds open into its sessions (and
  // the login tab that opens it); click a session to switch straight to it.
  machinesBlock(t) {
    const others = machines().filter((m) => m.name);
    const add = iconButton(t, "hmux-machine-add", ICON.plus, () => run("app.settings", { section: "machines" }), 10);
    if (!others.length) {
      return h_flex()
        .items_center()
        .gap(6)
        .child(div().flex_1().truncate().child("This Mac"))
        .child(add);
    }
    const offline = others.filter((m) => m.layout === "unavailable").length;
    const open = this.expanded.has("m:*");
    const header = h_flex()
      .id("hmux-machines")
      .gap(4)
      .items_center()
      .rounded(4)
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.toggleExpanded("m:*");
        cx.notify();
      })
      .child(svg(open ? ICON.chevronDown : ICON.chevronRight).size(10).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(`This Mac + ${others.length} ${others.length === 1 ? "machine" : "machines"}${offline ? ` · ${offline} offline` : ""}`))
      .child(add);
    if (!open) return header;
    const tone = { ready: t.done, loading: t.working, unavailable: t.idle };
    const word = { ready: "Connected", loading: "Connecting", unavailable: "Offline" };
    const rows = others.map((m) => {
      const key = `m:${m.name}`;
      const mOpen = this.expanded.has(key);
      const head = h_flex()
        .id(`hmux-machine-${m.name}`)
        .h(ROW)
        .pl(8)
        .pr(4)
        .gap(5)
        .items_center()
        .rounded(5)
        .text_size(11.5)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.toggleExpanded(key);
          cx.notify();
        })
        .on_mouse_down("right", (e, cx) => {
          cx.stop_propagation();
          openMenu({ kind: "machine", name: m.name }, e.position);
        })
        .child(svg(mOpen ? ICON.chevronDown : ICON.chevronRight).size(10).flex_none().text_color(t.dim))
        .child(svg(ICON.server).size(11).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(m.name))
        .child(div().size(6).flex_none().rounded(3).bg(tone[m.layout] ?? t.idle))
        // A plus makes a new space on that machine.
        .child(iconButton(t, `hmux-mnew-${m.name}`, ICON.plus, () => run("space.new", { machine: m.name }), 10));
      if (!mOpen) return head;
      const body = [];
      if (m.layout === "unavailable") {
        body.push(
          h_flex()
            .id(`hmux-mlogin-${m.name}`)
            .h(22)
            .pl(24)
            .pr(6)
            .gap(6)
            .items_center()
            .rounded(4)
            .hover((s) => s.bg(t.hover))
            .on_click(() => run("tab.new", { argv: ["hc", "machine", "login", m.name], name: `login ${m.name}` }))
            .child(svg(ICON.server).size(9).flex_none().text_color(t.dim))
            .child(div().text_size(10.5).text_color(t.muted).child("Connect…")),
        );
      }
      for (const s of spaces()) {
        if (s.machine !== m.name) continue;
        for (const tb of s.tabs) body.push(this.machineSessionRow(t, s, tb));
      }
      const login = localTabs().find((e) => e.tab.name === `login ${m.name}`);
      if (login) body.push(this.machineSessionRow(t, login.space, login.tab));
      if (!body.length) body.push(div().pl(24).py(2).text_size(10.5).text_color(t.dim).child("No sessions on this machine yet."));
      return v_flex().child(head).child(v_flex().children(body));
    });
    let listH = 8;
    for (const m of others) {
      listH += ROW;
      if (!this.expanded.has(`m:${m.name}`)) continue;
      if (m.layout === "unavailable") listH += 22;
      for (const sp of spaces()) if (sp.machine === m.name) listH += sp.tabs.length * 42;
      if (localTabs().some((e) => e.tab.name === `login ${m.name}`)) listH += 42;
    }
    return v_flex()
      .child(header)
      .child(v_flex().id("hmux-machines-list").h(Math.min(260, listH)).flex_none().overflow_y_scrollbar().pt(2).children(rows));
  }

  // One session under its machine, in the same two-line design as the list:
  // name on top (an unnamed remote tab takes its space's name, so new spaces on
  // one machine never all read "Command 1"), folder and time below; the active
  // one is accent-filled and hover shows an × that closes it.
  machineSessionRow(t, s, tb) {
    const here = tb.active && s.active;
    const hovered = this.machineHover === tb.id;
    const cwd = shortPath(panes().find((p) => p.tab === tb.id && p.cwd)?.cwd ?? s.folder);
    const title = tb.named ? tb.name : cwd || this.tabLabel(tb);
    const editing = this.editor(t, "tab", tb.id);
    const time = elapsed(tb.working_since ?? tb.changed_at);
    const fg = here ? t.accent_foreground : t.foreground;
    const sub = here ? t.accent_foreground : t.dim;
    const mark = statusMark(t, tb.status, 11, here, 7);
    const close = div()
      .id(`hmux-msess-x-${tb.id}`)
      .flex_none()
      .size(16)
      .rounded(8)
      .flex()
      .items_center()
      .justify_center()
      .bg(here ? "#ffffff26" : t.foreground + "12")
      .hover((st) => st.bg(here ? "#ffffff40" : t.foreground + "24"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        askToClose("Close this session?", "Its terminals and agents will end. This can't be undone.", "Close session", { name: "tab.close", args: { id: tb.id, confirmed: true } });
      })
      .child(svg(ICON.close).size(8).flex_none().text_color(here ? t.accent_foreground : t.muted));
    return h_flex()
      .id(`hmux-msess-${tb.id}`)
      .h(42)
      .mx(4)
      .pl(18)
      .pr(6)
      .gap(6)
      .items_center()
      .rounded(6)
      .when(here, (el) => el.bg(t.accent))
      .when(!here, (el) => el.hover((st) => st.bg(t.hover)))
      .on_hover((h, cx) => {
        this.machineHover = h ? tb.id : this.machineHover === tb.id ? null : this.machineHover;
        cx.notify();
      })
      .on_click(() => {
        if (!s.active) run("space.select", { id: s.id });
        run("tab.select", { id: tb.id });
      })
      .child(image(ICON.terminalMac).w(12).h(12).flex_none())
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .when(Boolean(editing), (el) => el.child(editing))
          .when(!editing, (el) =>
            el.child(
              div().truncate().text_size(11).font_medium().text_color(fg).child(title)
                .on_mouse_up("left", (e, cx) => {
                  if (e.click_count >= 2) {
                    cx.stop_propagation();
                    this.startEdit("tab", tb.id, cx);
                  }
                }),
            ))
          .child(
            h_flex().gap(6).items_center().min_w(0)
              .child(div().flex_1().min_w(0).truncate().text_size(9.5).text_color(sub).opacity(here ? 0.8 : 1).child(cwd))
              .child(div().flex_none().text_size(9).text_color(sub).opacity(here ? 0.7 : 1).child(time)),
          ),
      )
      .when(hovered, (el) => el.child(close))
      .when(!hovered && Boolean(mark), (el) => el.child(mark));
  }

  sessionSection(t, list) {
    const count = (st) => list.filter((a) => a.status === st).length;
    const chips = ["blocked", "working", "done"]
      .map((st) => [st, count(st)])
      .filter(([, n]) => n > 0)
      .map(([st, n]) =>
        h_flex().flex_none().gap(4).items_center().text_size(10.5).text_color(t.muted)
          .child(div().size(6).rounded(3).bg(t[st]))
          .child(div().child(`${STATUS_LABEL[st]} ${n}`)),
      );
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const cwd = shortPath(pane?.cwd ?? f?.cwd);
    const space = spaces().find((s) => s.active);
    const tabCount = spaces().reduce((n, s) => n + s.tabs.length, 0);

    return v_flex()
      .id("hmux-session")
      .flex_none()
      .px(10)
      .pt(6)
      .pb(8)
      .gap(3)
      .border_t(1)
      .border_color(t.border)
      .text_size(10.5)
      .text_color(t.dim)
      .child(
        h_flex().gap(6).items_center()
          .child(div().font_semibold().child("Session"))
          .child(div().flex_1())
          .child(div().child(`${spaces().length} spaces · ${tabCount} tabs`)),
      )
      .child(
        chips.length
          ? h_flex().gap(10).flex_wrap().children(chips)
          : div().text_color(t.dim).child(list.length ? "All agents are idle." : "No agents running."),
      )
      .when(Boolean(cwd), (el) =>
        el.child(h_flex().gap(4).items_center().min_w(0)
          .child(svg(ICON.folder).size(10).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(cwd))),
      )
      .when(Boolean(pane?.branch ?? space?.branch), (el) =>
        el.child(h_flex().gap(4).items_center().min_w(0)
          .child(svg(ICON.branch).size(10).flex_none())
          .child(div().flex_1().min_w(0).truncate().child(pane?.branch ?? space?.branch))),
      )
      .child(this.machinesBlock(t));
  }

  // ── pane header: one cmux-style tab ────────────────────────────────────────  // Terminal glyph, title, ×, then the pane tools; the focused pane is the page
  // color with a 2px accent line along its top.
  renderPane() {
    const t = theme();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const pane = p.pane;
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || clean(p.title) || p.program?.name || "shell";
    const close = div()
      .id(`hmux-pane-x-${pane}`)
      .flex_none()
      .p(2)
      .rounded(3)
      .hover((s) => s.bg(t.foreground + "14"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("pane.close", { pane });
      })
      .child(svg(ICON.close).size(9).flex_none().text_color(p.focused ? t.muted : t.dim));
    return h_flex()
      .id(`hmux-pane-${pane}`)
      .size_full()
      .px(10)
      .gap(6)
      .items_center()
      .bg(p.focused ? t.background : t.chrome)
      .when(p.focused, (el) => el.border_t(2).border_color(t.accent))
      .border_b(1)
      .border_color(t.border)
      .text_size(11)
      .on_mouse_down("right", (e, cx) => {
        cx.stop_propagation();
        openMenu({ kind: "panetab", id: pane }, e.position);
      })
      .on_click(() => run("pane.focus", { pane }))
      .child(image(ICON.terminalMac).w(13).h(13).flex_none())
      .child(div().flex_none().max_w(220).truncate().font_medium().text_color(p.focused ? t.foreground : t.muted).child(name))
      .child(close)
      .child(div().flex_1())
      .child(
        h_flex()
          .id(`hmux-pane-tools-${pane}`)
          .flex_none()
          .gap(1)
          .child(iconButton(t, `hmux-pr-${pane}`, ICON.splitRight, () => run("pane.split", { direction: "right", pane }), 11))
          .child(iconButton(t, `hmux-pd-${pane}`, ICON.splitDown, () => run("pane.split", { direction: "down", pane }), 11))
          .child(iconButton(t, `hmux-pz-${pane}`, p.zoomed ? ICON.unzoom : ICON.zoom, () => run("pane.zoom", { pane }), 11)),
      );
  }
}
