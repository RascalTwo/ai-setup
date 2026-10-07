// ---- Rank: pairwise-compare the whole corpus, and approve while you are here ----
// The engine is @rascaltwo/pairwise-sorter (github.com/RascalTwo/pairwise-sorter), served as
// kit/pairwise.js — a generated bundle, see maintainer/sync-kit.ts. Everything below is
// host: fetch the corpus, draw two cards, collect a key or a click, persist after every answer.
//
// Why persist per answer rather than on a timer or at the end: ranking ~250 vizzes is
// ~1,900 comparisons gathered over weeks. Anything that can lose a session's worth of
// judgment to a crash or a closed tab is the wrong trade, and one small POST is cheap.
import { createEngine } from "@viz/kit/pairwise.js";

// Every id this is called with is in index.html.
const $ = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`#${id}`);
  /* c8 ignore next -- every id is fixed by index.html and the tests load it; the throw names the missing one instead of a bare TypeError */
  if (!el) throw new Error(`rank: #${id} is missing from index.html`);
  return el;
};
const $select = (id: string): HTMLSelectElement => {
  const el = $(id);
  /* c8 ignore next -- every id is fixed by index.html and the tests load it; the throw names the missing one instead of a bare TypeError */
  if (!(el instanceof HTMLSelectElement)) throw new Error(`rank: #${id} is not a <select>`);
  return el;
};
// Fire-and-forget for event handlers, which cannot await. A rejection is rethrown on the
// derived promise so it stays an unhandled rejection, exactly as a bare call would be.
const bg = (p: Promise<unknown>): void => {
  p.catch((err: unknown) => {
    /* c8 ignore next -- the rethrow is the point (a rejection must stay unhandled); no test makes a handler reject */
    throw err;
  });
};
// The native dialogs are this tab's whole UI on purpose (see the new-dimension handler), so
// the three calls live here, each behind its one justified lint disable.
const say = (msg: string): void => {
  // oxlint-disable-next-line eslint/no-alert -- deliberate minimal UI: a modal would be more code than the feature
  alert(msg);
};
// oxlint-disable-next-line eslint/no-alert -- deliberate minimal UI: a modal would be more code than the feature
const askText = (msg: string, def?: string): string | null => prompt(msg, def);
// oxlint-disable-next-line eslint/no-alert -- deliberate minimal UI: a modal would be more code than the feature
const sure = (msg: string): boolean => confirm(msg);
const API = "api/ranking";

// The shape of GET api/ranking (rankingView() in lib/library/ranking.ts).
interface RankItem {
  title: string;
  url: string;
  key: string;
  desc: string;
  media: string[];
  tags: string[];
  vizId: string;
  approval: "approved" | "stale" | "never";
}
interface RankList {
  id: string;
  name: string;
  answered: number;
}
interface RankData {
  items: RankItem[];
  current: string;
  lists: RankList[];
  log: [string, number][];
  benched: string[];
  priority: string[];
}
type Verdict = -1 | 0 | 1;
// Spelled out rather than ReturnType<typeof createEngine>: the kit bundle is untyped JS and
// the lint pass sees that type as an error type.
interface Engine {
  toJSON: () => { log: [string, number][]; benched: string[]; priority: string[] };
  answeredCount: () => number;
  live: () => number[];
  budget: () => number;
  run: (
    ask: (a: number, b: number) => Promise<Verdict>,
    hooks: { onRecord: () => void; onProgress: (p: { placed: number[] }) => void },
  ) => Promise<number[]>;
}
// What the POST routes answer: { ok } plus { err } when ok is false.
interface Reply {
  ok: boolean;
  err: string;
}

function toReply(j: unknown): Reply {
  /* c8 ignore next -- api/ranking always replies a JSON object; the fallback only narrows `unknown` */
  const o = typeof j === "object" && j !== null ? j : {};
  return { ok: "ok" in o && Boolean(o.ok), err: "err" in o ? String(o.err) : "" };
}

async function postJSON(url: string, body: object): Promise<Reply> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return toReply(await res.json());
}

async function getRanking(): Promise<RankData> {
  const res = await fetch(API);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the documented shape of GET api/ranking
  return (await res.json()) as RankData;
}

let eng: Engine | null = null,
  items: RankItem[] = [],
  resolveAsk: ((v: Verdict) => void) | null = null,
  booted = false;
