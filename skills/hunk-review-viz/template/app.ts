// app.ts — the review page. One commit at a time, its files and hunks in reading order; every
// hunk and file can be approved (✓), flagged (✎ change this) or asked about (? question), with an
// optional note. Marks are saved through api.ts as they're made; Send tells the agent this pass is done.
import { $, $$, esc, loadHash, need, saveHash } from "@viz/kit";
import { api } from "@viz/kit/api.js";
import { highlightLines, loadHighlighter } from "./highlight.js";
import { interdiff, newSide } from "./interdiff.js";
import { type Counts, countLines, countsHtml, share, size, sum } from "./stats.js";
import type {
  CommitView,
  FileView,
  Hunk,
  Mark,
  MarkBody,
  ReviewView,
  Routes,
  Status,
} from "./contract.js";

const { get, post } = api<Routes>();

const STATUS_LABEL: Record<Status, string> = {
  unreviewed: "not reviewed",
  ok: "approved",
  change: "change this",
  question: "question",
  answered: "answered",
  addressed: "addressed: re-review",
  changed: "changed since you approved",
};
const MARKS: Mark[] = ["ok", "change", "question"];
const MARK_LABEL: Record<Mark, string> = { ok: "✓", change: "✎", question: "?" };
const MARK_TITLE: Record<Mark, string> = {
  ok: "Approve (a)",
  change: "Change this (c)",
  question: "Question (q)",
};
const REPO_COLOURS = ["var(--c4)", "var(--c5)", "var(--c7)", "var(--c8)", "var(--c1)"];

let view: ReviewView | undefined;
let current = 0; // commit index
let focusFp: string | undefined;

const asMark = (s: string | undefined): Mark | undefined => MARKS.find((m) => m === s);
const showError = (err: unknown): void => {
  need("#main").insertAdjacentHTML(
    "afterbegin",
    `<p class="error">${esc(err instanceof Error ? err.message : String(err))}</p>`,
  );
};
/** Starts async work from an event handler; a failure shows on the page instead of vanishing. */
const fire = (p: Promise<unknown>): void => {
  p.catch(showError);
};

const statusColour = (s: Status) => `var(--s-${s})`;
const repoColour = (repo: string) =>
  REPO_COLOURS[(view?.repos.findIndex((r) => r.name === repo) ?? 0) % REPO_COLOURS.length];
const allHunks = (c: CommitView) => c.files.flatMap((f) => f.hunks);

// Line counts, rolled up hunk → file → commit → review.
const countCache = new Map<string, Counts>();
function hunkCounts(h: Hunk): Counts {
  let c = countCache.get(h.fp);
  if (!c) {
    c = countLines(h.lines);
    countCache.set(h.fp, c);
  }
  return c;
}
const fileCounts = (f: FileView) => sum(f.hunks.map(hunkCounts));
const commitCounts = (c: CommitView) => sum(c.files.map(fileCounts));
const reviewCounts = () => sum((view?.commits ?? []).map(commitCounts));

/** The agent's "why read this now", set apart so it isn't read past. */
const whyHtml = (why: string | undefined) => (why ? `<div class="why">${esc(why)}</div>` : "");

/** The agent's reply, loud enough not to be read past. */
const agentHtml = (text: string) =>
  `<div class="agent"><b>Agent</b><span>${esc(text)}</span></div>`;

/**
 * Where a hunk's reply sits, as a line index: the line it was pinned to, else the end of the first
 * run of lines that changed since the reviewer's mark, else -1 (under the bar, above the diff).
 */
function replyAnchor(h: Hunk, since: Set<number>): number {
  if (h.replyLine !== undefined) {
    const { newStart } = span(h.header);
    let n = newStart;
    for (const [i, l] of h.lines.entries()) {
      if (l.startsWith("-") || l.startsWith("\\")) continue;
      if (n === h.replyLine) return i;
      n++;
    }
  }
  const first = [...since].toSorted((a, b) => a - b);
  let end = first[0] ?? -1;
  while (since.has(end + 1)) end++;
  return end;
}

