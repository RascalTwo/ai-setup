// ---- Rank: pairwise-compare the whole corpus, and approve while you are here ----
// The engine is @rascaltwo/pairwise-sorter (github.com/RascalTwo/pairwise-sorter), served as
// kit/pairwise.js — a generated bundle, see maintainer/sync-kit.ts. Everything below is
// host: fetch the corpus, draw two cards, collect a key or a click, persist after every answer.
//
// Why persist per answer rather than on a timer or at the end: ranking ~250 vizzes is
// ~1,900 comparisons gathered over weeks. Anything that can lose a session's worth of
// judgment to a crash or a closed tab is the wrong trade, and one small POST is cheap.
import { createEngine } from '/_kit/pairwise.js';

// Every id this is called with is in index.html.
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const API = 'api/ranking';

// The shape of GET api/ranking (rankingView() in lib/library/ranking.ts).
interface RankItem {
  title: string; url: string; key: string; desc: string; media: string[]; tags: string[];
  vizId: string; approval: 'approved' | 'stale' | 'never';
}
interface RankList { id: string; name: string; answered: number }
interface RankData {
  items: RankItem[]; current: string; lists: RankList[];
  log: [string, number][]; benched: string[]; priority: string[];
}
type Engine = ReturnType<typeof createEngine>;
type Verdict = -1 | 0 | 1;

let eng: Engine | null = null, items: RankItem[] = [], resolveAsk: ((v: Verdict) => void) | null = null, booted = false;
// Which dimension we are answering, and a generation counter. Switching dimensions
// abandons the in-flight sort; without the guard its next answer would land in the
// dimension you just switched TO.
let listId: string | null = null, gen = 0;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' } as Record<string, string>)[c]!);

async function save() {
  const j = eng!.toJSON();
  $('rk-saved').textContent = 'saving…';
  try {
    const r = await fetch(API, { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ list: listId, log: j.log, benched: j.benched, priority: j.priority }) });
    $('rk-saved').textContent = r.ok ? 'saved' : 'SAVE FAILED';
    $('rk-saved').style.color = r.ok ? 'var(--good)' : 'var(--danger)';
  } catch {
    // Surfaced, never swallowed: if writes are failing the reader must stop answering,
    // because every further comparison is being thrown away.
    $('rk-saved').textContent = 'SAVE FAILED — stop and check the server';
    $('rk-saved').style.color = 'var(--danger)';
  }
}

function drawCard(el: HTMLElement, it: RankItem) {
  // 42 of 251 vizzes have no OG card. Without a placeholder the image slot collapses and
  // the two cards stop being the same shape, which makes a visual comparison unfair.
  const art = it.media?.[0]
    // eager, not lazy: there are only ever two images on screen and they ARE the
    // comparison. Lazy meant a card below the fold showed nothing until scrolled to.
    ? `<img src="${esc(it.media[0])}" alt="" loading="eager" decoding="sync">`
    : `<div class="rk-noart">no preview card</div>`;
  // .swatch is a KIT class and this page does not load the kit — it rendered as bare
  // overlapping text. .tag-chip is this page's own idiom.
  const chips = it.tags.map(t => `<span class="tag-chip">${esc(t)}</span>`).join('');
  const label = { approved: '✓ approved', stale: '⚠ changed since approval', never: 'approve' }[it.approval];
  return (el.innerHTML =
    art +
    `<div class="rk-t">${esc(it.title)}</div>` +
    `<div class="rk-d">${esc(it.desc || '')}</div>` +
    `<div class="rk-meta">${chips}` +
      `<button class="rk-tri ${it.approval === 'approved' ? 'on' : ''} ${it.approval === 'stale' ? 'stale' : ''}" `
      + `data-viz="${esc(it.vizId)}" title="${it.approval === 'stale' ? 'Approved, then edited — re-approve this version' : ''}">`
      + `${label}</button>`
      // You cannot judge a viz from a title and a blurb — opening it is the point. Must be
      // target=_blank: navigating away would abandon the in-flight sort.
      + `<a class="rk-open" href="/${esc(it.vizId)}/" target="_blank" rel="noopener" title="Open this viz in a new tab">open ↗</a>`
    + `</div>`);
}