// Which dimension we are answering, and a generation counter. Switching dimensions
// abandons the in-flight sort; without the guard its next answer would land in the
// dimension you just switched TO.
let listId: string | null = null,
  gen = 0;

const esc = (s: string) =>
  s.replaceAll(
    /[&<>"]/gu,
    (c) =>
      /* c8 ignore next -- the callback only runs on a match, and the strings this page escapes (ids, dimension names) hold none of & < > " */
      (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c]!,
  );

async function save() {
  const j = eng!.toJSON();
  $("rk-saved").textContent = "saving…";
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list: listId, log: j.log, benched: j.benched, priority: j.priority }),
    });
    $("rk-saved").textContent = r.ok ? "saved" : "SAVE FAILED";
    $("rk-saved").style.color = r.ok ? "var(--good)" : "var(--danger)";
  } catch {
    // Surfaced, never swallowed: if writes are failing the reader must stop answering,
    // because every further comparison is being thrown away.
    $("rk-saved").textContent = "SAVE FAILED — stop and check the server";
    $("rk-saved").style.color = "var(--danger)";
  }
}

function drawCard(el: HTMLElement, it: RankItem) {
  // 42 of 251 vizzes have no OG card. Without a placeholder the image slot collapses and
  // the two cards stop being the same shape, which makes a visual comparison unfair.
  const art = it.media?.[0]
    ? // eager, not lazy: there are only ever two images on screen and they ARE the
      // comparison. Lazy meant a card below the fold showed nothing until scrolled to.
      `<img src="${esc(it.media[0])}" alt="" loading="eager" decoding="sync">`
    : `<div class="rk-noart">no preview card</div>`;
  // .swatch is a KIT class and this page does not load the kit — it rendered as bare
  // overlapping text. .tag-chip is this page's own idiom.
  const chips = it.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join("");
  const label = { approved: "✓ approved", stale: "⚠ changed since approval", never: "approve" }[
    it.approval
  ];
  return (el.innerHTML =
    art +
    `<div class="rk-t">${esc(it.title)}</div>` +
    `<div class="rk-d">${esc(it.desc || "")}</div>` +
    `<div class="rk-meta">${chips}` +
    `<button class="rk-tri ${it.approval === "approved" ? "on" : ""} ${it.approval === "stale" ? "stale" : ""}" ` +
    `data-viz="${esc(it.vizId)}" title="${it.approval === "stale" ? "Approved, then edited — re-approve this version" : ""}">` +
    `${label}</button>` +
    // You cannot judge a viz from a title and a blurb — opening it is the point. Must be
    // target=_blank: navigating away would abandon the in-flight sort.
    `<a class="rk-open" href="/${esc(it.vizId)}/" target="_blank" rel="noopener" title="Open this viz in a new tab">open ↗</a>` +
    `</div>`);
}

// Approval rides along: you are already looking hard at this viz to rank it, which is
// exactly the judgment ADR 0013's gate asks for. One pass, both jobs. Approving stamps a
// hash of the CURRENT content (ADR 0015), so a later edit revokes it automatically.
async function markApproved(vizId: string, btn: HTMLButtonElement) {
  btn.disabled = true;
  const r = await postJSON("api/update", { id: vizId, approved: "true" }).catch((): Reply => ({
    /* c8 ignore next 2 -- the fallback reply for a network failure of the approve POST, which no test makes fail */
    ok: false,
    err: "",
  }));
  btn.disabled = false;
  if (!r.ok) {
    btn.textContent = "failed";
    return;
  }
  btn.classList.add("on");
  btn.classList.remove("stale");
  btn.textContent = "✓ approved";
  for (const it of items) if (it.vizId === vizId) it.approval = "approved";
}

function stats(placed: number) {
  $("rk-answered").textContent = String(eng!.answeredCount());
  $("rk-total").textContent = String(eng!.live().length);
  $("rk-placed").textContent = String(placed);
  $("rk-budget").textContent = String(Math.max(0, eng!.budget() - eng!.answeredCount()));
}

async function ask(a: number, b: number): Promise<Verdict> {
  drawCard($("rk-a"), items[a]!);
  drawCard($("rk-b"), items[b]!);
  const verdict = await new Promise<Verdict>((res) => {
    resolveAsk = res;
  });
  return verdict;
}