/** The changed lines that weren't in what the reviewer marked: where the agent's edits are. */
function changedSince(h: Hunk): Set<number> {
  if (!h.was) return new Set();
  const before = new Set(
    h.was.lines.filter((l) => l.startsWith("+") || l.startsWith("-")).map((l) => l.trim()),
  );
  return new Set(
    h.lines.flatMap((l, i) =>
      (l.startsWith("+") || l.startsWith("-")) && !before.has(l.trim()) ? [i] : [],
    ),
  );
}

async function load(): Promise<void> {
  view = await get("/review");
  const h = loadHash<{ commit: string; hunk: string }>();
  const i = view.commits.findIndex((c) => c.subject === h.commit);
  current = i >= 0 ? i : Math.min(current, Math.max(view.commits.length - 1, 0));
  focusFp ??= h.hunk;
  render();
}

function render(): void {
  if (!view) return;
  need("#name").textContent = view.name;
  need("#repos").innerHTML = view.repos
    .map(
      (r) =>
        `<span><i class="dot" style="background:${repoColour(r.name)}"></i>${esc(r.name)} ${esc(r.range)}${r.head ? ` @ ${esc(r.head)}` : ""}</span>${r.error ? ` <span class="error">${esc(r.error)}</span>` : ""}`,
    )
    .join(" · ");
  const total = reviewCounts();
  need("#totals").innerHTML =
    `${countsHtml(total)} <span class="mut">${size(total)} lines in ${view.commits.length} commits</span>`;
  renderProgress();
  renderRail();
  renderCommit();
}

function renderProgress(): void {
  if (!view) return;
  const hunks = view.commits.flatMap(allHunks);
  const order: Status[] = [
    "ok",
    "answered",
    "question",
    "change",
    "addressed",
    "changed",
    "unreviewed",
  ];
  const n = (s: Status) => hunks.filter((h) => h.status === s).length;
  const total = hunks.length || 1;
  need("#progress").innerHTML = order
    .filter((s) => n(s))
    .map(
      (s) =>
        `<span style="width:${(100 * n(s)) / total}%;background:${statusColour(s)}" title="${n(s)} ${STATUS_LABEL[s]}" data-viz-id="progress-${s}" data-label="${n(s)} hunks ${STATUS_LABEL[s]}"></span>`,
    )
    .join("");
  need("#legend").innerHTML =
    order
      .map(
        (s) =>
          `<span><i style="background:${statusColour(s)}"></i>${STATUS_LABEL[s]} ${n(s)}</span>`,
      )
      .join("") +
    `<span>· ${n("ok")} / ${hunks.length} hunks approved${view.orphans.length > 0 ? ` · ${view.orphans.length} marks lost their content` : ""}</span>`;
}

function renderRail(): void {
  if (!view) return;
  need("#rail").innerHTML = view.commits
    .map((c, i) => {
      const strip = allHunks(c)
        .map(
          (h) =>
            `<span style="background:${statusColour(h.status)}" title="${esc(h.id)}: ${STATUS_LABEL[h.status]}"></span>`,
        )
        .join("");
      return `<a href="#" data-commit="${i}" class="${i === current ? "current" : ""}" data-viz-id="commit-${i}" data-label="commit ${esc(c.subject)}">
        <div class="repo"><i class="dot" style="background:${repoColour(c.repo)}"></i>${esc(c.repo)} · ${esc(c.sha.slice(0, 7))} · ${i + 1}/${view?.commits.length}</div>
        <div class="subject">${esc(c.subject)}</div><div class="strip">${strip}</div><div class="rail-counts">${countsHtml(commitCounts(c))}</div></a>`;
    })
    .join("");
}

/** The ✓ ✎ ? buttons for a hunk or file; `lead` goes first in the same group (a file's "✓ all"). */
function marksHtml(status: Status, fp: string, kind: "hunk" | "file", lead = ""): string {
  return `<span class="marks">${lead}${MARKS.map(
    (m) =>
      `<button data-mark="${m}" data-fp="${fp}" data-kind="${kind}" title="${MARK_TITLE[m]}" class="${status === m || (m === "question" && status === "answered") ? "on" : ""}">${MARK_LABEL[m]}</button>`,
  ).join("")}</span>`;
}

