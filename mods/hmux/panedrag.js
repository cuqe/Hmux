// Pane tab drag: geometry and the moves a drop makes.
//
// Herdr exposes no pane geometry and no "move pane next to that one" command,
// so this module works from what it does have:
//   - every pane header reports its own window rect (shared PANE_RECTS), and a
//     pane is its header's x/width from the header's top down to the next
//     header below it (or the window's bottom);
//   - a terminal moves with terminal.park (its pane goes, it keeps running)
//     then terminal.keep {place} beside the focused pane, and pane.swap puts it
//     on the left/top side when that is where it was dropped.

import { panes, run, shared, setShared } from "herdr";

export const PANE_DRAG = "hmux.paneDrag"; // { pane, tab } while a pane tab is dragged
export const PANE_RECTS = "hmux.paneRects"; // { [paneId]: { x, y, w, h } } header rects, window px

const EDGE = 0.25; // share of a pane, from each edge, that drops beside it (the rest swaps)

// What each header last published, so a pointer move over an unmoved header
// costs one string compare instead of reading the shared map.
const sent = new Map();

// A header publishes where it is (window px). Called on every press and move,
// so only a real change writes.
export function publishRect(pane, b) {
  if (!b || !(b.width > 0)) return;
  const r = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  const key = `${r.x},${r.y},${r.w},${r.h}`;
  const id = String(pane);
  if (sent.get(id) === key) return;
  const all = shared(PANE_RECTS) ?? {};
  const cur = all[id];
  sent.set(id, key);
  if (cur && cur.x === r.x && cur.y === r.y && cur.w === r.w && cur.h === r.h) return;
  // Keep only panes that still exist, so the map never grows. Object keys are
  // strings, so compare as strings.
  const live = new Set(panes().map((p) => String(p.pane)));
  const next = {};
  for (const [k, v] of Object.entries(all)) if (live.has(k)) next[k] = v;
  for (const k of [...sent.keys()]) if (!live.has(k)) sent.delete(k);
  next[id] = r;
  setShared(PANE_RECTS, next);
}

// The panes of one tab as rectangles in window px: each runs from its header's
// top to just above the next header beneath it, or to the window's bottom.
export function paneRects(tab, bottom) {
  const all = shared(PANE_RECTS) ?? {};
  const list = panes()
    .filter((p) => p.tab === tab && all[p.pane])
    .map((p) => ({ pane: p.pane, terminal: p.terminal, tab: p.tab, ...all[p.pane] }));
  return list.map((a) => {
    let end = bottom;
    for (const b of list) {
      if (b === a || b.y <= a.y + 1) continue;
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlap > 2 && b.y < end) end = b.y - 1;
    }
    return { pane: a.pane, terminal: a.terminal, tab: a.tab, x: a.x, y: a.y, w: a.w, h: Math.max(a.h, end - a.y), headerH: a.h };
  });
}

// Where a pointer at (x, y) would drop: { pane, zone, rect } or null. Zones are
// "center" (swap) or an edge (beside, taking that half).
export function dropAt(rects, source, x, y) {
  const r = rects.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
  if (!r || r.pane === source) return null;
  const nx = (x - r.x) / r.w;
  const ny = (y - r.y) / r.h;
  const d = { left: nx, right: 1 - nx, up: ny, down: 1 - ny };
  let zone = "center";
  let best = EDGE;
  // The header strip always swaps: it reads as "onto this tab".
  if (y >= r.y + r.headerH) {
    for (const k of ["left", "right", "up", "down"]) if (d[k] < best) { best = d[k]; zone = k; }
  }
  return { pane: r.pane, zone, rect: zoneRect(r, zone) };
}

export function zoneRect(r, zone) {
  const hw = Math.round(r.w / 2);
  const hh = Math.round(r.h / 2);
  if (zone === "left") return { x: r.x, y: r.y, w: hw, h: r.h };
  if (zone === "right") return { x: r.x + r.w - hw, y: r.y, w: hw, h: r.h };
  if (zone === "up") return { x: r.x, y: r.y, w: r.w, h: hh };
  if (zone === "down") return { x: r.x, y: r.y + r.h - hh, w: r.w, h: hh };
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

// Which side of a B is on, when they share an edge; null otherwise.
function sideOf(a, b, tol) {
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol;
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol;
  if (overlapY && Math.abs(b.x - (a.x + a.w)) <= tol) return "right";
  if (overlapY && Math.abs(a.x - (b.x + b.w)) <= tol) return "left";
  if (overlapX && Math.abs(b.y - (a.y + a.h)) <= tol) return "down";
  if (overlapX && Math.abs(a.y - (b.y + b.h)) <= tol) return "up";
  return null;
}

const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

// Waits (gently) until a terminal has a pane again after terminal.keep.
async function paneOf(cx, terminal, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const p = panes().find((x) => x.terminal === terminal);
    if (p) return p.pane;
    if (Date.now() - t0 > ms) return null;
    await sleep(cx, 25);
  }
}

// terminal.park lands a moment later; keep refuses a terminal that still has
// its pane, so wait for the pane to go first.
async function park(cx, terminal, ms = 3000) {
  run("terminal.park", { terminal });
  const t0 = Date.now();
  while (panes().some((x) => x.terminal === terminal)) {
    if (Date.now() - t0 > ms) return false;
    await sleep(cx, 20);
  }
  return true;
}