function answer(v: Verdict) {
  if (!resolveAsk) return;
  const r = resolveAsk;
  resolveAsk = null;
  // NO save() here. The engine appends to the log after this promise resolves, so a
  // save on this line always persisted the PREVIOUS state — and the last answer of a
  // session was never written at all. onRecord fires after the append; save there.
  r(v);
}

function drawLists(data: RankData) {
  $("rk-list").innerHTML = data.lists
    .map(
      (l) =>
        `<option value="${esc(l.id)}" ${l.id === data.current ? "selected" : ""}>${esc(l.name)} (${l.answered})</option>`,
    )
    .join("");
  // The question follows the dimension. "Which wins on X" is the one phrasing that stays
  // grammatical whatever the name is — "Best", "Most reusable", "Best for a client demo".
  // rankingView() always answers with a `current` that is one of its lists.
  const cur = data.lists.find((l) => l.id === data.current)!;
  $("rk-question").textContent = `Which of these two wins on “${cur.name}”?`;
  $("rk-dimhint").textContent =
    data.lists.length > 1
      ? `${data.lists.length} dimensions — each keeps its own answers`
      : "add a dimension to rank the same vizzes on something else";
}

// `force` restarts a running sort (a list switch, a rename); opening the tab only boots once.
async function boot(force?: boolean) {
  if (booted && !force) return;
  booted = true;
  const myGen = ++gen; // everything below belongs to this run
  let data: RankData;
  try {
    data = await getRanking();
  }
  // Not booted after all: opening the tab again, once the server is back, retries.
  catch {
    $("rank-boot").textContent = "The local server is not reachable — Rank needs it.";
    booted = false;
    return;
  }
  if (myGen !== gen) return;

  items = data.items;
  listId = data.current;
  drawLists(data);
  eng = createEngine({ items, log: data.log, benched: data.benched, priority: data.priority });

  $("rank-boot").hidden = true;
  $("rank-main").hidden = false;
  $("rank-pair").hidden = false;
  $("rank-done").hidden = true;
  $("rk-saved").textContent =
    data.log.length > 0 ? `resumed · ${data.log.length} answered` : "ready";

  const order = await eng.run(ask, {
    // Count on RECORD, not only on placement: onProgress fires once per item placed,
    // so the answered counter sat several comparisons behind and disagreed with disk.
    onRecord: () => {
      if (myGen !== gen) return;
      $("rk-answered").textContent = String(eng!.answeredCount());
      bg(save());
    },
    onProgress: ({ placed }: { placed: number[] }) => {
      if (myGen !== gen) return;
      stats(placed.length);
      $("rk-order").innerHTML = placed.map((i) => `<li>${esc(items[i]!.title)}</li>`).join("");
    },
  });

  if (myGen !== gen) return;
  $("rank-pair").hidden = true;
  $("rank-done").hidden = false;
  $("rank-done").innerHTML =
    `<b>Done — ${order.length} ranked.</b> The full order is below and in ` +
    `<code>rankings.json</code>.`;
  $("rk-order").innerHTML = order.map((i: number) => `<li>${esc(items[i]!.title)}</li>`).join("");
  stats(order.length);
  // budget() is an upper bound, so a finished sort usually came in under it: nothing is left.
  $("rk-budget").textContent = "0";
}

// Clicking a card picks it; the arrow keys do the same without moving your hand.
// The card IS the vote button, so anything interactive inside it must opt out or a click
// on "approve" / "open" would silently also cast a vote.
const inert = (e: MouseEvent) =>
  e.target instanceof Element && e.target.closest(".rk-tri, .rk-open");
$("rk-a").addEventListener("click", (e) => {
  if (!inert(e)) answer(-1);
});
$("rk-b").addEventListener("click", (e) => {
  if (!inert(e)) answer(1);
});
$("rank-pair").addEventListener("click", (e) => {
  /* c8 ignore next -- a delegated listener's target on this page is always an Element; the check only narrows EventTarget for the type checker */
  const t = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".rk-tri") : null;
  if (t) {
    e.stopPropagation();
    bg(markApproved(t.dataset["viz"]!, t));
  }
});
$("rk-eq").addEventListener("click", () => answer(0));
$("rk-skip").addEventListener("click", () => answer(0));

