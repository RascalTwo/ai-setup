// The Kelpie board: renders `kelpie status --json` and runs kelpie verbs through api.ts.
import { esc, need } from "@viz/kit";
import { api } from "@viz/kit/api.js";
import type {
  Board,
  Loose,
  ProjectFile,
  ProjectOp,
  Routes,
  Row,
  Section,
  Verb,
  Words,
} from "./contract.js";
import { icon, needsYou, type Card, type Risk } from "./needs.js";

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

async function act(verb: Verb, arg?: string, to?: string) {
  const r = await post("/act", {
    body: { verb, ...(arg ? { arg } : {}), ...(to ? { to } : {}) },
  }).catch((e: unknown) => ({
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
  if (page) line(link("Open its spec / demo page", page));
  // Timeline Studio selects the task named here once, with its panel at the middle size ("strip"), then strikes it from the address bar.
  line(
    link(
      "Open in Timeline Studio",
      `${board.tracker}&${encodeURIComponent(JSON.stringify({ task: r.id, panel: "strip" }))}`,
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

/** Open tasks Kelpie never runs, in three buckets; paused ones come last in each. */
function outsideList() {
  if (!board) return;
  const { tracker, status } = board,
    o = status.outside,
    m = need("#map");
  const projects = status.projects.map((p) => p.id);
  const control = (t: Loose) =>
    o.notAgent.includes(t)
      ? `<button data-agent="${esc(t.id)}">→ Agent</button>`
      : o.orphan.includes(t)
        ? `<select data-assign="${esc(t.id)}"><option value="">→ project…</option>${projects.map((p) => `<option>${esc(p)}</option>`).join("")}</select>`
        : "";
  const row = (t: Loose) =>
    `<div class="wrow">${control(t)}<a href="${esc(`${tracker}&${encodeURIComponent(JSON.stringify({ task: t.id, panel: "strip" }))}`)}" target="_blank" rel="noopener">${esc(t.label)}</a>${t.status === "todo" ? "" : ` <span class="badge ${t.status === "paused" ? "paused" : "active"}">${esc(t.status)}</span>`}${t.project ? ` <span class="pj">${esc(t.project)}</span>` : ""}</div>`;
  const group = (title: string, why: string, list: Loose[], isOpen: boolean) =>
    `<details${isOpen ? " open" : ""}><summary><b>${esc(title)} (${list.length})</b> <span class="muted">${esc(why)}</span></summary>${list.map(row).join("") || '<div class="muted">none</div>'}</details>`;
  m.innerHTML = `<button class="x">close</button><h3>Outside Kelpie</h3>
    ${group("Orphaned", "For Agent, but in no project's colour: Kelpie will never pick these up", o.orphan, true)}
    ${group("In a project, not For Agent", "yours by hand: hand one to Agent to let Kelpie run it", o.notAgent, true)}
    ${group("Everything else", "in no project and not For Agent (meetings left out)", o.other, false)}`;
  // After a move the board refreshes; reopen this list on the new status so the task leaves it.
  const after = () => {
    if (!m.hidden) outsideList();
  };
  for (const b of m.querySelectorAll<HTMLButtonElement>("button[data-agent]"))
    b.addEventListener("click", () => {
      b.disabled = true;
      act("for-agent", b.dataset["agent"]).then(after).catch(console.error);
    });
  for (const s of m.querySelectorAll<HTMLSelectElement>("select[data-assign]"))
    s.addEventListener("change", () => {
      if (!s.value) return;
      s.disabled = true;
      act("assign", s.dataset["assign"], s.value).then(after).catch(console.error);
    });
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
    plainButton("Edit", () => {
      editor(p.id).catch((e: unknown) => toast(String(e), true));
    }),
    plainButton("↑", () => projectOp({ op: "move", id: p.id, way: "up" }), "Higher priority"),
    plainButton("↓", () => projectOp({ op: "move", id: p.id, way: "down" }), "Lower priority"),
  );
  c.append(meta, acts);
  return c;
}

function plainButton(label: string, onClick: () => void, title = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/** Runs a `kelpie project` action; true if it worked. The board refreshes either way. */
async function projectOpDone(body: ProjectOp): Promise<boolean> {
  const r = await post("/project", { body }).catch((e: unknown) => ({ ok: false, out: String(e) }));
  toast(r.out || (r.ok ? "done" : "failed"), !r.ok);
  await refresh();
  return r.ok;
}
const projectOp = (body: ProjectOp) => {
  projectOpDone(body).catch(console.error);
};

// What a new project file starts as: the README's example, with the id filled in.
const TEMPLATE = (id: string) => `---
color: ${id}          # its Project colour id in Timeline Studio
priority: 50          # lowest goes first; the board's ↑ ↓ change it
repos:                # each becomes a worktree on agent/<task-id>
  - path: ~/Desktop/Desktop/Code/${id}
    base: main        # branched off and merged back into
setup: []             # run once in each fresh worktree, e.g. ["bun install"]
checks: []            # the agent runs these before asking for review
productionalize: |    # what "ship it" means once you approve; empty = nothing to ship
  Merge agent/<task-id> into main.
---
Anything the agent should know about this project.
`;

/** The project editor: every file, live and retired; a save is checked by the tick's own loader. */
async function editor(pick?: string) {
  const files = await get("/projects");
  const e = need("#editor");
  const head = document.createElement("div");
  head.className = "edhead";
  head.innerHTML = `<h3>Projects</h3><span class="muted">Each is a file in ~/.config/kelpie/projects/. Save checks it the way the tick reads it, and that its colour is in the plan.</span>`;
  head.append(
    plainButton("close", () => {
      e.hidden = true;
    }),
  );
  const listEl = document.createElement("div");
  listEl.className = "edlist";
  const pane = document.createElement("div");
  pane.className = "edpane";
  const show = (f: ProjectFile | null) => {
    for (const b of listEl.querySelectorAll("button"))
      b.classList.toggle("on", b.dataset["id"] === (f?.id ?? "+"));
    pane.replaceChildren();
    const live = board?.status.projects.find((p) => p.id === f?.id);
    const idIn = document.createElement("input");
    idIn.placeholder = "project id, e.g. my-app";
    const title = document.createElement("h3");
    if (f) title.textContent = `${f.id}${f.retired ? " (retired)" : ""}`;
    else pane.append(idIn);
    const text = document.createElement("textarea");
    text.spellcheck = false;
    text.value = f?.text ?? TEMPLATE("my-app");
    idIn.addEventListener("input", () => {
      if (!text.dataset["touched"]) text.value = TEMPLATE(idIn.value || "my-app");
    });
    text.addEventListener("input", () => {
      text.dataset["touched"] = "1";
    });
    const warn = document.createElement("div");
    warn.className = "edwarn";
    if (live?.active)
      warn.textContent =
        "A run is in flight here: changing its repos can pull the folder out from under the agent.";
    const acts = document.createElement("div");
    acts.className = "acts";
    const id = () => f?.id ?? idIn.value.trim();
    const save = plainButton(f ? "Save" : "Create", () => {
      projectOpDone({ op: f ? "save" : "new", id: id(), text: text.value })
        .then(async (ok) => {
          if (ok) await editor(id());
        })
        .catch(console.error);
    });
    acts.append(save);
    if (f) {
      const retire = plainButton(f.retired ? "Restore" : "Retire", () => {
        if (!f.retired && !retire.classList.contains("confirm")) {
          retire.classList.add("confirm");
          retire.textContent = "Retire: nothing new starts there. Click again";
          return;
        }
        projectOpDone({ op: f.retired ? "restore" : "retire", id: f.id })
          .then(async (ok) => {
            if (ok) await editor(f.id);
          })
          .catch(console.error);
      });
      acts.append(retire);
    }
    pane.prepend(title);
    pane.append(warn, text, acts);
  };
  for (const f of files) {
    const b = plainButton(f.id, () => show(f));
    b.dataset["id"] = f.id;
    if (f.retired) b.classList.add("retired");
    listEl.append(b);
  }
  const add = plainButton("+ New project", () => show(null));
  add.dataset["id"] = "+";
  listEl.append(add);
  e.replaceChildren(head, listEl, pane);
  e.hidden = false;
  show(files.find((f) => f.id === pick) ?? null);
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

// The Needs you cards on screen, so a refresh that changes nothing leaves what you are typing alone.
let shown = "";
const drafts = new Map<string, string>(); // what you typed on a card, kept while the list redraws
const unfolded = new Set<string>(); // cards whose details you opened
const CARDS = 8; // cards before "+n more": the stale backlog is long on day one

async function answer(c: Card, verb: Words, text: string) {
  const r = await post("/answer", { body: { verb, project: c.project, id: c.id, text } }).catch(
    (e: unknown) => ({
      ok: false,
      out: String(e),
    }),
  );
  toast(r.out || (r.ok ? "done" : "failed"), !r.ok);
  if (r.ok) drafts.delete(c.id);
  await refresh();
}

/** The Merge Danger label: the colour and why, then what it touches and how to undo it. */
function riskLine(r: Risk): string {
  const said = [r.blast && `Blast radius: ${r.blast}`, r.undo && `Undo: ${r.undo}`].filter(Boolean);
  return `<p class="risk ${r.level}"><b>${icon(r)} ${esc(r.why)}</b>${said.map((x) => ` · ${esc(String(x))}`).join("")}${r.level === "red" ? "<br><b>Needs your full attention.</b>" : ""}</p>`;
}

function card(c: Card): HTMLElement {
  const el = document.createElement("article");
  el.className = `card ${c.kind}${c.risk ? ` ${c.risk.level}` : ""}`;
  el.dataset["vizId"] = `need-${c.id}`;
  el.dataset["label"] = c.headline;
  const words = c.acts.some((a) => "words" in a);
  const quick = c.acts.some((a) => "quick" in a && a.quick);
  el.innerHTML = `<div class="who"><span class="pj">${esc(c.project)} · ${esc(c.id.startsWith("gcal-") ? "calendar" : c.id)} · </span><span class="age" data-at="${esc(c.since)}">${esc(ago(c.since))}</span></div>
    <h3>${esc(c.headline)}</h3>${c.risk ? riskLine(c.risk) : ""}<p class="ask">${esc(c.ask)}</p>
    ${words ? `<textarea rows="2" aria-label="Your words for ${esc(c.id)}, quoted on the task" placeholder="${quick ? "Optional on a green card: one click records its own words; yours win" : "Your words (quoted on the task)"}"></textarea>` : ""}
    <div class="acts"></div>`;
  const box = el.querySelector("textarea");
  const acts = need(".acts", el);
  const buttons: [HTMLButtonElement, boolean][] = c.acts.map((a) => {
    const b = document.createElement("button");
    b.textContent = a.label;
    b.addEventListener("click", () => {
      for (const [x] of buttons) x.disabled = true;
      ("words" in a
        ? answer(c, a.words, box?.value.trim() || a.quick || "")
        : act(a.verb, c.id)
      ).catch(
        console.error,
      );
    });
    return [b, "words" in a && !a.quick];
  });
  acts.append(...buttons.map(([b]) => b));
  // Your words are the point of these buttons: none works until you have written some, except a green card's one click.
  const sync = () => {
    for (const [b, needsWords] of buttons) b.disabled = needsWords && !box?.value.trim();
    if (box) drafts.set(c.id, box.value);
  };
  if (box) {
    box.value = drafts.get(c.id) ?? "";
    box.addEventListener("input", sync);
  }
  sync();
  if (c.page)
    acts.append(link(c.kind === "approve" ? "Open its demo" : "Open its spec page", c.page));
  if (board)
    acts.append(
      link(
        "Open in Timeline Studio",
        `${board.tracker}&${encodeURIComponent(JSON.stringify({ task: c.id, panel: "strip" }))}`,
      ),
    );
  if (c.details) {
    const d = document.createElement("details");
    d.open = unfolded.has(c.id);
    d.innerHTML = `<summary>What Kelpie said</summary><pre>${esc(c.details)}</pre>`;
    d.addEventListener("toggle", () => {
      if (d.open) unfolded.add(c.id);
      else unfolded.delete(c.id);
    });
    el.append(d);
  }
  return el;
}

function renderNeeds(cards: Card[]) {
  const w = need("#needs");
  const all = open.has("needs"),
    list = all ? cards : cards.slice(0, CARDS);
  const sig = JSON.stringify([list, cards.length]);
  if (sig !== shown) {
    shown = sig;
    w.className = `strip${cards.length > 0 ? "" : " empty"}`;
    w.replaceChildren();
    if (cards.length === 0) w.textContent = "Nothing needs you.";
    else {
      w.insertAdjacentHTML("beforeend", `<h2>Needs you (${cards.length})</h2>`);
      const grid = document.createElement("div");
      grid.className = "cards";
      grid.append(...list.map(card));
      w.append(grid);
      if (cards.length > CARDS) {
        const more = document.createElement("button");
        more.className = "more";
        more.textContent = all ? "show fewer" : `+${cards.length - CARDS} more`;
        more.addEventListener("click", () => {
          if (all) open.delete("needs");
          else open.add("needs");
          renderNeeds(cards);
        });
        w.append(more);
      }
    }
  }
  for (const a of w.querySelectorAll<HTMLElement>(".age[data-at]"))
    a.textContent = ago(a.dataset["at"] ?? null);
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

  renderNeeds(needsYou(s, board.pages));

  const lanes = need("#lanes");
  lanes.replaceChildren();
  lanes.insertAdjacentHTML(
    "beforeend",
    `<div class="hd">Project <span class="n">${s.projects.length}</span></div>${COLS.map(([sec, h]) => `<div class="hd">${h} <span class="n">${s.projects.reduce((n, p) => n + p.rows.filter((r) => r.section === sec).length, 0)}</span></div>`).join("")}`,
  );
  for (const p of s.projects)
    lanes.append(projectCell(p), ...COLS.map(([sec]) => laneCell(p, sec)));

  // Expand all / Collapse all: every cell with a "+n more".
  const long = s.projects.flatMap((p) =>
    COLS.flatMap(([sec]) =>
      p.rows.filter((r) => r.section === sec).length > SHOW ? [`${p.id}:${sec}`] : [],
    ),
  );
  const ea = need("#expandAll");
  ea.hidden = long.length === 0;
  ea.textContent = long.every((k) => open.has(k)) ? "Collapse all" : "Expand all";
  const o = s.outside,
    ob = need("#outside");
  ob.textContent = `Outside Kelpie (${o.orphan.length + o.notAgent.length + o.other.length})${o.orphan.length > 0 ? ` · ${o.orphan.length} orphaned` : ""}`;
  ob.classList.toggle("warn", o.orphan.length > 0);
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
need("#outside").addEventListener("click", outsideList);
need("#expandAll").addEventListener("click", () => {
  const collapse = need("#expandAll").textContent === "Collapse all";
  if (collapse) open.clear();
  else
    for (const p of board?.status.projects ?? [])
      for (const [sec] of COLS) open.add(`${p.id}:${sec}`);
  render();
});
need("#projects").addEventListener("click", () => {
  editor().catch((e: unknown) => toast(String(e), true));
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