function badge(status: Status): string {
  return status === "unreviewed"
    ? ""
    : `<span class="badge" style="background:${statusColour(status)}">${STATUS_LABEL[status]}</span>`;
}

/** Where a hunk sits in the old and new file, from its "@@ -a,b +c,d @@" header. */
function span(header: string): { oldStart: number; newStart: number; newCount: number } {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(header);
  return {
    oldStart: Number(m?.[1] ?? 0),
    newStart: Number(m?.[3] ?? 0),
    newCount: Number(m?.[4] ?? 1),
  };
}

/**
 * A diff with syntax colour and line numbers (the file as it will be; a removed line shows its old
 * number, dimmed). The +/- sign sits in its own column so the code lines up.
 */
function diffHtml(
  path: string,
  lines: string[],
  start?: { old: number; new: number },
  extra: { since?: Set<number>; after?: Map<number, string> } = {},
): string {
  const code = highlightLines(path, lines);
  let o = start?.old ?? 0;
  let n = start?.new ?? 0;
  return `<pre class="diff hljs">${lines
    .map((l, i) => {
      const kind = l.startsWith("+")
        ? "add"
        : l.startsWith("-")
          ? "del"
          : l.startsWith("\\")
            ? "meta"
            : l.startsWith("~")
              ? "gap"
              : "";
      let num = "";
      if (start && kind === "del") num = `<em class="old">${o++}</em>`;
      else if (start && kind !== "meta" && kind !== "gap") {
        num = `<em>${n++}</em>`;
        if (kind === "") o++;
      } else if (start) num = "<em></em>";
      const sign = kind === "meta" || kind === "gap" ? "" : esc(l.slice(0, 1));
      const c = code[i] ?? "";
      const since = extra.since?.has(i) ? " since" : "";
      const after = extra.after?.get(i) ?? "";
      return `<div class="${kind}${since}">${num}<i>${sign}</i>${c === "" ? " " : c}</div>${after}`;
    })
    .join("")}</pre>`;
}

// ---------- folding and context ----------

const EXPAND_STEP = 20;
/** Lines of each file at its commit, fetched the first time context is expanded. */
const fileLines = new Map<string, string[] | null>();
/** Context revealed: "<hunk fp>:up" → lines shown above it, "<file fp>:down" → lines shown after its last hunk. */
const revealed = new Map<string, number>();
const fileKey = (c: CommitView, f: FileView) => `${c.repo}\0${c.sha}\0${f.path}`;