addEventListener("keydown", (e) => {
  if (!document.querySelector("#tab-rank")!.classList.contains("active")) return;
  // e.target can be window/document (a synthetic dispatch, or a key with nothing focused),
  // and those have no .matches — guard on the method, not on the node being truthy.
  /* c8 ignore next -- no text field takes keys while Rank shows: the Library's search hides with its tab, and the feedback widget stops its own keys. Kept for the first one that does. */
  if (e.target instanceof Element && e.target.matches("input, textarea")) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    answer(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    answer(1);
  } else if (e.key === "=") {
    e.preventDefault();
    answer(0);
  } else if (e.key === "t") {
    e.preventDefault();
    for (const btn of document.querySelectorAll<HTMLButtonElement>("#rank-pair .rk-tri:not(.on)"))
      bg(markApproved(btn.dataset["viz"]!, btn));
  }
});

async function selectDim() {
  await postJSON(API, { action: "select", list: $select("rk-list").value });
  bg(boot(true)); // ++gen orphans the previous sort
}
$("rk-list").addEventListener("change", () => {
  bg(selectDim());
});

async function newDim() {
  // A prompt() is the whole UI here on purpose: naming a dimension is a two-second
  // act you do a handful of times, and a modal would be more code than the feature.
  const name = askText(
    "Rank these vizzes on what?\n\ne.g. Best · Most reusable · Best for a client demo",
  );
  if (!name || !name.trim()) return;
  const r = await postJSON(API, { action: "new", name: name.trim() });
  if (!r.ok) {
    say(r.err);
    return;
  }
  bg(boot(true));
}
$("rk-newdim").addEventListener("click", () => {
  bg(newDim());
});

// Deleted from another window since this one drew its picker. Say so and redraw, rather than
// ask about a dimension that no longer exists (a delete asked about "undefined").
function gone() {
  say("That dimension no longer exists — it was deleted in another window. Showing what is left.");
  bg(boot(true));
}

async function renameDim() {
  const id = $select("rk-list").value;
  const data = await getRanking();
  const meta = data.lists.find((l) => l.id === id);
  if (!meta) {
    gone();
    return;
  }
  const name = askText("Rename this dimension to what?", meta.name);
  if (name === null || !name.trim() || name.trim() === meta.name) return;
  const r = await postJSON(API, { action: "rename", list: id, name: name.trim() });
  if (!r.ok) {
    say(r.err);
    return;
  }
  bg(boot(true)); // answers are untouched — only the label moved
}
$("rk-renamedim").addEventListener("click", () => {
  bg(renameDim());
});

async function deleteDim() {
  const data = await getRanking();
  const meta = data.lists.find((l) => l.id === $select("rk-list").value);
  if (!meta) {
    gone();
    return;
  }
  // Name the cost before asking. Deleting "Best (0)" and deleting "Best (1,412)" are
  // very different acts and the button looks identical for both.
  const n = meta.answered;
  const msg = n
    ? `Delete "${meta.name}" and its ${n} answer${n === 1 ? "" : "s"}?\n\n` +
      `That judgment is not recoverable from the UI. rankings.json is git-tracked in the ` +
      `central library, so \`git checkout\` there can still bring it back.`
    : `Delete "${meta.name}"? It has no answers yet.`;
  if (!sure(msg)) return;
  const r = await postJSON(API, { action: "delete", list: $select("rk-list").value });
  if (!r.ok) {
    say(r.err);
    return;
  }
  bg(boot(true));
}
$("rk-deldim").addEventListener("click", () => {
  bg(deleteDim());
});

// Boot lazily — the corpus read walks every container, so don't pay for it on a
// visit that never opens this tab.
//
// Trigger on the tab's ACTIVE CLASS, not on location.hash: the page's own router
// normalises the hash during parse, before this module evaluates, so a hash test here
// silently missed a direct #rank load every time.
document.querySelector("#tabbtn-rank")!.addEventListener("click", () => {
  bg(boot());
}); // not `boot`: the click event would be a truthy `force`
addEventListener("hashchange", () => {
  if (document.querySelector("#tab-rank")!.classList.contains("active")) bg(boot());
});
if (document.querySelector("#tab-rank")!.classList.contains("active")) bg(boot());