// Approval rides along: you are already looking hard at this viz to rank it, which is
// exactly the judgment ADR 0013's gate asks for. One pass, both jobs. Approving stamps a
// hash of the CURRENT content (ADR 0015), so a later edit revokes it automatically.
async function markApproved(vizId: string, btn: HTMLButtonElement) {
  btn.disabled = true;
  const r: { ok: boolean } = await fetch('api/update', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ id: vizId, approved: 'true' }) }).then(r => r.json()).catch(() => ({ ok:false }));
  btn.disabled = false;
  if (!r.ok) { btn.textContent = 'failed'; return; }
  btn.classList.add('on'); btn.classList.remove('stale'); btn.textContent = '✓ approved';
  for (const it of items) if (it.vizId === vizId) it.approval = 'approved';
}

function stats(placed: number) {
  $('rk-answered').textContent = String(eng!.answeredCount());
  $('rk-total').textContent = String(eng!.live().length);
  $('rk-placed').textContent = String(placed);
  $('rk-budget').textContent = String(Math.max(0, eng!.budget() - eng!.answeredCount()));
}

function ask(a: number, b: number) {
  drawCard($('rk-a'), items[a]!);
  drawCard($('rk-b'), items[b]!);
  return new Promise<Verdict>((res) => { resolveAsk = res; });
}

function answer(v: Verdict) {
  if (!resolveAsk) return;
  const r = resolveAsk; resolveAsk = null;
  // NO save() here. The engine appends to the log after this promise resolves, so a
  // save on this line always persisted the PREVIOUS state — and the last answer of a
  // session was never written at all. onRecord fires after the append; save there.
  r(v);
}

function drawLists(data: RankData) {
  $('rk-list').innerHTML = data.lists
    .map(l => `<option value="${esc(l.id)}" ${l.id === data.current ? 'selected' : ''}>${esc(l.name)} (${l.answered})</option>`)
    .join('');
  // The question follows the dimension. "Which wins on X" is the one phrasing that stays
  // grammatical whatever the name is — "Best", "Most reusable", "Best for a client demo".
  // rankingView() always answers with a `current` that is one of its lists.
  const cur = data.lists.find(l => l.id === data.current)!;
  $('rk-question').textContent = `Which of these two wins on “${cur.name}”?`;
  $('rk-dimhint').textContent = data.lists.length > 1
    ? `${data.lists.length} dimensions — each keeps its own answers`
    : 'add a dimension to rank the same vizzes on something else';
}

// `force` restarts a running sort (a list switch, a rename); opening the tab only boots once.
async function boot(force?: boolean) {
  if (booted && !force) return; booted = true;
  const myGen = ++gen;                        // everything below belongs to this run
  let data: RankData;
  try { data = await fetch(API).then(r => r.json()); }
  // Not booted after all: opening the tab again, once the server is back, retries.
  catch { $('rank-boot').textContent = 'The local server is not reachable — Rank needs it.'; booted = false; return; }
  if (myGen !== gen) return;

  items = data.items;
  listId = data.current;
  drawLists(data);
  eng = createEngine({ items, log: data.log, benched: data.benched, priority: data.priority });

  $('rank-boot').hidden = true;
  $('rank-main').hidden = false;
  $('rank-pair').hidden = false;
  $('rank-done').hidden = true;
  $('rk-saved').textContent = data.log.length ? `resumed · ${data.log.length} answered` : 'ready';

  const order = await eng.run(ask, {
    // Count on RECORD, not only on placement: onProgress fires once per item placed,
    // so the answered counter sat several comparisons behind and disagreed with disk.
    onRecord: () => { if (myGen !== gen) return; $('rk-answered').textContent = String(eng!.answeredCount()); save(); },
    onProgress: ({ placed }: { placed: number[] }) => {
      if (myGen !== gen) return;
      stats(placed.length);
      $('rk-order').innerHTML = placed.map((i) => `<li>${esc(items[i]!.title)}</li>`).join('');
    },
  });

  if (myGen !== gen) return;
  $('rank-pair').hidden = true;
  $('rank-done').hidden = false;
  $('rank-done').innerHTML = `<b>Done — ${order.length} ranked.</b> The full order is below and in ` +
    `<code>rankings.json</code>.`;
  $('rk-order').innerHTML = order.map((i: number) => `<li>${esc(items[i]!.title)}</li>`).join('');
  stats(order.length);
  // budget() is an upper bound, so a finished sort usually came in under it: nothing is left.
  $('rk-budget').textContent = '0';
}