/** Folds the reviewer set by hand, stored per review; anything unset falls back to `foldedByDefault`. */
const foldKey = () => `hunk-review:${view?.name ?? ""}:folds`;
function folds(): Record<string, boolean> {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: this page wrote it
    return JSON.parse(localStorage.getItem(foldKey()) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
/**
 * Only what's approved starts folded: a fully approved file, an approved hunk. Everything unreviewed
 * is open. A folded file still lists its hunks, each as its one-line bar.
 */
function foldedByDefault(t: FileView | Hunk): boolean {
  if ("hunks" in t) return t.hunks.length > 0 && t.hunks.every((h) => h.status === "ok");
  return t.status === "ok";
}
const isFolded = (t: FileView | Hunk) => folds()[t.fp] ?? foldedByDefault(t);
function toggleFold(fp: string): void {
  const t = findFile(fp) ?? findHunk(fp);
  if (!t) return;
  const all = folds();
  all[fp] = !isFolded(t);
  localStorage.setItem(foldKey(), JSON.stringify(all));
  rerenderKeepingPlace(fp);
}

/** Re-renders the commit and scrolls so the element the reader clicked stays where it was on screen. */
function rerenderKeepingPlace(fp: string): void {
  const sel = `[data-anchor="${fp}"]`;
  const before = $(sel)?.getBoundingClientRect().top;
  renderCommit();
  const after = $(sel)?.getBoundingClientRect().top;
  if (before !== undefined && after !== undefined) scrollBy({ top: after - before });
}

async function expand(key: string, fp: string): Promise<void> {
  const c = view?.commits[current];
  const f = c?.files.find((x) => x.fp === fp || x.hunks.some((h) => h.fp === fp));
  if (!c || !f) return;
  const k = fileKey(c, f);
  if (!fileLines.has(k)) {
    const { lines } = await get("/file", { query: { repo: c.repo, sha: c.sha, path: f.path } });
    fileLines.set(k, lines);
  }
  revealed.set(key, (revealed.get(key) ?? 0) + EXPAND_STEP);
  rerenderKeepingPlace(fp);
}

const foldBtn = (t: FileView | Hunk) =>
  `<button class="fold" data-fold="${t.fp}" aria-expanded="${isFolded(t) ? "false" : "true"}" title="${isFolded(t) ? "Expand" : "Collapse"}">${isFolded(t) ? "▸" : "▾"}</button>`;

/** The context above a hunk (up to the previous hunk or the file's top), and its "show more" button. */
function contextAbove(c: CommitView, f: FileView, k: number): string {
  const h = f.hunks[k];
  if (!h) return "";
  const { newStart } = span(h.header);
  const prev = f.hunks[k - 1];
  const floor = prev ? span(prev.header).newStart + span(prev.header).newCount : 1;
  const gap = newStart - floor;
  if (newStart <= 0 || gap <= 0) return "";
  const lines = fileLines.get(fileKey(c, f));
  const shown = Math.min(revealed.get(`${h.fp}:up`) ?? 0, gap);
  const from = newStart - shown;
  const ctx =
    shown > 0 && lines
      ? diffHtml(
          f.path,
          lines.slice(from - 1, newStart - 1).map((l) => ` ${l}`),
          { old: 0, new: from },
        )
      : "";
  const more =
    shown < gap
      ? `<button class="expand" data-expand="${h.fp}:up" data-anchor-fp="${h.fp}">↑ ${Math.min(EXPAND_STEP, gap - shown)} more lines${shown === 0 ? ` (${gap} hidden)` : ""}</button>`
      : "";
  return `<div class="context">${more}${ctx.replace('class="diff hljs"', 'class="diff hljs ctx"')}</div>`;
}

/** The context after a file's last hunk, and its "show more" button. */
function contextBelow(c: CommitView, f: FileView): string {
  const last = f.hunks.at(-1);
  if (!last || f.binary) return "";
  const s = span(last.header);
  if (
    s.newStart <= 0 ||
    (s.oldStart === 0 && !last.lines.some((l) => l.startsWith(" ") || l.startsWith("-")))
  )
    return ""; // deleted or brand-new file
  const end = s.newStart + s.newCount; // first line after the hunk
  const lines = fileLines.get(fileKey(c, f));
  const total = lines?.length;
  const shown = revealed.get(`${f.fp}:down`) ?? 0;
  const to = total === undefined ? end - 1 + shown : Math.min(total, end - 1 + shown);
  const ctx =
    lines && to >= end
      ? diffHtml(
          f.path,
          lines.slice(end - 1, to).map((l) => ` ${l}`),
          { old: 0, new: end },
        ).replace('class="diff hljs"', 'class="diff hljs ctx"')
      : "";
  const more =
    total === undefined || to < total
      ? `<button class="expand" data-expand="${f.fp}:down" data-anchor-fp="${last.fp}">↓ ${EXPAND_STEP} more lines</button>`
      : "";
  return `<div class="context">${ctx}${more}</div>`;
}

/** The note, the agent's reply, and what the reviewer saw before, under a hunk or file. */
function threadHtml(t: Hunk | FileView, kind: "hunk" | "file", path: string): string {
  const parts: string[] = [];
  const own = t.status === "change" || t.status === "question" || t.status === "answered";
  if (own)
    parts.push(
      `<label><span class="who">Your note</span><input data-note="${t.fp}" data-kind="${kind}" data-markval="${t.status === "answered" ? "question" : t.status}" value="${esc(t.note ?? "")}" placeholder="optional: what to change, or what you're asking"></label>`,
    );
  else if (t.note) parts.push(`<div><span class="who">You said</span>${esc(t.note)}</div>`);
  if (t.reply && kind === "file") parts.push(agentHtml(t.reply));
  if (t.was && kind === "hunk")
    parts.push(
      `<details class="was"><summary>What you ${t.was.mark === "ok" ? "approved" : "marked"} before</summary>${diffHtml(path, t.was.lines)}</details>`,
    );
  return parts.length > 0 ? `<div class="thread">${parts.join("")}</div>` : "";
}

/** Hunks the reviewer switched to the whole hunk instead of "since you last saw it". */
const wholeView = new Set<string>();

/** Where a reply sits in a diff: after the first run of changed lines, or -1 for above it. */
function firstRunEnd(changed: Set<number>): number {
  let end = [...changed].toSorted((x, y) => x - y)[0] ?? -1;
  while (changed.has(end + 1)) end++;
  return end;
}

/**
 * A hunk's body. One the reviewer marked before and that has since changed shows, by default, only
 * what changed since they saw it (its code then vs now); otherwise the whole hunk, with the lines
 * changed since their mark flagged. Either way the agent's reply sits where it's about.
 */
function hunkBody(f: FileView, h: Hunk, s: { oldStart: number; newStart: number }): string {
  const inter =
    h.was && !wholeView.has(h.fp) ? interdiff(newSide(h.was.lines), newSide(h.lines)) : undefined;
  if (inter) {
    const changed = new Set(
      inter.flatMap((l, i) => (l.startsWith("+") || l.startsWith("-") ? [i] : [])),
    );
    const at = firstRunEnd(changed);
    const cap = `<div class="since-cap"><b>Since you last saw it</b> · ${changed.size > 0 ? `${changed.size} line${changed.size === 1 ? "" : "s"} changed` : "the code you saw is unchanged (the hunk moved or its context changed)"} <button data-view="${h.fp}" title="v">Show the whole hunk</button></div>`;
    const top = h.reply && at < 0 ? agentHtml(h.reply) : "";
    const after = new Map<number, string>(h.reply && at >= 0 ? [[at, agentHtml(h.reply)]] : []);
    return `${cap}${top}${diffHtml(f.path, inter, undefined, { after })}`;
  }
  const since = changedSince(h);
  const at = h.reply ? replyAnchor(h, since) : -1;
  const top = h.reply && at < 0 ? agentHtml(h.reply) : "";
  const after = new Map<number, string>(h.reply && at >= 0 ? [[at, agentHtml(h.reply)]] : []);
  const cap = h.was
    ? `<div class="since-cap"><b>Whole hunk</b> · lines changed since you saw it are marked <button data-view="${h.fp}" title="v">Show only what changed</button></div>`
    : "";
  return `${cap}${top}${diffHtml(f.path, h.lines, { old: s.oldStart, new: s.newStart }, { since, after })}`;
}

function toggleView(fp: string): void {
  if (wholeView.has(fp)) wholeView.delete(fp);
  else wholeView.add(fp);
  rerenderKeepingPlace(fp);
}

function renderCommit(): void {
  const main = need("#main");
  const c = view?.commits[current];
  if (!view || !c) {
    main.innerHTML = `<p class="collapsed-note">${view?.repos.some((r) => r.error) ? "A range couldn't be read; see the error above." : "No commits in this range."}</p>`;
    return;
  }
  const cc = commitCounts(c);
  const files = c.files
    .map((f) => {
      const fileFolded = isFolded(f);
      const body = f.binary
        ? `<div class="collapsed-note">Binary file</div>`
        : f.hunks
            .map((h, k) => {
              const s = span(h.header);
              const folded = fileFolded || isFolded(h);
              return `${fileFolded ? "" : contextAbove(c, f, k)}<section class="hunk${h.fp === focusFp ? " focus" : ""}${folded ? " folded" : ""}" id="h-${h.fp.slice(0, 12)}" data-hunk="${h.fp}" data-anchor="${h.fp}" style="--s:${statusColour(h.status)}" data-viz-id="${esc(h.id)}" data-label="hunk ${esc(h.id)} in ${esc(f.path)}">
            <div class="bar">${foldBtn(h)}<span class="id">${esc(h.id)}</span><span class="header">${esc(h.header)}</span>${countsHtml(hunkCounts(h))}${badge(h.status)}${marksHtml(h.status, h.fp, "hunk")}</div>
            ${folded ? "" : (h.say ?? []).map(whyHtml).join("")}${folded ? (h.reply ? agentHtml(h.reply) : "") : hunkBody(f, h, s)}${threadHtml(h, "hunk", f.path)}</section>`;
            })
            .join("") + (fileFolded ? "" : contextBelow(c, f));
      return `<article class="file${fileFolded ? " folded" : ""}" data-anchor="${f.fp}" data-viz-id="${esc(f.id)}" data-label="file ${esc(f.id)} ${esc(f.path)}">
        <div class="bar">${foldBtn(f)}<span class="id">${esc(f.id)}</span><span class="path">${esc(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}</span><span class="kind">${f.kind}</span>${countsHtml(fileCounts(f))}<span class="mut file-meta">${f.hunks.length} hunk${f.hunks.length === 1 ? "" : "s"} · ${share(size(fileCounts(f)), size(cc))} of this commit</span>${badge(f.status)}
        ${marksHtml(f.status, f.fp, "file", `<button data-fileok="${f.fp}" title="Approve every hunk in this file (A)">✓ all</button>`)}</div>
        ${whyHtml(f.why)}${threadHtml(f, "file", f.path)}${body}</article>`;
    })
    .join("");
  const gone =
    view.orphans.length > 0
      ? `<details class="orphans" open><summary>${view.orphans.length} of your marks lost their content: the hunk is gone and nothing in its file shares a changed line</summary><ul>${view.orphans
          .map(
            (o) =>
              `<li><span class="id">${esc(o.id)}</span> ${esc(MARK_LABEL[o.mark])} ${esc(o.repo)}/${esc(o.path)}${o.note ? ` · "${esc(o.note)}"` : ""}</li>`,
          )
          .join("")}</ul></details>`
      : "";
  main.innerHTML = `${gone}<div class="commit-head" style="--repo:${repoColour(c.repo)}">
      <h2>${esc(c.subject)}</h2><div class="meta">${esc(c.repo)} · ${esc(c.sha.slice(0, 10))} · commit ${current + 1} of ${view.commits.length} · ${countsHtml(cc)} · ${c.files.length} file${c.files.length === 1 ? "" : "s"} · ${share(size(cc), size(reviewCounts()))} of the review</div>
      ${whyHtml(c.why)}${c.body ? `<div class="body">${esc(c.body)}</div>` : ""}</div>${files}`;
  if (focusFp) $(`[data-hunk="${focusFp}"]`)?.scrollIntoView({ block: "nearest" });
}

function findHunk(fp: string): Hunk | undefined {
  return view?.commits.flatMap(allHunks).find((h) => h.fp === fp);
}
function findFile(fp: string): FileView | undefined {
  return view?.commits.flatMap((c) => c.files).find((f) => f.fp === fp);
}

async function mark(
  fp: string,
  kind: "hunk" | "file",
  m: Mark | null,
  note?: string,
): Promise<void> {
  const t = kind === "hunk" ? findHunk(fp) : findFile(fp);
  const body: MarkBody = { fp, kind, mark: m };
  if (note) body.note = note;
  if (t?.was) body.replaces = t.was.fp;
  await post("/mark", { body });
  await load();
}

/** Marks a hunk as the one the keys act on. Only keyboard moves scroll: a click leaves the page where it is. */
function setFocus(fp: string | undefined, scroll = false): void {
  focusFp = fp;
  saveHash({ commit: view?.commits[current]?.subject, hunk: fp });
  for (const el of $$(".hunk")) el.classList.toggle("focus", el.dataset["hunk"] === fp);
  if (fp && scroll)
    $(`[data-hunk="${fp}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function goCommit(i: number, hunkAt: "first" | "last" = "first"): void {
  if (!view || i < 0 || i >= view.commits.length) return;
  current = i;
  const c = view.commits[i];
  if (!c) return;
  const hs = allHunks(c);
  focusFp = (hunkAt === "first" ? hs[0] : hs.at(-1))?.fp;
  saveHash({ commit: c.subject, hunk: focusFp });
  render();
  if (hunkAt === "first" && !focusFp) scrollTo({ top: 0 });
}

function step(d: 1 | -1): void {
  const c = view?.commits[current];
  if (!c) return;
  const hs = allHunks(c);
  const i = hs.findIndex((h) => h.fp === focusFp);
  const next = hs[i + d];
  if (next) setFocus(next.fp, true);
  else goCommit(current + d, d === 1 ? "first" : "last");
}

async function approveFile(fp: string): Promise<void> {
  const f = findFile(fp);
  if (!f) return;
  const todo = f.hunks.filter((h) => h.status !== "ok");
  for (const h of todo) {
    // One at a time: the server reads, changes and rewrites state.json per mark, so parallel marks would lose writes.
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential on purpose, see above
    await post("/mark", {
      body: { fp: h.fp, kind: "hunk", mark: "ok", ...(h.was ? { replaces: h.was.fp } : {}) },
    });
  }
  await load();
}

/** A mark button toggles: pressing the mark a target already has clears it. */
async function toggle(fp: string, kind: "hunk" | "file", m: Mark): Promise<void> {
  const t = kind === "hunk" ? findHunk(fp) : findFile(fp);
  const on = t?.status === m || (m === "question" && t?.status === "answered");
  if (kind === "hunk") focusFp = fp;
  await mark(fp, kind, on ? null : m, on ? undefined : t?.note);
}

const CLICKS: [string, (el: HTMLElement) => void][] = [
  ["[data-commit]", (el) => goCommit(Number(el.dataset["commit"] ?? 0))],
  ["[data-fold]", (el) => toggleFold(el.dataset["fold"] ?? "")],
  ["[data-view]", (el) => toggleView(el.dataset["view"] ?? "")],
  [
    "[data-expand]",
    (el) => {
      const key = el.dataset["expand"] ?? "";
      fire(expand(key, el.dataset["anchorFp"] ?? ""));
    },
  ],
  ["[data-fileok]", (el) => fire(approveFile(el.dataset["fileok"] ?? ""))],
  [
    "[data-mark]",
    (el) => {
      const m = asMark(el.dataset["mark"]);
      if (m)
        fire(toggle(el.dataset["fp"] ?? "", el.dataset["kind"] === "file" ? "file" : "hunk", m));
    },
  ],
];

document.addEventListener("click", (e) => {
  if (e.altKey) return; // Alt-click belongs to the feedback widget
  const el = e.target instanceof Element ? e.target : null;
  for (const [sel, act] of CLICKS) {
    const hit = el?.closest<HTMLElement>(sel);
    if (hit) {
      e.preventDefault();
      act(hit);
      return;
    }
  }
  const hunk = el?.closest<HTMLElement>("[data-hunk]");
  if (hunk && !el?.closest("input")) setFocus(hunk.dataset["hunk"]);
});

document.addEventListener("change", (e) => {
  const input = e.target instanceof HTMLInputElement ? e.target : null;
  if (!input?.dataset["note"]) return;
  const kind = input.dataset["kind"] === "file" ? "file" : "hunk";
  const m = asMark(input.dataset["markval"]);
  if (m) fire(mark(input.dataset["note"], kind, m, input.value.trim() || undefined));
});

// ---------- keyboard: everything the mouse does ----------

/** The focused hunk and the file it's in, in the open commit. */
function focused(): { f: FileView; h: Hunk } | undefined {
  const fp = focusFp;
  for (const f of view?.commits[current]?.files ?? []) {
    const h = f.hunks.find((x) => x.fp === fp);
    if (h) return { f, h };
  }
  return undefined;
}

/** Moves to the first hunk of the next (or previous) file, across commits. */
function stepFile(d: 1 | -1): void {
  const c = view?.commits[current];
  if (!c) return;
  const files = c.files.filter((f) => f.hunks.length > 0);
  const at = files.findIndex((f) => f.hunks.some((h) => h.fp === focusFp));
  const next = files[at + d];
  if (next?.hunks[0]) setFocus(next.hunks[0].fp, true);
  else goCommit(current + d, d === 1 ? "first" : "last");
}

function markFocused(m: Mark): void {
  const fp = focusFp;
  if (!fp) return;
  const h = findHunk(fp);
  const on = h?.status === m || (m === "question" && h?.status === "answered");
  fire(
    toggle(fp, "hunk", m).then(() => {
      if (m === "ok" && !on) step(1);
      else if (m !== "ok" && !on) $<HTMLInputElement>(`[data-note="${fp}"]`)?.focus();
    }),
  );
}

/** Key → what it does, and the line the help overlay shows for it. */
const KEYS: [string, string, () => void][] = [
  ["j", "next hunk", () => step(1)],
  ["k", "previous hunk", () => step(-1)],
  ["J", "next file", () => stepFile(1)],
  ["K", "previous file", () => stepFile(-1)],
  ["n", "next commit", () => goCommit(current + 1)],
  ["p", "previous commit", () => goCommit(current - 1)],
  [
    "g",
    "first hunk of the commit",
    () => {
      const h = view?.commits[current]?.files.flatMap((f) => f.hunks)[0];
      if (h) setFocus(h.fp, true);
    },
  ],
  [
    "G",
    "last hunk of the commit",
    () => {
      const h = view?.commits[current]?.files.flatMap((f) => f.hunks).at(-1);
      if (h) setFocus(h.fp, true);
    },
  ],
  ["a", "approve the hunk (moves on)", () => markFocused("ok")],
  ["c", "change this: flag the hunk and write a note", () => markFocused("change")],
  ["q", "question: ask about the hunk", () => markFocused("question")],
  [
    "A",
    "approve every hunk in the file",
    () => {
      const t = focused();
      if (t) fire(approveFile(t.f.fp));
    },
  ],
  [
    "o",
    "fold or unfold the hunk",
    () => {
      if (focusFp) toggleFold(focusFp);
    },
  ],
  [
    "O",
    "fold or unfold the file",
    () => {
      const t = focused();
      if (t) toggleFold(t.f.fp);
    },
  ],
  [
    "[",
    "show more lines above the hunk",
    () => {
      if (focusFp) fire(expand(`${focusFp}:up`, focusFp));
    },
  ],
  [
    "]",
    "show more lines after the file's last hunk",
    () => {
      const t = focused();
      if (t) fire(expand(`${t.f.fp}:down`, t.h.fp));
    },
  ],
  [
    "v",
    "switch a changed hunk between what changed since you saw it and the whole hunk",
    () => {
      if (focusFp) toggleView(focusFp);
    },
  ],
  [
    "i",
    "edit the note on a flagged or questioned hunk",
    () => $<HTMLInputElement>(`[data-note="${focusFp}"]`)?.focus(),
  ],
  ["r", "refresh from git", () => fire(load())],
  ["s", "send the review to the agent", () => fire(send())],
  ["?", "show or hide these keys", () => toggleHelp()],
];

function toggleHelp(): void {
  const help = need("#help");
  if (help.hidden)
    help.innerHTML = `<h3>Keys</h3><table>${KEYS.map(([k, what]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(what)}</td></tr>`).join("")}<tr><td><kbd>Esc</kbd></td><td>leave a note (it saves) or close this</td></tr></table>`;
  help.hidden = !help.hidden;
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement) {
    // Esc and Enter leave the note; its change event saves it.
    if (e.key === "Escape" || e.key === "Enter") e.target.blur();
    return;
  }
  if (e.key === "Escape") {
    need("#help").hidden = true;
    return;
  }
  const hit = KEYS.find(([k]) => k === e.key);
  if (hit) {
    hit[2]();
    e.preventDefault();
  }
});

/** What this page uses of the viz feedback widget (kit feedback.ts declares the whole of it). */
interface Feedback {
  send(extra?: { round?: number }): Promise<void>;
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kit's feedback.ts declares window.vizFeedback in full; this page types only the part it uses
const feedback = (): Feedback | undefined => (window as { vizFeedback?: Feedback }).vizFeedback;

async function send(): Promise<void> {
  const fb = feedback();
  await fb?.send();
  need("#send").textContent = fb ? "Sent ✓" : "Send unavailable";
}

need("#refresh").addEventListener("click", () => fire(load()));
need("#send").addEventListener("click", () => fire(send()));

try {
  await loadHighlighter();
  await load();
} catch (error) {
  showError(error);
}
