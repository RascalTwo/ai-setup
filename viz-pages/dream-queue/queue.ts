import { $, $$, esc, saveHash, loadHash } from "@viz/kit";
import type { Proposal, Stat } from "./types.ts";

// ── Wire types ────────────────────────────────────────────────────────────────
// Everything fetch() returns is `unknown` until a guard below has looked at it.

type Env = {
  trunk: string | undefined;
  merge_script_ready: boolean;
  merge_script: string | undefined;
  proposal_dir: string | undefined;
};
type Tree = { dirty: boolean; count: number; sample: string[] };
type State = { proposals: Proposal[]; env: Env; fixtures: boolean; tree: Tree | undefined };
/** What /diff gave back for one proposal (or why it couldn't). */
type Diff = {
  change: string | undefined;
  error: string | undefined;
  diff: string | undefined;
  note: string | undefined;
  truncated: boolean;
};
/** Any route's JSON reply, every field checked. */
type Reply = {
  ok: boolean;
  error: string | undefined;
  out: string | undefined;
  err: string | undefined;
  code: number | undefined;
  ms: number | undefined;
  proposal: Proposal | undefined;
  stats: Record<string, Stat> | undefined;
  diff: Diff;
  state: State;
};
/** A diff hunk: where it starts on the branch and its new-side text (context + added lines). */
type Hunk = { file: string | null; start: number; lines: string[]; neu: string[] };
type Seg = { head: string } | Hunk;
type Cluster = { idx: number; letter: string; color: string; members: Proposal[] };
type Row =
  | { kind: "one"; p: Proposal }
  | { kind: "cluster"; c: Cluster; members: Proposal[]; rank: number };

/** Every key any reply may carry, each unknown. */
type Wire = {
  ok?: unknown;
  error?: unknown;
  out?: unknown;
  err?: unknown;
  code?: unknown;
  ms?: unknown;
  proposal?: unknown;
  stats?: unknown;
  change?: unknown;
  diff?: unknown;
  note?: unknown;
  truncated?: unknown;
  proposals?: unknown;
  env?: unknown;
  fixtures?: unknown;
  tree?: unknown;
  trunk?: unknown;
  merge_script_ready?: unknown;
  merge_script?: unknown;
  proposal_dir?: unknown;
  dirty?: unknown;
  count?: unknown;
  sample?: unknown;
  id?: unknown;
  title?: unknown;
  rationale?: unknown;
  rank?: unknown;
  status?: unknown;
  evidence?: unknown;
  conflicts_with?: unknown;
};

const isWire = (v: unknown): v is Wire => typeof v === "object" && v !== null;
const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const optNum = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];

/** The fields the page reads off a proposal; api.ts's normalise() guarantees the rest. */
function isProposal(v: unknown): v is Proposal {
  return (
    isWire(v) &&
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.rationale === "string" &&
    typeof v.rank === "number" &&
    typeof v.status === "string" &&
    Array.isArray(v.evidence) &&
    Array.isArray(v.conflicts_with)
  );
}

const isStats = (v: unknown): v is Record<string, Stat> => typeof v === "object" && v !== null;

function asTree(v: unknown): Tree | undefined {
  if (!isWire(v)) return undefined;
  return { dirty: v.dirty === true, count: optNum(v.count) ?? 0, sample: strList(v.sample) };
}

function asEnv(v: unknown): Env {
  const w: Wire = isWire(v) ? v : {};
  return {
    trunk: optStr(w.trunk),
    merge_script_ready: w.merge_script_ready === true,
    merge_script: optStr(w.merge_script),
    proposal_dir: optStr(w.proposal_dir),
  };
}

function asState(w: Wire): State {
  const list: unknown[] = Array.isArray(w.proposals) ? w.proposals : [];
  return {
    proposals: list.filter(isProposal),
    env: asEnv(w.env),
    fixtures: w.fixtures === true,
    tree: asTree(w.tree),
  };
}