// Clicking a card picks it; the arrow keys do the same without moving your hand.
// The card IS the vote button, so anything interactive inside it must opt out or a click
// on "approve" / "open" would silently also cast a vote.
const inert = (e: MouseEvent) => (e.target as Element).closest('.rk-tri, .rk-open');
$('rk-a').addEventListener('click', (e) => { if (!inert(e)) answer(-1); });
$('rk-b').addEventListener('click', (e) => { if (!inert(e)) answer(1); });
$('rank-pair').addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLButtonElement>('.rk-tri');
  if (t) { e.stopPropagation(); markApproved(t.dataset['viz']!, t); }
});
$('rk-eq').addEventListener('click', () => answer(0));
$('rk-skip').addEventListener('click', () => answer(0));

addEventListener('keydown', (e) => {
  if (!document.getElementById('tab-rank')!.classList.contains('active')) return;
  // e.target can be window/document (a synthetic dispatch, or a key with nothing focused),
  // and those have no .matches — guard on the method, not on the node being truthy.
  /* c8 ignore next -- no text field takes keys while Rank shows: the Library's search hides with its tab, and the feedback widget stops its own keys. Kept for the first one that does. */
  if ((e.target as Element | null)?.matches?.('input, textarea')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); answer(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); answer(1); }
  else if (e.key === '=') { e.preventDefault(); answer(0); }
  else if (e.key === 't') {
    e.preventDefault();
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#rank-pair .rk-tri:not(.on)')) markApproved(btn.dataset['viz']!, btn);
  }
});

$('rk-list').addEventListener('change', async (e) => {
  await fetch(API, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ action:'select', list: (e.target as HTMLSelectElement).value }) });
  boot(true);                                  // ++gen orphans the previous sort
});

$('rk-newdim').addEventListener('click', async () => {
  // A prompt() is the whole UI here on purpose: naming a dimension is a two-second
  // act you do a handful of times, and a modal would be more code than the feature.
  const name = prompt('Rank these vizzes on what?\n\ne.g. Best · Most reusable · Best for a client demo');
  if (!name || !name.trim()) return;
  const r: { ok: boolean; err: string } = await fetch(API, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ action:'new', name: name.trim() }) }).then(r => r.json());
  if (!r.ok) { alert(r.err); return; }
  boot(true);
});

// Deleted from another window since this one drew its picker. Say so and redraw, rather than
// ask about a dimension that no longer exists (a delete asked about "undefined").
function gone() {
  alert('That dimension no longer exists — it was deleted in another window. Showing what is left.');
  boot(true);
}

$('rk-renamedim').addEventListener('click', async () => {
  const id = $<HTMLSelectElement>('rk-list').value;
  const data: RankData = await fetch(API).then(r => r.json());
  const meta = data.lists.find(l => l.id === id);
  if (!meta) return gone();
  const name = prompt('Rename this dimension to what?', meta.name);
  if (name === null || !name.trim() || name.trim() === meta.name) return;
  const r: { ok: boolean; err: string } = await fetch(API, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ action:'rename', list: id, name: name.trim() }) }).then(r => r.json());
  if (!r.ok) { alert(r.err); return; }
  boot(true);   // answers are untouched — only the label moved
});

$('rk-deldim').addEventListener('click', async () => {
  const data: RankData = await fetch(API).then(r => r.json());
  const meta = data.lists.find(l => l.id === $<HTMLSelectElement>('rk-list').value);
  if (!meta) return gone();
  // Name the cost before asking. Deleting "Best (0)" and deleting "Best (1,412)" are
  // very different acts and the button looks identical for both.
  const n = meta.answered;
  const msg = n
    ? `Delete "${meta.name}" and its ${n} answer${n === 1 ? '' : 's'}?\n\n`
      + `That judgment is not recoverable from the UI. rankings.json is git-tracked in the `
      + `central library, so \`git checkout\` there can still bring it back.`
    : `Delete "${meta.name}"? It has no answers yet.`;
  if (!confirm(msg)) return;
  const r: { ok: boolean; err: string } = await fetch(API, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ action:'delete', list: $<HTMLSelectElement>('rk-list').value }) }).then(r => r.json());
  if (!r.ok) { alert(r.err); return; }
  boot(true);
});

// Boot lazily — the corpus read walks every container, so don't pay for it on a
// visit that never opens this tab.
//
// Trigger on the tab's ACTIVE CLASS, not on location.hash: the page's own router
// normalises the hash during parse, before this module evaluates, so a hash test here
// silently missed a direct #rank load every time.
document.getElementById('tabbtn-rank')!.addEventListener('click', () => boot()); // not `boot`: the click event would be a truthy `force`
addEventListener('hashchange', () => {
  if (document.getElementById('tab-rank')!.classList.contains('active')) boot();
});
if (document.getElementById('tab-rank')!.classList.contains('active')) boot();