// A terminal a failed move left parked (running, but with no pane) goes back
// beside `anchor`, or beside any pane of its tab when the anchor is gone.
async function unpark(cx, terminal, anchor, tab, place) {
  if (!terminal || panes().some((x) => x.terminal === terminal)) return;
  try {
    const at = panes().find((x) => x.pane === anchor) ?? panes().find((x) => x.tab === tab);
    if (at) run("pane.focus", { pane: at.pane });
    run("terminal.keep", { terminal, place });
    await paneOf(cx, terminal);
  } catch {
    // Still parked: it keeps running and the tab's Parked list can bring it back.
  }
}

// Moves the source pane's terminal beside the target, on `zone`'s side.
async function moveBeside(cx, a, b, zone) {
  if (!(await park(cx, a.terminal))) return false;
  const place = zone === "left" || zone === "right" ? "right" : "down";
  try {
    run("pane.focus", { pane: b.pane });
    run("terminal.keep", { terminal: a.terminal, place });
  } catch {
    // Handled below: the terminal has no pane.
  }
  if (!(await paneOf(cx, a.terminal))) {
    await unpark(cx, a.terminal, b.pane, a.tab, place);
    return false;
  }
  if (zone === "left" || zone === "up") {
    run("pane.focus", { terminal: a.terminal });
    run("pane.swap", { direction: zone });
  }
  return true;
}

// A split along the pane's own parent would join that row or column and take
// space from its neighbours; one across it nests, so removing a pane later
// gives the whole slot back. A pane with a same-height neighbour beside it
// sits in a row (split down); otherwise in a column, or alone (split right).
function acrossParent(r, rects, tol) {
  const inRow = rects.some((q) => {
    if (q.pane === r.pane) return false;
    const side = sideOf(r, q, tol);
    return (side === "left" || side === "right") && Math.abs(q.y - r.y) <= tol && Math.abs(q.h - r.h) <= tol;
  });
  return inRow ? "down" : "right";
}

// Swaps two panes. Neighbours swap directly; others trade places through a
// stand-in mod pane that holds the source's slot while both terminals move.
async function swapPanes(cx, a, b, rects, tol) {
  const side = sideOf(a, b, tol);
  if (side && rects.filter((r) => r.pane !== a.pane && sideOf(a, r, tol) === side).length === 1) {
    run("pane.focus", { pane: a.pane });
    run("pane.swap", { direction: side });
    return true;
  }
  const dirA = acrossParent(a, rects, tol);
  const dirB = acrossParent(b, rects, tol);
  const before = new Set(panes().map((p) => p.pane));
  // The stand-in is a mod pane (no terminal) of this mod, new in this tab, so a
  // pane someone else opens meanwhile is never taken for it.
  const isHolder = (p) => !before.has(p.pane) && p.tab === a.tab && p.terminal == null && p.mod === "hmux";
  let holder = null;
  try {
    run("pane.split", { direction: dirA, pane: a.pane, mod: "hmux", props: { role: "spacer" } });
    for (let i = 0; i < 80 && !holder; i++) {
      holder = panes().find(isHolder)?.pane ?? null;
      if (!holder) await sleep(cx, 25);
    }
    if (!holder) return false;
    if (!(await park(cx, a.terminal))) return false;
    run("pane.focus", { pane: b.pane });
    run("terminal.keep", { terminal: a.terminal, place: dirB });
    if (!(await paneOf(cx, a.terminal))) return false;
    if (!(await park(cx, b.terminal))) return false;
    run("pane.focus", { pane: holder });
    run("terminal.keep", { terminal: b.terminal, place: dirA });
    return Boolean(await paneOf(cx, b.terminal));
  } catch {
    return false;
  } finally {
    // Whatever failed, no terminal stays parked and no stand-in stays behind:
    // a terminal still without a pane goes back into the stand-in's slot.
    holder ??= panes().find(isHolder)?.pane ?? null;
    await unpark(cx, b.terminal, holder ?? b.pane, a.tab, dirA);
    await unpark(cx, a.terminal, holder ?? b.pane, a.tab, dirA);
    if (holder) run("pane.close", { pane: holder });
  }
}

// Carries out a drop. Resolves true when the pane moved.
export async function applyDrop(cx, sourcePane, drop, rects, tol) {
  const a = rects.find((r) => r.pane === sourcePane);
  const b = rects.find((r) => r.pane === drop.pane);
  if (!a || !b || !a.terminal || !b.terminal) return false;
  let ok;
  if (drop.zone === "center") ok = await swapPanes(cx, a, b, rects, tol);
  else {
    // Already there: dropping on the edge it touches, with the same span, changes nothing.
    const side = sideOf(b, a, tol);
    const same = drop.zone === "left" || drop.zone === "right" ? a.y === b.y && a.h === b.h : a.x === b.x && a.w === b.w;
    if (side === drop.zone && same) return true;
    ok = await moveBeside(cx, a, b, drop.zone);
  }
  run("pane.focus", { terminal: a.terminal });
  return ok;
}