function asReply(j: unknown): Reply {
  const w: Wire = isWire(j) ? j : {};
  return {
    ok: w.ok === true,
    error: optStr(w.error),
    out: optStr(w.out),
    err: optStr(w.err),
    code: optNum(w.code),
    ms: optNum(w.ms),
    proposal: isProposal(w.proposal) ? w.proposal : undefined,
    stats: isStats(w.stats) ? w.stats : undefined,
    diff: {
      change: optStr(w.change),
      error: optStr(w.error),
      diff: optStr(w.diff),
      note: optStr(w.note),
      truncated: w.truncated === true,
    },
    state: asState(w),
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
let S: State = asState({});
let stats: Record<string, Stat> = {}; // id -> {files, add, del} | {plan} | {error}
const openDiffs = new Set<string>(); // ids whose diff drawer is open
const diffCache = new Map<string, Diff>();
const expanded = new Set<string>(); // ids whose rationale is unclamped
const touched = new Set<string>(); // decided in THIS session — kept visible so undo stays reachable
const collapsedBands = new Set<string>();
const editing = new Map<string, string>(); // "<id>|<hunk index>" -> the reviewer's in-progress text for that hunk
const saving = new Set<string>(); // hunk keys whose save is in flight (the commit hook takes a while)
let sel: string | null = null; // selected proposal id
const hash = loadHash<{ f: string; q: string; sel: string | null }>();
let filter = hash.f ?? "queue";
let query = hash.q ?? "";

// Rank bands. Absolute, because rank has a fixed meaning (occurrences × blast
// weight, weights 3.0/1.5/1.0) — a relative/quantile split would re-label the same
// proposal differently from night to night, which makes the queue unlearnable.
const BANDS = [
  { k: "loud", min: 20, label: "Loud", hint: "acting on these is the point of the whole system" },
  { k: "strong", min: 10, label: "Strong", hint: "recurring, worth a look tonight" },
  { k: "moderate", min: 5, label: "Moderate", hint: "real but not urgent" },
  { k: "faint", min: -1, label: "Faint", hint: "carried forward; skim when you have slack" },
] as const;
const bandOf = (rank: number): number => BANDS.findIndex((b) => rank >= b.min);
// Meaning-free ramp slots only (--c4/--c5/--c7/--c8): this page already uses
// good/warn/danger semantically, so a conflict marker in --c2 would read "success".
const CC = ["var(--c4)", "var(--c5)", "var(--c7)", "var(--c8)"];

// ── Small helpers ─────────────────────────────────────────────────────────────
/** An element the page markup guarantees. */
const must = (selector: string): HTMLElement => {
  const el = $(selector);
  if (!el) throw new Error("missing " + selector);
  return el;
};
const attr = (el: Element, name: string): string => el.getAttribute(name) ?? "";
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const flip = (set: Set<string>, id: string): void => {
  if (!set.delete(id)) set.add(id);
};
const listen = (selector: string, type: string, fn: (el: HTMLElement) => void): void => {
  for (const el of $$(selector))
    el.addEventListener(type, () => {
      fn(el);
    });
};
const onClick = (selector: string, fn: (el: HTMLElement) => void): void => {
  listen(selector, "click", fn);
};
/** Run a promise in the background; its failure becomes a toast instead of an unhandled rejection. */
const bg = (p: Promise<unknown>): void => {
  p.catch((e: unknown) => {
    toast(msg(e), "bad");
  });
};

// ── Data ──────────────────────────────────────────────────────────────────────
async function api(p: string, opt?: RequestInit): Promise<Reply> {
  const r = await fetch("api/" + p, opt);
  const j: unknown = await r.json();
  return asReply(j);
}

async function post(p: string, payload: object): Promise<Reply> {
  const r = await api(p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r;
}

async function load(): Promise<void> {
  S = (await api("state")).state;
  render();
  try {
    const d = await api("diffstat");
    if (d.ok) {
      stats = d.stats ?? {};
      render();
    }
  } catch {
    /* sizing is a nicety; the rows already render without it */
  }
}

/**
 * Conflict clusters via union-find over conflicts_with (which is symmetric by
 * contract, but treated as possibly one-sided here — a single-direction edge
 * still has to group both members or the pair is invisible from one side).
 */
function clusters(items: Proposal[]): Map<string, Cluster> {
  const parent = new Map(items.map((p) => [p.id, p.id]));
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      const up = parent.get(cur) ?? cur;
      parent.set(cur, parent.get(up) ?? up);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  const join = (a: string, b: string): void => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of items)
    for (const other of p.conflicts_with) if (parent.has(other)) join(p.id, other);
  const groups = new Map<string, Proposal[]>();
  for (const p of items) {
    const r = find(p.id);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  let n = 0;
  const byId = new Map<string, Cluster>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const idx = n++;
    for (const m of members)
      byId.set(m.id, {
        idx,
        letter: String.fromCodePoint(65 + (idx % 26)),
        color: CC[idx % CC.length] ?? "",
        members,
      });
  }
  return byId;
}

/** What the current filter + search actually shows. Never truncated. */
function visible(): Proposal[] {
  const q = query.trim().toLowerCase();
  return S.proposals.filter((p) => {
    if (filter === "queue" && p.status !== "pending" && !touched.has(p.id)) return false;
    if (filter === "conflicts" && p.conflicts_with.length === 0) return false;
    if (filter === "approved" && p.status !== "approved") return false;
    if (!q) return true;
    return (p.title + " " + p.rationale + " " + p.id + " " + p.branch).toLowerCase().includes(q);
  });
}

/**
 * Rows in display order. Conflicting proposals are pulled ADJACENT to each other
 * and wrapped in one cluster block, positioned at their highest-ranked member —
 * physical adjacency is what makes "these two edit the same thing, pick one"
 * legible before thumbing, rather than a badge you have to go hunting from.
 */
function rows(items: Proposal[]): { out: Row[]; cl: Map<string, Cluster> } {
  const cl = clusters(S.proposals);
  const shown = new Set(items.map((p) => p.id));
  const out: Row[] = [];
  const placed = new Set<string>();
  for (const p of items) {
    if (placed.has(p.id)) continue;
    const c = cl.get(p.id);
    if (!c) {
      out.push({ kind: "one", p });
      placed.add(p.id);
      continue;
    }
    // Bring in every cluster member the filter also shows, best rank first.
    const members = c.members.filter((m) => shown.has(m.id)).toSorted((a, b) => b.rank - a.rank);
    for (const m of members) placed.add(m.id);
    out.push({ kind: "cluster", c, members, rank: members[0]?.rank ?? p.rank });
  }
  return { out, cl };
}

const rowRank = (r: Row): number => (r.kind === "one" ? r.p.rank : r.rank);

/** The visible proposals flattened in display order (the keyboard cursor walks this). */
function displayOrder(): Proposal[] {
  return rows(visible()).out.flatMap((row) => (row.kind === "one" ? [row.p] : row.members));
}

// ── Render ────────────────────────────────────────────────────────────────────
function bandHeader(b: number, out: Row[]): string {
  const band = BANDS[b];
  if (!band) return "";
  const n = out
    .filter((r) => bandOf(rowRank(r)) === b)
    .reduce((a, r) => a + (r.kind === "one" ? 1 : r.members.length), 0);
  const closed = collapsedBands.has(band.k);
  return `<div class="band b${b}" data-band="${band.k}">
        <h2>${band.label}</h2><span class="cnt">${n} proposal${n === 1 ? "" : "s"} · rank ${band.min < 0 ? "&lt; 5" : "≥ " + band.min}</span>
        <span class="hint">${band.hint}</span><span class="caret">${closed ? "▸ show" : "▾ hide"}</span></div>`;
}

function render(): void {
  renderBar();
  renderKeys();

  const items = visible();
  const max = Math.max(1, ...S.proposals.map((p) => p.rank));
  const { out, cl } = rows(items);
  const list = must("#list");

  if (out.length === 0) {
    list.innerHTML = `<div class="empty">Nothing matches. ${S.proposals.length} proposal(s) on disk — try the <b>all</b> filter.</div>`;
    wire(); // the bar was just re-rendered; its search box and chips need their handlers back
    return;
  }

  let html = "",
    lastBand = -1;
  for (const row of out) {
    const b = bandOf(rowRank(row));
    if (b !== lastBand) {
      html += bandHeader(b, out);
      lastBand = b;
    }
    if (collapsedBands.has(BANDS[b]?.k ?? "")) continue;
    html += row.kind === "one" ? card(row.p, max, cl) : cluster(row, max, cl);
  }
  list.innerHTML = html;

  // Auto-select the top row on first paint so a keystroke always has a target.
  if (!sel || !items.some((p) => p.id === sel)) sel = items[0]?.id ?? null;
  paintSelection();
  wire();
}

function cluster(row: Extract<Row, { kind: "cluster" }>, max: number, cl: Map<string, Cluster>) {
  const { c, members } = row;
  const anyApproved = members.some((m) => m.status === "approved");
  return `<div class="cl" style="--cc:${c.color}">
    <div class="clh"><span class="cbadge">⚔ conflict ${c.letter}</span>
      <span>pick one</span>
      <span class="why">these ${members.length} branches touch the same lines — approving both would leave the loser <code>stale</code> after the first merge.</span>
    </div>
    ${members.map((m) => card(m, max, cl, anyApproved)).join("")}
  </div>`;
}

const PILLS: Record<string, [string, string]> = {
  pending: ["", "· pending"],
  approved: ["good", "✓ approved"],
  denied: ["danger", "✕ denied"],
  merged: ["accent", "⇢ merged"],
  stale: ["warn", "⚠ stale"],
};

// "stale" alone is ambiguous: losing a conflict and having trunk move underneath
// you call for completely different responses. Spell out which one happened.
function staleNote(p: Proposal): string {
  if (p.status !== "stale") return "";
  const why: Record<string, string> = {
    "rival-merged":
      "A conflicting proposal was approved first and merged; this branch lost the race. It will be re-derived on the next dream if the need is still real.",
    "trunk-diverged": `${S.env.trunk ?? "private/trunk"} moved underneath this branch, so it no longer applies cleanly. Nothing was lost — the next dream re-derives it against the new base.`,
  };
  const known = p.stale_reason === null ? undefined : why[p.stale_reason];
  const text = known ?? `Marked stale${p.stale_reason ? " (" + p.stale_reason + ")" : ""}.`;
  return `<div class="cwarn">${esc(text)}</div>`;
}

function statBits(st: Stat | undefined): string {
  if (!st) return `<span class="k">sizing…</span>`;
  if ("plan" in st)
    return `<span class="k" title="No git branch was cut for this proposal; the plan file is the change.">from plan</span>`;
  if ("error" in st) return `<span class="k" title="${esc(st.error)}">unavailable</span>`;
  return `<span class="add">+${st.add}</span><span class="del">−${st.del}</span><span class="k">${st.files} file${st.files === 1 ? "" : "s"}</span>`;
}

function cardMeta(p: Proposal): string {
  const chips = p.evidence
    .slice(0, 6)
    .map((e) => `<span title="${esc(e)}">${esc(e.slice(0, 8))}</span>`)
    .join("");
  const more = p.evidence.length > 6 ? `<span>+${p.evidence.length - 6}</span>` : "";
  const branch = p.branch_ok
    ? esc(p.branch)
    : `⚠ invalid branch ${esc(p.branch === "" ? "(none)" : p.branch)}`;
  return `<div class="meta">
        <span><span class="occ">×${p.occurrences}</span> <span class="k">occurrences</span></span>
        <span class="k">·</span><span>${esc(p.blast_radius)}</span>
        <span class="k">·</span><span class="ev">${chips}${more}</span>
        <span class="k">·</span><span class="k">${esc(p.id)}</span>
        <span class="k">·</span><span class="k">${branch}</span>
      </div>`;
}

function rationaleHtml(p: Proposal): string {
  const long = p.rationale.length > 260;
  const clamp = long && !expanded.has(p.id);
  // Cut at a word boundary so the preview reads as a sentence, not a fragment.
  const shown = clamp ? p.rationale.slice(0, 260).replace(/\s+\S*$/u, "") + " …" : p.rationale;
  const toggle = long
    ? `<span class="more" data-rat="${p.id}">${clamp ? `▸ full rationale (${p.rationale.length} chars)` : "▴ collapse"}</span>`
    : "";
  return `<p class="rat" data-rat="${p.id}">${esc(shown)}</p>\n      ${toggle}`;
}

function card(p: Proposal, max: number, cl: Map<string, Cluster>, clusterHasApproval = false) {
  const c = cl.get(p.id);
  const isTop = p.id === S.proposals[0]?.id;
  const pct = Math.max(6, Math.round((p.rank / max) * 100));
  const openD = openDiffs.has(p.id);
  const pill = PILLS[p.status] ?? ["", p.status];

  return `<article class="p ${p.id === sel ? "sel" : ""} ${p.status !== "pending" ? "done" : ""} ${isTop ? "top" : ""}"
    data-id="${p.id}" data-viz-id="proposal-${p.id}" data-label="${esc(p.title)}">
    <div class="rail">
      <div class="meter" title="rank ${p.rank} of ${max} (highest in the queue)"><i style="height:${pct}%"></i></div>
      <span class="rankn">${p.rank}</span><span class="rankl">RANK</span>
    </div>
    <div class="pbody">
      <div class="hd">
        ${isTop ? `<span class="crown">TOP</span>` : ""}
        <span class="pill ${pill[0]}">${pill[1]}</span>
        ${c ? `<span class="cbadge" style="--cc:${c.color}">⚔ ${c.letter}</span>` : ""}
        <h3>${esc(p.title)}</h3>
      </div>
      ${cardMeta(p)}
      ${rationaleHtml(p)}
      ${c && clusterHasApproval && p.status === "pending" ? `<div class="cwarn">A branch in conflict ${c.letter} is already approved — approving this one too will likely leave it <code>stale</code>.</div>` : ""}
      ${staleNote(p)}
      <div><span class="dtog" data-diff="${p.id}">${openD ? "▾" : "▸"} proposed change ${statBits(stats[p.id])}</span></div>
      ${openD ? `<div class="diff">${renderDiff(p.id)}</div>` : ""}
    </div>
    <div class="acts">
      <button class="yes ${p.status === "approved" ? "on" : ""}" data-act="approved" data-id="${p.id}" title="Approve (a)">👍</button>
      <button class="no ${p.status === "denied" ? "on" : ""}" data-act="denied" data-id="${p.id}" title="Deny (d)">👎</button>
      ${p.status !== "pending" ? `<button class="undo" data-act="pending" data-id="${p.id}" title="Back to pending (u)">undo</button>` : ""}
    </div>
  </article>`;
}

const diffLine = (l: string, c: string): string => `<div class="${c}">${esc(l) || "&nbsp;"}</div>`;

/** One hunk: its textarea editor when the reviewer is editing it, else its lines and ✎ button. */
function hunkHtml(s: Hunk, key: string): string {
  const text = editing.get(key);
  if (text !== undefined) {
    return `<div class="ed"><span class="k">${esc(s.file)} · from line ${s.start} — edit the proposed text, then save it to the branch</span>
        <textarea data-edit="${key}" rows="${Math.min(24, s.neu.length + 2)}" ${saving.has(key) ? "readonly" : ""}>${esc(text)}</textarea>
        <span>${
          saving.has(key)
            ? `<button class="btn go" disabled><span class="spin"></span> Saving — committing to the branch and running the repo's checks…</button>`
            : `<button class="btn go" data-save="${key}">Save to branch</button> <button class="btn" data-cancel="${key}">Cancel</button>`
        }</span></div>`;
  }
  const canEdit = s.neu.length > 0 && s.file !== null && s.file !== "" && s.file !== "/dev/null";
  return (
    `<div class="h">${esc(s.lines[0])}${canEdit ? ` <button class="edb" data-hunk="${key}" title="Edit this part of the change yourself">✎ edit</button>` : ""}</div>` +
    s.lines
      .slice(1)
      .map((l) => diffLine(l, l[0] === "+" ? "a" : l[0] === "-" ? "r" : ""))
      .join("")
  );
}

function renderDiff(id: string): string {
  const d = diffCache.get(id);
  if (!d) return `<div class="err">loading…</div>`;
  // No branch was ever cut for these proposals, so the plan file IS the change. Render it
  // as prose rather than as a diff — it is markdown describing an edit, not a patch.
  if (d.change)
    return `<div class="note">Showing the proposed change from the plan file — no git branch exists for this proposal yet, so there is nothing to diff against.</div><div class="chg">${esc(d.change)}</div>`;
  if (d.error) return `<div class="err">${esc(d.error)}</div>`;
  if (!d.diff) return `<div class="err">${esc(d.note ?? "empty diff")}</div>`;
  let hi = 0;
  const body = segments(d.diff)
    .map((s) => (isHunk(s) ? hunkHtml(s, `${id}|${hi++}`) : diffLine(s.head, "f")))
    .join("");
  return (
    body + (d.truncated ? `<div class="err">… truncated (diff exceeds the display cap)</div>` : "")
  );
}

const isHunk = (s: Seg): s is Hunk => !("head" in s);

/**
 * A unified diff as file-header lines and hunks. Each hunk keeps its new-side text
 * (context + added lines) and where it starts on the branch: that span is what an edit replaces.
 */
function segments(diff: string): Seg[] {
  const out: Seg[] = [];
  let file: string | null = null,
    cur: Hunk | null = null;
  for (const l of diff.split("\n")) {
    if (l === "" || l.startsWith("\\")) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)/u.exec(l);
    if (m) {
      cur = { file, start: Number(m[1]), lines: [l], neu: [] };
      out.push(cur);
      continue;
    }
    if (l.startsWith("diff --git")) cur = null;
    if (!cur) {
      if (l.startsWith("+++ ")) file = l.slice(4).replace(/^b\//u, "");
      out.push({ head: l });
      continue;
    }
    cur.lines.push(l);
    if (l[0] === "+" || l[0] === " ") cur.neu.push(l.slice(1));
  }
  return out;
}

function renderBar(): void {
  const n = (s: string): number => S.proposals.filter((p) => p.status === s).length;
  const approved = n("approved"),
    pending = n("pending"),
    denied = n("denied");
  const conf = S.proposals.filter((p) => p.conflicts_with.length > 0).length;
  const ready = S.env.merge_script_ready;
  must("#bar").innerHTML = `
    <span class="stat"><b>${pending}</b> pending</span>
    <span class="stat"><b style="color:var(--good)">${approved}</b> approved</span>
    <span class="stat"><b style="color:var(--danger)">${denied}</b> denied</span>
    <span class="stat"><b>${S.proposals.length}</b> total</span>
    ${conf ? `<span class="stat"><b style="color:var(--c4)">${conf}</b> in conflict</span>` : ""}
    <span class="sep"></span>
    ${["queue", "all", "conflicts", "approved"].map((f) => `<button class="chip ${filter === f ? "on" : ""}" data-f="${f}">${f}</button>`).join("")}
    <input id="q" placeholder="search title / rationale / branch  ( / )" value="${esc(query)}">
    ${S.tree?.dirty ? `<span class="stat" style="color:var(--warn)" title="${esc(S.tree.sample.join("\n"))}">⚠ ${S.tree.count} uncommitted — merge will refuse</span>` : ""}
    <button class="btn go" id="merge" ${approved && ready ? "" : "disabled"}
      title="${ready ? "Runs skills/dream/scripts/merge-approved.sh" : "merge-approved.sh does not exist yet"}">
      Merge ${approved} approved${ready ? "" : " (script missing)"}</button>
    <button class="btn" id="reload" title="Re-read from disk (r)">↻</button>
    <button class="btn" id="helpb" title="Keyboard shortcuts (?)">?</button>`;
  const fx = must("#fixbar");
  fx.hidden = !S.fixtures;
  if (S.fixtures)
    fx.textContent = `⚠ FIXTURE DATA — state/proposals/ is empty, so this is reading ${S.env.proposal_dir}. Decisions here write to fixture files, not real proposals.`;
  positionSticky();
}

function renderKeys(): void {
  must("#keys").innerHTML = [
    "<b>j/k</b> move",
    "<b>a</b> approve",
    "<b>d</b> deny",
    "<b>u</b> undo",
    "<b>enter</b> diff",
    "<b>e</b> rationale",
    "<b>/</b> search",
    "<b>m</b> merge",
    "<b>r</b> reload",
    "<b>?</b> help",
  ].join(" · ");
}

/** Sticky offsets depend on whether the fixture bar is showing. */
function positionSticky(): void {
  const fix = must("#fixbar");
  const h = fix.hidden ? 0 : fix.offsetHeight;
  const bar = must("#bar");
  bar.style.top = h + "px";
  const total = h + bar.offsetHeight;
  for (const b of $$(".band")) b.style.top = total + "px";
  for (const p of $$(".p")) p.style.scrollMarginTop = total + 14 + "px";
}

function paintSelection(): void {
  for (const el of $$(".p")) el.classList.toggle("sel", attr(el, "data-id") === sel);
  saveHash({ f: filter, q: query, sel });
}

function focusSel(smooth = true): void {
  const el = $(`.p[data-id="${sel}"]`);
  if (el) el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
}

// ── Actions ───────────────────────────────────────────────────────────────────
function toast(text: string, cls = ""): void {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  must("#toast").append(d);
  setTimeout(() => {
    d.remove();
  }, 3200);
}

async function decide(id: string, status: string): Promise<void> {
  const p = S.proposals.find((x) => x.id === id);
  if (!p) return;
  const nextId = nextPending(id);
  const before = p.status;
  p.status = status; // optimistic — the row must not lag a keystroke
  touched.add(id);
  render();
  try {
    const r = await post("decide", { id, status });
    if (!r.ok) throw new Error(r.error ?? "write failed");
    if (r.proposal) Object.assign(p, r.proposal); // trust disk over the optimistic guess
    toast(`${id} → ${status}`, status === "approved" ? "ok" : "");
  } catch (e) {
    p.status = before;
    toast(`could not save ${id}: ${msg(e)}`, "bad");
  }
  if (status !== "pending" && nextId) sel = nextId; // auto-advance: decide, decide, decide
  render();
  focusSel();
}

/** Next still-pending proposal after `id` in the visible order — the triage cursor. */
function nextPending(id: string): string | null {
  const order = displayOrder();
  const i = order.findIndex((p) => p.id === id);
  const after = order.slice(i + 1).find((p) => p.status === "pending");
  const before = order.slice(0, Math.max(0, i)).find((p) => p.status === "pending");
  return (after ?? before)?.id ?? null;
}

function hunkOf(key: string): { id: string; h: Hunk | undefined } {
  const [id = "", i] = key.split("|");
  const hunks = segments(diffCache.get(id)?.diff ?? "").filter(isHunk);
  return { id, h: hunks[Number(i)] };
}

async function saveEdit(key: string): Promise<void> {
  const { id, h } = hunkOf(key);
  if (!h) {
    toast("reload: that part of the diff is gone", "bad");
    return;
  }
  saving.add(key);
  render();
  try {
    const r = await post("edit", {
      id,
      file: h.file,
      start: h.start,
      before: h.neu.join("\n"),
      after: editing.get(key),
    });
    if (!r.ok)
      throw new Error(
        (r.error ?? "edit failed") + (r.out ? " — " + r.out.split("\n").slice(-3).join(" ") : ""),
      );
  } catch (e) {
    saving.delete(key);
    toast(`not saved: ${msg(e)}`, "bad");
    render();
    return;
  }
  saving.delete(key);
  for (const k of editing.keys()) if (k.startsWith(id + "|")) editing.delete(k);
  diffCache.delete(id);
  toast(`${id}: your edit is committed on its branch`, "ok");
  await fetchDiff(id);
  await load();
}

async function fetchDiff(id: string): Promise<void> {
  try {
    const r = await api("diff?id=" + encodeURIComponent(id));
    diffCache.set(id, r.ok ? r.diff : { ...r.diff, error: r.error ?? "diff unavailable" });
  } catch (e) {
    diffCache.set(id, { ...EMPTY_DIFF, error: String(e) });
  }
  render();
}

const EMPTY_DIFF: Diff = {
  change: undefined,
  error: undefined,
  diff: undefined,
  note: undefined,
  truncated: false,
};

async function toggleDiff(id: string): Promise<void> {
  if (openDiffs.has(id)) {
    openDiffs.delete(id);
    render();
    return;
  }
  openDiffs.add(id);
  render();
  if (!diffCache.has(id)) await fetchDiff(id);
}

function move(step: number): void {
  const shown = displayOrder().filter((p) => !collapsedBands.has(BANDS[bandOf(p.rank)]?.k ?? ""));
  if (shown.length === 0) return;
  const i = shown.findIndex((p) => p.id === sel);
  sel = shown[Math.min(shown.length - 1, Math.max(0, Math.max(0, i) + step))]?.id ?? sel;
  paintSelection();
  focusSel();
}

function overlay(html: string): HTMLElement {
  const v = document.createElement("div");
  v.className = "veil";
  v.innerHTML = `<div class="box">${html}</div>`;
  v.addEventListener("click", (e) => {
    if (e.target === v) v.remove();
  });
  document.body.append(v);
  return v;
}

const HELP_KEYS = [
  ["j / ↓", "next proposal"],
  ["k / ↑", "previous"],
  ["a", "approve (auto-advances to the next pending)"],
  ["d / x", "deny (auto-advances)"],
  ["u", "undo — back to pending"],
  ["enter / o", "toggle the diff"],
  ["e", "expand / collapse the rationale"],
  ["/", "search"],
  ["esc", "leave search / close this"],
  ["m", "merge approved"],
  ["r", "re-read from disk"],
  ["g / G", "first / last"],
  ["?", "this"],
] as const;

function help(): void {
  overlay(`<h3>Triage keys</h3><div class="kk">
    ${HELP_KEYS.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join("")}
  </div>
  <p style="color:var(--muted);font-size:12.5px;margin-top:16px">
  Everything targets <code>${esc(S.env.trunk ?? "private/trunk")}</code>. This dashboard never performs a
  network write and runs only read-only git commands plus <code>${esc(S.env.merge_script ?? "")}</code> and
  <code>propose-branch.sh</code> (which commits your ✎ edits onto the proposal's own branch).</p>`);
}

/** The text asking the reviewer to confirm a merge, in the order the script will run it. */
function mergeQuestion(approved: Proposal[]): string {
  // Preflight: the script refuses on a dirty tree, which is this repo's normal
  // state. Explaining it here beats letting the button look broken.
  const t = S.tree;
  const dirty = t?.dirty
    ? `\n\n⚠ The working tree has ${t.count} uncommitted change(s). merge-approved.sh will refuse to run until it is clean:\n` +
      t.sample.map((l) => "    " + l).join("\n") +
      (t.count > t.sample.length ? "\n    …" : "")
    : "";
  // Approval order decides conflict winners, so show it in the order it will run.
  const order = approved.toSorted((a, b) =>
    (a.approved_at ?? "").localeCompare(b.approved_at ?? ""),
  );
  return (
    `Merge ${approved.length} approved proposal(s) into ${S.env.trunk ?? "private/trunk"}, in approval order?\n\n` +
    order.map((p, i) => `  ${i + 1}. ${p.title}`).join("\n") +
    `\n\nThis runs ${S.env.merge_script ?? ""} locally. Nothing is published.` +
    dirty
  );
}

/** Ask first, in the page (a native confirm() is blocked by lint and invisible to tests). */
function doMerge(): void {
  if ($("#mergeconfirm")) return;
  const approved = S.proposals.filter((p) => p.status === "approved");
  if (approved.length === 0) return toast("nothing approved", "bad");
  if (!S.env.merge_script_ready) return toast("merge-approved.sh does not exist yet", "bad");
  const v = overlay(
    `<h3>Merge ${approved.length} approved?</h3><pre>${esc(mergeQuestion(approved))}</pre>
    <button class="btn go" id="mergego">Merge</button> <button class="btn" id="mergeno">Cancel</button>`,
  );
  v.id = "mergeconfirm";
  $("#mergeno", v)?.addEventListener("click", () => {
    v.remove();
  });
  $("#mergego", v)?.addEventListener("click", () => {
    v.remove();
    bg(runMerge(approved.length));
  });
}

async function runMerge(count: number): Promise<void> {
  const v = overlay(
    `<h3>Merging ${count} approved…</h3><pre>running ${esc(S.env.merge_script ?? "")}</pre>`,
  );
  const box = (html: string): void => {
    const b = $(".box", v);
    if (b) b.innerHTML = html;
  };
  try {
    const r = await api("merge", { method: "POST" });
    const out = r.out ?? "";
    const err = r.err ?? "";
    // A refusal (exit 1 with a message) is a normal, explainable state — most often
    // a dirty working tree. Frame it as "declined, nothing changed", not a crash.
    const declined = !r.ok && r.code === 1 && (out !== "" || err !== "");
    const head = r.ok
      ? ["var(--good)", "✓ merge finished"]
      : declined
        ? ["var(--warn)", "⚠ merge declined — nothing was merged"]
        : ["var(--danger)", "✕ merge failed"];
    const text = out + (err ? "\n--- stderr ---\n" + err : "");
    box(
      `<h3 style="color:${head[0]}">${head[1]} (exit ${r.code ?? "?"}, ${r.ms ?? "?"}ms)</h3>` +
        (declined
          ? `<p style="color:var(--muted);font-size:13px;margin:0 0 10px">
         The merge script stopped before changing anything. Your approvals are still recorded on disk —
         fix what it reports below and press <kbd>m</kbd> again.</p>`
          : "") +
        `<pre>${esc(text === "" ? (r.error ?? "(no output)") : text)}</pre>` +
        `<button class="btn" id="closev">close</button>`,
    );
    $("#closev", v)?.addEventListener("click", () => {
      v.remove();
    });
  } catch (e) {
    box(`<h3 style="color:var(--danger)">merge request failed</h3><pre>${esc(String(e))}</pre>`);
  }
  await load();
}

// ── Wiring ────────────────────────────────────────────────────────────────────
function wire(): void {
  onClick("[data-act]", (b) => {
    sel = attr(b, "data-id");
    bg(decide(sel, attr(b, "data-act")));
  });
  onClick("[data-hunk]", (b) => {
    const key = attr(b, "data-hunk");
    editing.set(key, hunkOf(key).h?.neu.join("\n") ?? "");
    render();
    $(`[data-edit="${key}"]`)?.focus();
  });
  listen("[data-edit]", "input", (t) => {
    if (t instanceof HTMLTextAreaElement) editing.set(attr(t, "data-edit"), t.value);
  });
  onClick("[data-save]", (b) => {
    bg(saveEdit(attr(b, "data-save")));
  });
  onClick("[data-cancel]", (b) => {
    editing.delete(attr(b, "data-cancel"));
    render();
  });
  onClick("[data-diff]", (b) => {
    sel = attr(b, "data-diff");
    bg(toggleDiff(sel));
  });
  onClick("[data-rat]", (b) => {
    flip(expanded, attr(b, "data-rat"));
    render();
  });
  onClick(".band", (b) => {
    flip(collapsedBands, attr(b, "data-band"));
    render();
  });
  listen(".p", "mousedown", (el) => {
    sel = attr(el, "data-id");
    paintSelection();
  });
  onClick("[data-f]", (b) => {
    filter = attr(b, "data-f");
    render();
  });
  const q = $<HTMLInputElement>("#q");
  if (q)
    q.addEventListener("input", () => {
      query = q.value;
      const at = q.selectionStart ?? query.length;
      render();
      const nq = $<HTMLInputElement>("#q");
      nq?.focus();
      nq?.setSelectionRange(at, at);
    });
  must("#merge").addEventListener("click", doMerge);
  must("#reload").addEventListener("click", () => {
    bg(load());
  });
  must("#helpb").addEventListener("click", help);
}

/** Keys that work anywhere outside a text field. */
const GLOBAL_KEYS = new Map<string, () => void>([
  ["/", () => $("#q")?.focus()],
  ["?", help],
  ["j", () => move(1)],
  ["ArrowDown", () => move(1)],
  ["k", () => move(-1)],
  ["ArrowUp", () => move(-1)],
  ["g", () => move(-9999)],
  ["G", () => move(9999)],
  [
    "r",
    () => {
      bg(load());
    },
  ],
  ["m", doMerge],
]);

/** Keys that act on the selected proposal. */
const SEL_KEYS = new Map<string, (id: string) => void>([
  [
    "a",
    (id) => {
      bg(decide(id, "approved"));
    },
  ],
  [
    "d",
    (id) => {
      bg(decide(id, "denied"));
    },
  ],
  [
    "x",
    (id) => {
      bg(decide(id, "denied"));
    },
  ],
  [
    "u",
    (id) => {
      bg(decide(id, "pending"));
    },
  ],
  [
    "Enter",
    (id) => {
      bg(toggleDiff(id));
    },
  ],
  [
    "o",
    (id) => {
      bg(toggleDiff(id));
    },
  ],
  [
    "e",
    (id) => {
      flip(expanded, id);
      render();
    },
  ],
]);

window.addEventListener("keydown", (e: KeyboardEvent) => {
  const t = e.target;
  const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  if (e.key === "Escape") {
    if (typing) t.blur();
    for (const v of $$(".veil")) v.remove();
    return;
  }
  // The merge question is modal: nothing underneath it takes keys.
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $("#mergeconfirm")) return;
  const anywhere = GLOBAL_KEYS.get(e.key);
  if (anywhere) {
    e.preventDefault();
    anywhere();
    return;
  }
  const onSel = SEL_KEYS.get(e.key);
  if (sel && onSel) {
    e.preventDefault();
    onSel(sel);
  }
});

window.addEventListener("resize", positionSticky);
sel = hash.sel ?? null;
bg(load());
