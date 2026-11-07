// The Kelpie board: renders `kelpie status --json` and runs kelpie verbs through api.ts.
import { esc, need } from "@viz/kit";
import { api } from "@viz/kit/api.js";
import type { Board, Routes, Row, Section, Verb } from "./contract.js";

type Project = Board["status"]["projects"][number];
const { get, post } = api<Routes>();
let board: Board | null = null;

const ago = (at: string | null) => {
  if (!at) return "";
  const m = Math.round((Date.now() - Date.parse(at)) / 6e4);
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
// A calendar task's id is an event id nobody can read; its label is the event's title.
const name = (r: Row) => (r.id.startsWith("gcal-") ? r.label : r.id);
const kind = (r: Row) => (r.section === "waiting" ? "you" : r.refine ? "refine" : "build");
const COLS: [Section, string][] = [
  ["refineQueue", "Refine queue"],
  ["refining", "✎ Refining"],
  ["buildQueue", "Build queue"],
  ["building", "⚒ Building"],
  ["waiting", "Waiting on you"],
];
const SHOW = 3; // chips per queue cell before "+n"
const open = new Set<string>(); // cells the reader expanded, kept across refreshes

function toast(text: string, bad = false) {
  const t = need("#toast");
  t.textContent = text;
  t.className = `toast${bad ? " bad" : ""}`;
  t.hidden = false;
  setTimeout(
    () => {
      t.hidden = true;
    },
    bad ? 8000 : 4000,
  );
}

/** What starting something in this project now would skip, for the second click (Q10). */
function skips(p: Project): string[] {
  if (!board) return [];
  const s = board.status,
    out: string[] = [];
  if (!s.gate.open && !p.pastGate) out.push(`the gate (${s.gate.why})`);
  if (!p.active && s.projects.filter((x) => x.active).length >= s.active)
    out.push(`the active limit (${s.active})`);
  return out;
}

async function act(verb: Verb, arg?: string) {
  const r = await post("/act", { body: { verb, ...(arg ? { arg } : {}) } }).catch((e: unknown) => ({
    ok: false,
    out: String(e),
  }));
  toast(r.out || (r.ok ? "done" : "failed"), !r.ok);
  await refresh();
}

/** A button that runs a verb; one that skips the gate or active limit takes a second click. */
function verbButton(
  label: string,
  verb: Verb,
  arg: string | undefined,
  p: Project | null,
  why: string | null = null,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (why) {
    b.disabled = true;
    b.title = why;
    return b;
  }
  const past =
    p && (verb === "refine" || verb === "build" || verb === "refine-next" || verb === "build-next")
      ? skips(p)
      : [];
  b.addEventListener("click", () => {
    if (past.length > 0 && !b.classList.contains("confirm")) {
      b.classList.add("confirm");
      b.textContent = `Past ${past.join(" and ")}: click again`;
      setTimeout(() => {
        b.classList.remove("confirm");
        b.textContent = label;
      }, 5000);
      return;
    }
    b.disabled = true;
    act(verb, arg).catch(console.error);
  });
  return b;
}

function chip(r: Row, live = false): HTMLButtonElement {
  const c = document.createElement("button");
  c.className = `chip ${kind(r)}${live ? " live" : ""}${r.note.includes("⏳+") ? " late" : ""}`;
  c.dataset["vizId"] = `task-${r.id}`;
  c.dataset["label"] = r.label;
  c.title = r.label;
  c.innerHTML = `${esc(name(r))}${r.note ? `<small>${esc(r.note)}</small>` : ""}`;
  c.addEventListener("click", (e) => {
    e.stopPropagation();
    menu(r, c);
  });
  return c;
}

/** Switches herdr to the tab holding this pane. */
function focus(pane: string) {
  post("/focus", { body: { pane } })
    .then((r) => {
      if (!r.ok) toast(r.out, true);
    })
    .catch((e: unknown) => toast(String(e), true));
}

function focusButton(pane: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = "Focus its herdr tab";
  b.addEventListener("click", () => focus(pane));
  return b;
}

function link(label: string, href: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.textContent = label;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function menu(r: Row, at: HTMLElement) {
  if (!board) return;
  const p = board.status.projects.find((x) => x.rows.includes(r));
  if (!p) return;
  const m = need("#menu");
  m.innerHTML = `<h3>${esc(r.id)}</h3><div class="lbl">${esc(r.label)} · ${esc(p.id)}</div>`;
  const line = (el: HTMLElement, note = "") => {
    const d = document.createElement("div");
    d.className = "act";
    d.append(el);
    if (note) d.insertAdjacentHTML("beforeend", `<small>${esc(note)}</small>`);
    m.append(d);
  };
  line(verbButton("⚒ Build now", "build", r.id, p, r.whyNotBuild), r.whyNotBuild ?? "");
  line(verbButton("✎ Refine now", "refine", r.id, p, r.whyNotRefine), r.whyNotRefine ?? "");
  if (r.pane) line(focusButton(r.pane), r.pane);
  const page = board.pages[r.id];
  if (page) line(link("Open its spec / walkthrough page", page));
  // Timeline Studio selects the task named here once, then strikes it from the address bar.
  line(
    link(
      "Open in Timeline Studio",
      `${board.tracker}&${encodeURIComponent(JSON.stringify({ task: r.id }))}`,
    ),
  );
  const box = at.getBoundingClientRect();
  m.style.left = `${Math.min(box.left, innerWidth - 350)}px`;
  m.style.top = `${Math.min(box.bottom + 4, innerHeight - 220)}px`;
  m.hidden = false;
}

/** What waits on what in one project: a column per step away from what can move now. */
function depMap(p: Project) {
  const m = need("#map");
  const blocked = p.rows.filter((r) => r.section === "blocked");
  const byId = new Map(p.rows.map((r) => [r.id, r]));
  const inChain = new Set(
    blocked.flatMap((r) => (r.blockedBy.length > 0 ? [r.id, r.blockedBy].flat() : [])),
  );
  const depth = new Map<string, number>();
  const deep = (id: string, seen = new Set<string>()): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0; // a cycle: draw it, don't hang
    seen.add(id);
    const d =
      Math.max(
        -1,
        ...(byId.get(id)?.blockedBy ?? []).filter((b) => inChain.has(b)).map((b) => deep(b, seen)),
      ) + 1;
    depth.set(id, d);
    return d;
  };
  for (const id of inChain) deep(id);
  const cols: string[][] = [];
  for (const id of inChain) (cols[depth.get(id) ?? 0] ??= []).push(id);
  const W = 190,
    H = 34,
    GX = 40,
    GY = 12;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [c, ids] of cols.entries())
    for (const [i, id] of ids.entries()) pos.set(id, { x: c * (W + GX), y: i * (H + GY) });
  const width = Math.max(1, cols.length) * (W + GX),
    height = Math.max(1, ...cols.map((c) => c.length)) * (H + GY);
  const edges = [...inChain].flatMap((id) =>
    (byId.get(id)?.blockedBy ?? []).flatMap((b) => {
      const from = pos.get(b),
        to = pos.get(id);
      return from && to
        ? [
            `<path d="M${from.x + W},${from.y + H / 2} C${from.x + W + GX / 2},${from.y + H / 2} ${to.x - GX / 2},${to.y + H / 2} ${to.x},${to.y + H / 2}" stroke="var(--faint)" fill="none" marker-end="url(#ah)"/>`,
          ]
        : [];
    }),
  );
  const nodes = [...pos].map(([id, { x, y }]) => {
    const r = byId.get(id),
      live = r && r.section !== "blocked";
    const stroke = !r
      ? "var(--faint)"
      : live
        ? r.section === "waiting"
          ? "var(--warn)"
          : r.refine
            ? "var(--c4)"
            : "var(--accent)"
        : "var(--faint)";
    return (
      `<g data-viz-id="dep-${esc(id)}" data-label="${esc(r?.label ?? id)}"><title>${esc(r?.label ?? `${id} (not handed to agents, or finished)`)}</title>` +
      `<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="6" fill="var(--panel-2)" stroke="${stroke}" ${live ? "" : 'stroke-dasharray="4 3"'}/>` +
      `<text x="${x + 8}" y="${y + 21}">${esc(id.length > 26 ? `${id.slice(0, 25)}…` : id)}</text></g>`
    );
  });
  const loose = blocked.filter((r) => r.blockedBy.length === 0);
  m.innerHTML = `<button class="x">close</button><h3>${esc(p.id)}: what waits on what</h3>
    <div class="muted">Arrows run from a task to the tasks waiting on it. Solid = can move or is running; dashed = blocked. Each column is one more step away.</div>
    ${inChain.size > 0 ? `<svg width="${width}" height="${height + 4}" viewBox="-2 -2 ${width + 4} ${height + 4}" role="img" aria-label="Dependency map"><defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--faint)"/></marker></defs>${edges.join("")}${nodes.join("")}</svg>` : ""}
    ${loose.length > 0 ? `<h3>Held for another reason</h3>${loose.map((r) => `<div class="wrow">${esc(name(r))} <span class="muted">${esc(r.note)}${r.due ? ` · ${esc(new Date(r.due).toLocaleString())}` : ""}</span></div>`).join("")}` : ""}`;
  need(".x", m).addEventListener("click", () => {
    m.hidden = true;
  });
  m.hidden = false;
}

function finishedList(p: Project, at: HTMLElement) {
  const m = need("#menu");
  const done = p.rows
    .filter((r) => r.section === "finished")
    .toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  m.innerHTML = `<h3>${esc(p.id)}: finished</h3>${done
    .slice(0, 15)
    .map((r) => `<div class="act">${esc(r.id)} <small>${esc(ago(r.at))}</small></div>`)
    .join("")}${done.length > 15 ? `<div class="lbl">+${done.length - 15} more</div>` : ""}`;
  const box = at.getBoundingClientRect();
  m.style.left = `${box.left}px`;
  m.style.top = `${box.bottom + 4}px`;
  m.hidden = false;
}

function badge(text: string, cls = "", onClick?: (el: HTMLElement) => void): HTMLElement {
  const b = document.createElement(onClick ? "button" : "span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  if (onClick)
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(b);
    });
  return b;
}

function projectCell(p: Project): HTMLElement {
  const c = document.createElement("div");
  const busy = p.rows.some((r) => r.section !== "finished");
  c.className = `cell pjc${busy ? "" : " dim"}`;
  c.dataset["vizId"] = `project-${p.id}`;
  c.dataset["label"] = p.id;
  c.innerHTML = `<div class="name">${esc(p.id)}</div>`;
  const meta = document.createElement("div");
  meta.className = "meta";
  if (p.active) meta.append(badge("active", "active"));
  if (p.paused) meta.append(badge("paused", "paused"));
  const dredge = p.dredge;
  if (dredge) meta.append(badge("💡 dredging", "", () => focus(dredge)));
  const blocked = p.rows.filter((r) => r.section === "blocked").length;
  if (blocked) meta.append(badge(`Blocked (${blocked})`, "", () => depMap(p)));
  const done = p.rows.filter((r) => r.section === "finished").length;
  if (done) meta.append(badge(`✓ ${done}`, "", (el) => finishedList(p, el)));
  const acts = document.createElement("div");
  acts.className = "acts";
  const has = (s: Section) => p.rows.some((r) => r.section === s);
  acts.append(
    verbButton(
      "Build next",
      "build-next",
      p.id,
      p,
      has("buildQueue") ? null : "nothing signed off to build",
    ),
    verbButton(
      "Refine next",
      "refine-next",
      p.id,
      p,
      has("refineQueue") ? null : "nothing waiting to be refined",
    ),
    verbButton(p.paused ? "Resume" : "Pause", p.paused ? "resume" : "pause", p.id, null),
  );
  c.append(meta, acts);
  return c;
}

function laneCell(p: Project, s: Section): HTMLElement {
  const c = document.createElement("div");
  c.className = "cell";
  const rows = p.rows.filter((r) => r.section === s);
  const key = `${p.id}:${s}`,
    all = open.has(key);
  for (const r of all ? rows : rows.slice(0, SHOW))
    c.append(chip(r, s === "building" || s === "refining"));
  if (rows.length > SHOW) {
    const more = document.createElement("button");
    more.className = "more";
    more.textContent = all ? "show less" : `+${rows.length - SHOW} more`;
    more.addEventListener("click", () => {
      if (all) open.delete(key);
      else open.add(key);
      render();
    });
    c.append(more);
  }
  if (rows.length === 0)
    c.insertAdjacentHTML(
      "beforeend",
      `<span class="muted">${s === "building" || s === "refining" ? "free" : "—"}</span>`,
    );
  return c;
}

function render() {
  if (!board) return;
  const s = board.status;
  const gate = need("#gate");
  gate.className = `gate ${s.gate.open ? "open" : "shut"}`;
  gate.textContent = `● gate ${s.gate.open ? "open" : "shut"} · ${s.gate.why}`;
  need("#active").textContent = String(s.active);
  const pa = need("#pauseAll");
  pa.replaceWith(
    Object.assign(
      verbButton(
        s.paused ? "Resume all" : "Pause all",
        s.paused ? "resume" : "pause",
        undefined,
        null,
      ),
      { id: "pauseAll" },
    ),
  );
  need("#ship").textContent = s.ship ?? "";
  need("#fresh").textContent = `updated ${new Date().toLocaleTimeString()}`;

  // Waiting on you, across every project, oldest first (Q2).
  const w = need("#waiting");
  const waiting = s.projects
    .flatMap((p) => p.rows.flatMap((r) => (r.section === "waiting" ? [{ p, r }] : [])))
    .toSorted((a, b) => (a.r.at ?? "").localeCompare(b.r.at ?? ""));
  w.className = `strip${waiting.length > 0 ? "" : " empty"}`;
  w.innerHTML =
    waiting.length > 0
      ? `<h2>Waiting on you (${waiting.length})</h2>`
      : "Nothing is waiting on you.";
  for (const { p, r } of waiting) {
    const row = document.createElement("div");
    row.className = "wrow";
    row.dataset["vizId"] = `waiting-${r.id}`;
    row.dataset["label"] = r.label;
    row.innerHTML = `<b>${r.refine ? "✎" : "⚒"} ${esc(name(r))}</b><span class="pj">${esc(p.id)} · ${esc(ago(r.at))}</span><span>${esc(r.note)}</span>`;
    const page = board.pages[r.id];
    if (page) row.append(link("open page", page));
    if (r.pane) row.append(focusButton(r.pane));
    w.append(row);
  }

  const lanes = need("#lanes");
  lanes.replaceChildren();
  lanes.insertAdjacentHTML(
    "beforeend",
    `<div class="hd">Project</div>${COLS.map(([, h]) => `<div class="hd">${h}</div>`).join("")}`,
  );
  for (const p of s.projects)
    lanes.append(projectCell(p), ...COLS.map(([sec]) => laneCell(p, sec)));
}

async function refresh() {
  try {
    board = await get("/board");
    render();
  } catch (e) {
    toast(`couldn't read kelpie status: ${String(e)}`, true);
  }
}

document.addEventListener("click", (e) => {
  const m = need("#menu");
  if (!m.hidden && e.target instanceof Node && !m.contains(e.target)) m.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    need("#menu").hidden = true;
    need("#map").hidden = true;
  }
});
document.addEventListener("click", (e) => {
  const b =
    e.target instanceof Element
      ? e.target.closest<HTMLButtonElement>("header button[data-verb]")
      : null;
  const v = b?.dataset["verb"];
  if (b && (v === "more" || v === "less")) {
    b.disabled = true;
    act(v)
      .finally(() => {
        b.disabled = false;
      })
      .catch(console.error);
  }
});

await refresh();
setInterval(() => {
  refresh().catch(console.error);
}, 15_000); // Q6: every 15s, and after every action (act → refresh)
