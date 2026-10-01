// A module (served with a source map, so verify measures it). What other scripts use is put on
// window explicitly below: showTab (inline onclick handlers), __initialHash, and the guide:shown event.
export {};
declare global {
  interface Window {
    showTab(name: string, stop?: string | null): void;
    /** location.hash as the page was opened, before anything rewrote it. */
    __initialHash: string;
    /** Stamped by viz publish on a static copy. */
    __VIZ_STATIC__?: boolean;
  }
  interface WindowEventMap { 'guide:shown': CustomEvent<{ stop: string | null | undefined }> }
}

// The shapes of this viz's own api/ routes (api.ts). Every field api/slugs always sends is
// required here, so the page doesn't guard against its absence.
type CardState = 'public' | 'not-public' | 'unreviewed' | 'stale';
interface Slug {
  id: string; name: string; isCentral: boolean; container: string;
  mirroredIn: boolean; isMirror: boolean; isVendored: boolean; mirrorFrom?: string;
  mirrorsOut: string[]; vendoredOut: string[]; originId?: string; host: string | null;
  fileCount: number; hasApi: boolean; posture: 'public' | 'private' | 'local' | 'untagged'; listed: boolean;
  approval: 'approved' | 'stale' | 'never'; title: string; description: string; tags: string[];
  hidden: boolean; linkedFrom: string[]; uid: string; cardPublic: CardState; cardWas: string;
  lobby: boolean; kind: string; template: string; mtime: number; created: number;
  sizeBytes: number; og: string | null; hero: boolean;
}
interface ServerInfo { bunVersion: string; pid: number; uptimeSec: number; port: number; containers: number; vizVersion?: string }
interface Commit { hash: string; subject: string; when: string }
interface Lobby { passphrase: string; hash: string; shims: string[] }
interface RenderJob { id: string; state: string; frame: number; frames: number; warnings?: string[]; out?: string; error?: string; log?: string }
interface Mirror { to: string; access: string; listed: boolean; overrides?: { title?: string; description?: string; tags?: string[] } }
/** What every POST to api/ answers (see mgmt()). `out` is the CLI's stdout. */
type Mgmt = { url?: string; lobby?: Lobby | null; shares?: string[]; job?: RenderJob; id?: string }
  & ({ ok: true; out: string; err?: string } | { ok: false; err: string; out?: string });

// ---- tab shell: Guide / Dashboard ----
// README and Quick Start collapsed into the Guide's first two bands. Their
// old hashes still resolve — #quickstart lands on the band that replaced it,
// so links published before the rebuild don't 404 into an empty page.
const TABS = ['guide', 'dashboard', 'rank'];
const HASH_ALIAS: Record<string, [string, string | null]> = { readme: ['guide', null], quickstart: ['guide', 'install'] };

// The hash exactly as the page was opened with, captured before anything
// rewrites it. Both the guide's "&stop=" deep link and the Dashboard's
// "&posture=…" filter state live in the tail, and this classic script runs
// BEFORE any module — so without snapshotting here, showTab() below would
// strip the tail and every deep link would silently degrade to defaults.
window.__initialHash = location.hash;

function showTab(name: string, stop?: string | null) { // name: one of TABS — every caller passes one
  for (const t of TABS) {
    document.getElementById('tab-' + t)!.classList.toggle('active', t === name);
    document.getElementById('tabbtn-' + t)!.classList.toggle('active', t === name);
  }
  try { localStorage.setItem('viz-sp-seen', '1'); } catch (e) {}
  // Rewrite the hash only when the TAB actually changes. Comparing against
  // the whole hash meant arriving at "#dashboard&posture=local" instantly
  // rewrote it to "#dashboard", destroying the state before the Dashboard
  // could restore from it.
  const curTab = location.hash.replace('#', '').split('&')[0];
  if (curTab !== name) history.replaceState(null, '', '#' + name);
  if (name === 'guide') {
    // the rail measures document geometry, which is only real once visible
    window.dispatchEvent(new CustomEvent('guide:shown', { detail: { stop } }));
  }
  if (!stop) window.scrollTo(0, 0);
}
window.showTab = showTab;

function routeHash() {
  const h = location.hash.replace('#', '').split('&')[0]!;
  if (TABS.includes(h)) {
    showTab(h);
    // Re-apply any filter tail that came with it — unless the Dashboard never booted (the
    // api isn't live), when there is nothing to filter.
    if (h === 'dashboard' && filtersReady) {
      restoreFilters(location.hash);
      renderSlugs(lastSlugs);
    }
    return;
  }
  if (HASH_ALIAS[h]) return showTab(...HASH_ALIAS[h]);
}
window.addEventListener('hashchange', routeHash);

(function initTab() {
  const h = location.hash.replace('#', '').split('&')[0]!;
  let seen = false;
  try { seen = !!localStorage.getItem('viz-sp-seen'); } catch (e) {}
  if (TABS.includes(h)) return showTab(h);
  if (HASH_ALIAS[h]) {
    // Resolved to the canonical hash, as if the page had been opened by it: the guide boots
    // later, and reads its stop from __initialHash (guide:shown fires before it listens).
    const [tab, stop] = HASH_ALIAS[h];
    history.replaceState(null, '', window.__initialHash = '#' + tab + (stop ? '&stop=' + stop : ''));
    return showTab(tab, stop);
  }
  // first-timers land on the Guide, returning visitors on the Dashboard
  showTab(seen ? 'dashboard' : 'guide');
})();

function fmtUptime(s: number) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
function fmtSize(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(2) + ' MB';
}
// Compact two-unit relative age: "now", "12m", "5h 12m", "1d 5h", "3mo".
function fmtAgo(ms: number | undefined) {
  if (!ms) return '—';
  const m = (Date.now() - ms) / 60000, h = m / 60, d = h / 24;
  if (m < 1) return 'now';
  if (m < 60) return `${Math.floor(m)}m`;
  if (h < 24) { const H = Math.floor(h), M = Math.floor(m - H * 60); return M ? `${H}h ${M}m` : `${H}h`; }
  if (d < 30) { const D = Math.floor(d), H = Math.floor(h - D * 24); return H ? `${D}d ${H}h` : `${D}d`; }
  return `${Math.floor(d / 30)}mo`;
}

const ICONS = {
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  commit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  zapOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="12.41 6.75 13 2 10.57 4.92"/><polyline points="18.57 12.91 21 10 15.66 10"/><polyline points="8 8 3 14 12 14 11 22 16 16"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  hdd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
};

// Render the per-viz axis badges (posture · listed) read live from <head>.
const POSTURE_ICON: Record<string, keyof typeof ICONS> = { public: 'globe', private: 'lock', local: 'home', untagged: 'alert' };
function axisBadges(s: Slug) {
  const p = s.posture;
  const parts = [
    `<span class="axis ${p}" title="posture: ${p} — ${p==='public'?'hosted as-is':p==='private'?'sealed, magic-link only':p==='local'?'never published':'no viz:posture — publish would refuse'}">${ICONS[POSTURE_ICON[p]!]}${p}</span>`,
  ];
  if (s.linkedFrom.length)
    parts.push(`<span class="axis linked" title="linked from: ${esc(s.linkedFrom.join(' · '))} — move, delete and posture changes refuse (ADR 0016)">🔗 linked</span>`);
  if (s.cardPublic === 'public')
    parts.push(`<span class="axis linked" title="card public — a public build with --base-url emits an unfurlable /share/${esc(s.name)}/ page (ADR 0018)">🪪 card public</span>`);
  else if (s.cardPublic === 'not-public')
    parts.push(`<span class="axis kind" title="card reviewed and deliberately NOT public — no share page (ADR 0018)">🪪 card not public</span>`);
  else if (s.cardPublic === 'stale')
    parts.push(`<span class="axis unlisted" title="card changed (slug, title, description or hero) since it was reviewed as ${esc(s.cardWas.replace('-', ' '))} — no share page until re-reviewed">🪪 card stale (was ${esc(s.cardWas.replace('-', ' '))})</span>`);
  if (s.listed === false)
    parts.push(`<span class="axis unlisted" title="unlisted — built &amp; reachable by URL, but off the lobby">unlisted</span>`);
  // Kind — badge ONLY when there is one. 166 of 235 vizzes are plain
  // pages, so a "page" pill on every row is noise, not information. The
  // generated lobby makes the same call; the axis is still *filterable* to
  // `page` from the control above, which is where the absent case belongs.
  if (s.template)
    parts.push(`<span class="axis kind"${s.mirroredIn ? '' : ' data-act="from-open"'} title="viz:template = ${s.template} — a template: \`viz create <slug> --from ${esc(s.name)}\` starts a new ${s.template} from it.${s.mirroredIn ? '' : ' Click: new from this.'}">${s.template.replace('-', ' ')} template</span>`);
  else if (s.kind)
    parts.push(`<span class="axis kind" title="viz:page-kind = ${s.kind} — the kind of template this page was made from. A structural fact, never edited afterwards.">${s.kind.replace('-', ' ')}</span>`);
  return `<span class="slug-axes">${parts.join('')}</span>`;
}
// Tag chips: show up to 3 inline; the rest collapse into a +N that lists all on hover.
function tagChips(s: Slug) {
  const tags = s.tags;
  if (!tags.length) return '';
  const shown = tags.slice(0, 3).map(t => `<span class="tag-chip" title="tag">${esc(t)}</span>`).join('');
  const extra = tags.length > 3
    ? `<span class="tag-chip more" title="${esc(tags.join(', '))}">+${tags.length - 3}</span>` : '';
  return `<span class="slug-tags">${shown}${extra}</span>`;
}
function esc(s: unknown) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string, string>)[c]!);
}

// ---- Native search -----------------------------------------------------
// The list re-renders every 5s, which wipes the browser's own Ctrl+F
// highlights. This filter is re-applied on EVERY render from the live input
// value, so matches + highlights persist across the auto-refresh. It matches
// title (name) and path (id); space-separated terms are AND-ed.
function currentTerms() {
  const q = (document.getElementById('slug-search') as HTMLInputElement).value.trim().toLowerCase();
  return q ? q.split(/\s+/) : [];
}
function matchTerms(s: Slug, terms: string[]) {
  if (!terms.length) return true;
  const hay = (s.name + ' ' + s.id + ' ' + s.title + ' ' + s.tags.join(' ')).toLowerCase();
  return terms.every(t => hay.includes(t));
}
// Escape `text`, wrapping any term occurrences in <mark>. Works on raw text
// (merging overlapping ranges) and escapes each segment, so highlights never
// break HTML.
function hl(text: unknown, terms: string[]) {
  text = String(text);
  if (!terms.length) return esc(text);
  const str = text as string;
  const lower = str.toLowerCase();
  const ranges: [number, number][] = [];
  for (const t of terms) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length))
      ranges.push([i, i + t.length]);
  }
  if (!ranges.length) return esc(str);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let out = '', pos = 0;
  for (const [start, end] of merged) {
    out += esc(str.slice(pos, start)) + '<mark>' + esc(str.slice(start, end)) + '</mark>';
    pos = end;
  }
  return out + esc(str.slice(pos));
}

// ?hide= / ?hideSlug= / ?hideCommits= — match against id substrings now.
function parseHidden() {
  const params = new URLSearchParams(location.search);
  const split = (s: string | null) => (s || '').split(',').map(x => x.trim()).filter(Boolean);
  const both = split(params.get('hide'));
  const slugOnly = split(params.get('hideSlug'));
  const commitOnly = split(params.get('hideCommits'));
  return {
    slugs: [...both, ...slugOnly],
    commits: [...both, ...commitOnly],
  };
}
const matchesAny = (hay: string, needles: string[]) => needles.some(n => hay.includes(n));

function commitSlug(subject: string) {
  const create = subject.match(/^create viz:\s*(\S+)/);
  if (create) return create[1]!;
  const prefixed = subject.match(/^([a-z0-9][a-z0-9-]*):/);
  return prefixed ? prefixed[1]! : null;
}

// ---- Merge model -------------------------------------------------------
// gitFeed is the SLOW map (id -> {commitCount}); it arrives
// once on load and again after a rescan. The 5s fast loop NEVER touches it.
// Rows render the commit col as "—" until the matching id appears here.
let gitFeed: Record<string, { commitCount: number }> = {};       // { [id]: { commitCount } }
let gitLoaded = false;  // have we ever resolved api/slugs-git?
let lastSlugs: Slug[] = [];     // last fast-feed snapshot, for re-render after git lands
// renderSlugs() rebuilds the stat band, which now OWNS the uptime/containers
// readouts. renderServer() runs first on every 5s poll, so without keeping the
// last payload here its values were wiped a moment after being written.
let lastServerInfo: ServerInfo | null = null;
let openDrawerId: string | null = null;// which row's management drawer is expanded (ADR 0009)
let confirmKey: string | null = null;  // destructive button armed for its 2nd (confirming) click

function gitFor(id: string) {
  return gitLoaded ? (gitFeed[id] ?? null) : null;
}

async function loadGit() {
  try {
    gitFeed = await fetch('api/slugs-git').then(r => r.json());
    gitLoaded = true;
    document.getElementById('git-status')!.textContent = '';
    renderSlugs(lastSlugs);
  } catch (e) {
    console.error('loadGit failed:', e);
  }
}

// Scope filter options = one per container (place). Label central as its own path,
// externals by their host repo path. Rebuilt only when the container set changes so
// it never clobbers the current selection or an open dropdown on the 5s poll.
let scopeSig = '';
function populateScope(slugs: Slug[]) {
  const map = new Map<string, { value: string; isCentral: boolean; label: string }>();
  for (const s of slugs) {
    if (map.has(s.container)) continue;
    map.set(s.container, { value: s.container, isCentral: s.isCentral,
      label: s.isCentral ? '.agents/state/viz' : s.host + '/viz-pages' }); // api/slugs gives every non-central row a host
  }
  const conts = [...map.values()].sort((a, b) => (+b.isCentral - +a.isCentral) || a.label.localeCompare(b.label));
  const sig = conts.map(c => c.value).join('|');
  if (sig === scopeSig) return;
  scopeSig = sig;
  const sel = (document.getElementById('f-scope') as HTMLSelectElement), cur = sel.value;
  sel.innerHTML = '<option value="">all</option>' +
    conts.map(c => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('');
  sel.value = conts.some(c => c.value === cur) ? cur : '';
}

// Tag filter — dropdown adds a tag to activeTags (OR semantics), each shown as a removable
// pill. Options rebuilt only when the (all-tags − active) set changes, so the 5s poll never
// clobbers an open dropdown.
const activeTags = new Set<string>();
let tagSig = '';
function renderTagFilter(slugs: Slug[]) {
  document.getElementById('tag-pills')!.innerHTML = [...activeTags].sort()
    .map(t => `<span class="tag-pill">${esc(t)}<button data-tag-rm="${esc(t)}" title="remove">✕</button></span>`).join('');
  const all = [...new Set(slugs.flatMap(s => s.tags))].filter(t => !activeTags.has(t)).sort();
  const sig = all.join('|');
  if (sig !== tagSig) {
    tagSig = sig;
    (document.getElementById('f-tag') as HTMLSelectElement).innerHTML =
      '<option value="">add tag…</option>' + all.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }
}

function renderSlugs(allSlugs: Slug[]) {
  const hidden = parseHidden();
  // A hidden-tagged viz (viz.config.json hiddenTags, ADR 0020) drops out HERE, before the
  // stats and tag list, so "show all" off means it isn't counted either — as in viz ls.
  const showAll = (document.getElementById('f-all') as HTMLInputElement).checked;
  const slugs = allSlugs.filter(s => !matchesAny(s.id, hidden.slugs) && (showAll || !s.hidden));
  lastSlugs = allSlugs;
  populateScope(slugs);
  renderTagFilter(slugs);

  // Stats describe the real library — mirror rows are duplicate views, not vizzes.
  const natives = slugs.filter(s => !s.isMirror);
  const centralCount  = natives.filter(s => s.isCentral).length;
  const externalCount = natives.length - centralCount;

  // Totals — git-derived numbers only count ids that have landed in gitFeed.
  const totals = natives.reduce((acc, s) => {
    const g = gitFor(s.id);
    acc.posture[s.posture]++;
    return {
      ...acc,
      files: acc.files + s.fileCount,
      commits: acc.commits + (g ? g.commitCount : 0),
      bytes: acc.bytes + s.sizeBytes,
    };
  }, { files: 0, commits: 0, bytes: 0,
       posture: { public: 0, private: 0, local: 0, untagged: 0 } });

  const pc = totals.posture;
  const commitVal = gitLoaded ? totals.commits : '—';

  // ---- Stat band ------------------------------------------------------
  // These numbers used to be a row of text, which made the one tab that is
  // otherwise a real instrument the worst offender on bar 1 of the skill's
  // own standard. Now the two that have shape get shape:
  //   posture   a stacked bar, segment width = share of the library. It is
  //             also a CONTROL — clicking a segment drives the posture
  //             filter, so the chart and the filter are one object.
  //   size      a log-binned histogram, because viz sizes span 4 orders of
  //             magnitude and a linear axis renders it as one bar.
  // The rest stay as counts; a count with no distribution behind it is
  // honestly just a number.
  const POSTURE_TONE = { public: 'var(--good)', private: 'var(--c4)',
                         local: 'var(--muted)', untagged: 'var(--danger)' };
  const segs = (['public', 'private', 'local', 'untagged'] as const)
    .map(k => ({ k, n: pc[k] })).filter(s => s.n > 0);
  const nTot = natives.length || 1;
  const curPosture = (document.getElementById('f-posture') as HTMLSelectElement).value;

  // Kind. `page` is the absent case, named the way the lobby names it.
  // Kinds are OPEN — any template can declare a new one. The built-ins keep a fixed
  // order so the bar doesn't reshuffle under you as the library changes; any other
  // kind follows, alphabetically.
  const kindCount: Record<string, number> = {};
  for (const v of natives) kindCount[v.kind || 'page'] = (kindCount[v.kind || 'page'] || 0) + 1;
  const FIXED = ['page', 'poster-dive', 'poster', 'exchange', 'deck'];
  const KINDS = [...FIXED, ...Object.keys(kindCount).filter(k => !FIXED.includes(k)).sort()];
  const kindSel = (document.getElementById('f-kind') as HTMLSelectElement);
  for (const k of KINDS.slice(1)) {
    if (kindCount[k] && ![...kindSel.options].some(o => o.value === k)) kindSel.add(new Option(k, k));
  }
  const curKind = kindSel.value;

  // Log bins over viz size on disk.
  const BINS: { lo: number; hi: number; label: string; n?: number }[] = [
    // Short labels: the stat band gained a fourth column when the kind
    // axis landed, and the old "0.5–2 MB" style ran into its neighbours.
    // Upper bound per bin, which reads fine left-to-right under a histogram.
    { lo: 0,        hi: 32*1024,    label: '32K' },
    { lo: 32*1024,  hi: 128*1024,   label: '128K' },
    { lo: 128*1024, hi: 512*1024,   label: '512K' },
    { lo: 512*1024, hi: 2048*1024,  label: '2M' },
    { lo: 2048*1024, hi: Infinity,  label: '2M+' },
  ];
  for (const b of BINS) b.n = natives.filter(s => s.sizeBytes >= b.lo && s.sizeBytes < b.hi).length;
  const binMax = Math.max(1, ...BINS.map(b => b.n!));

  document.getElementById('slug-totals')!.innerHTML = `
      <div class="stat-band">
        <div class="stat-block posture-block">
          <div class="stat-cap">posture <span>${natives.length} vizzes · click to filter</span></div>
          <div class="posture-bar" role="group" aria-label="Posture split, click a segment to filter">
            ${segs.map(s => `
              <button class="pb-seg${curPosture === s.k ? ' on' : ''}"
                      style="--tone:${POSTURE_TONE[s.k]}; flex:${s.n}"
                      data-posture="${s.k}" data-viz-id="posture-${s.k}"
                      data-label="${s.n} ${s.k} vizzes"
                      title="${s.n} ${s.k} — ${(s.n / nTot * 100).toFixed(1)}% of the library. Click to filter.">
                <span class="pb-n">${s.n}</span>
              </button>`).join('')}
          </div>
          <div class="legend posture-legend">
            ${segs.map(s => `<span class="legend-item"><i class="swatch dot" style="background:${POSTURE_TONE[s.k]}"></i>${s.k}</span>`).join('')}
          </div>
        </div>

        <div class="stat-block kind-block">
          <div class="stat-cap">kind <span>width = share · click to filter</span></div>
          <!-- Bar carries the magnitude, legend carries the vocabulary — the
               same split the posture block above uses. Labels were originally
               inside the segments, but the distribution is far too skewed for
               that: plain pages are ~71% and the tail segments are ~30px, so
               even "poster dive" clipped. verify's audit caught it; the fix is to
               stop asking a 30px box to hold a two-word name. -->
          <div class="kind-bar" role="group" aria-label="Kind split, click a segment to filter">
            ${KINDS.filter(k => kindCount[k]).map(k => `
              <button class="sb-seg${curKind === k ? ' on' : ''}"
                      style="flex:${kindCount[k]}" data-kind="${k}"
                      data-viz-id="kind-${k}" data-label="${kindCount[k]} ${k} vizzes"
                      aria-label="${k.replace('-', ' ')}: ${kindCount[k]} vizzes"
                      title="${kindCount[k]} ${k} — ${(kindCount[k]! / nTot * 100).toFixed(1)}% of the library. Click to filter.">
                <span class="sb-n">${kindCount[k]}</span>
              </button>`).join('')}
          </div>
        </div>

        <div class="stat-block size-block">
          <div class="stat-cap">size on disk <span>${fmtSize(totals.bytes)} total · bin upper bound</span></div>
          <div class="size-hist" role="img" aria-label="Distribution of viz sizes on disk">
            ${BINS.map(b => `
              <span class="sh-col" title="${b.n} viz${b.n===1?'':'zes'} between ${b.label}"
                    data-viz-id="sizebin-${b.label}" data-label="${b.n} vizzes, ${b.label}">
                <i style="height:${(b.n! / binMax * 100).toFixed(1)}%"></i>
                <em>${b.label}</em>
              </span>`).join('')}
          </div>
        </div>

        <!-- Every number says what it is, in place. These used to be bare
             figures with the meaning hidden in a title, so "235  13c / 222x"
             read as one run-on number you had to hover to decode. -->
        <div class="stat-block counts-block">
          <span class="tnum" title="${centralCount} in the central library, ${externalCount} living inside your own repos">
            <b>${natives.length}</b><i>vizzes</i></span>
          <span class="tnum" title="${totals.files.toLocaleString()} file${totals.files===1?'':'s'} on disk across every viz">
            <b>${totals.files}</b><i>files</i></span>
          <span class="tnum" title="${gitLoaded ? totals.commits.toLocaleString() + ' commits across all host repos' : 'git feed still loading…'}">
            <b>${commitVal}</b><i>commits</i></span>
          <span class="tnum" title="${totals.bytes.toLocaleString()} bytes on disk">
            <b>${fmtSize(totals.bytes)}</b><i>on disk</i></span>
          <span class="tnum" id="server-uptime" title="how long this viz server has been up">
            <b>${lastServerInfo ? fmtUptime(lastServerInfo.uptimeSec) : '…'}</b><i>uptime</i></span>
          <span class="tnum" id="server-containers" title="viz-pages folders this server is currently serving">
            <b>${lastServerInfo ? lastServerInfo.containers : '…'}</b><i>containers</i></span>
        </div>
      </div>`;

  // Search filters only the RENDERED rows — the totals + diagram stats above
  // still describe the whole library, so they don't lurch around while typing.
  const terms = currentTerms();
  const f = filterState();
  markActiveControls(f);
  const shown = sortSlugs(applyFilters(slugs, f).filter(s => matchTerms(s, terms)), f);
  // The row's age badge tracks whatever time axis you're sorting on; any non-time sort falls back to modified.
  const timeField = f.sortKey === 'created' ? 'created' : 'modified';

  const narrowed = terms.length > 0 || shown.length !== slugs.length;
  const countEl = document.getElementById('search-count')!;
  countEl.textContent = narrowed ? `${shown.length} / ${slugs.length}` : '';
  countEl.classList.toggle('zero', narrowed && shown.length === 0);

  document.getElementById('slugs')!.innerHTML = shown.length === 0
    ? `<div style="color: var(--muted)">${terms.length
          ? `no viz matches “${esc(terms.join(' '))}”`
          : narrowed ? 'no viz matches the current filters' : 'none yet'}</div>`
    : shown.map(s => {
        const g = gitFor(s.originId || s.id);
        const commitCount = g ? g.commitCount : null;
        // Badge only the RARE case. 222 of 235 vizzes are repo-local, so an
        // "external" pill on nearly every row carried ~5% signal — the exact
        // failure ADR 0011 deleted viz:kind for. Where a repo-local viz lives
        // is already on the row underneath, as its host path.
        const badge = s.isCentral
          ? '<span class="badge central" title="central — lives in the shared scratch library (~/.agents/state/viz), not inside one of your repos.">central</span>'
          : '';
        // While searching, show the full path (highlighted) instead of just the
        // host — that's how a path-only match becomes visible. Otherwise keep
        // the compact host line for external vizzes.
        const sub = terms.length
          ? `<span class="slug-path">${hl(s.id, terms)}</span>`
          : s.isMirror
            ? `<span class="slug-host" title="publish-mirror row from ${esc(s.mirrorFrom)} — single-file, build-time only">↳ mirror ← ${esc(s.mirrorFrom)}</span>`
            : s.isVendored
              ? `<span class="slug-host" title="vendored full copy of ${esc(s.mirrorFrom)} — runs standalone; edit the origin and re-sync">↳ vendored ← ${esc(s.mirrorFrom)}</span>`
              : !s.isCentral
                ? `<span class="slug-host" title="host repo: ${esc(s.host)}">↳ ${esc(s.host)}</span>`
                : '';
        const commitInner = commitCount === null
          ? '<span class="count pending">—</span>'
          : `<span class="count">${commitCount}</span>`;
        const vizHref = '/' + (s.originId || s.id).split('/').map(encodeURIComponent).join('/') + '/';
        const thumb = s.og
          ? `<span class="slug-thumb" style="background-image:url('${vizHref}${s.og}')" title="${esc(s.description || 'OG preview (' + s.og + ')')}"></span>`
          : `<span class="slug-thumb empty" title="no OG preview image"></span>`;
        return `<div class="slug" data-id="${esc(s.id)}"
                       data-viz-id="slug-${esc(s.id)}"
                       data-label="${esc(s.title || s.name)} — ${s.posture}, ${fmtSize(s.sizeBytes)}">
            ${thumb}
            <span class="slug-id">
              <a class="slug-name" href="${vizHref}" target="_blank" rel="noopener"${s.description ? ` title="${esc(s.description)}"` : ''}>${badge}${hl(s.title || s.name, terms)}</a>
              ${sub}
              ${axisBadges(s)}${tagChips(s)}
            </span>
            <span class="slug-meta">
              <span class="icon-badge files" title="${s.fileCount} file${s.fileCount===1?'':'s'}">
                ${ICONS.file}<span class="count">${s.fileCount}</span>
              </span>
              <span class="icon-badge commits" title="${commitCount === null ? 'commits — git feed loading' : commitCount + ' commit' + (commitCount===1?'':'s')}">
                ${ICONS.commit}${commitInner}
              </span>
              <span class="slug-age" title="showing ${timeField}&#10;modified ${new Date(s.mtime).toLocaleString()}${s.created ? '&#10;created  ' + new Date(s.created).toLocaleString() : ''}">
                ${ICONS.clock}${fmtAgo(timeField === 'created' ? s.created : s.mtime)}
              </span>
              <span class="slug-size" title="${s.sizeBytes.toLocaleString()} bytes on disk">${fmtSize(s.sizeBytes)}</span>
              <span class="icon-only ${s.hasApi ? 'api-on' : 'api-off'}" title="${s.hasApi ? 'has api.ts' : 'no api.ts'}">
                ${s.hasApi ? ICONS.zap : ICONS.zapOff}
              </span>
              ${s.hero
              ? `<a class="icon-only hero-on" href="${vizHref}hero.html" target="_blank" rel="noopener" title="has hero.html — the OG card source (click to open)">${ICONS.image}</a>`
              : `<span class="icon-only hero-off" title="no hero.html OG card">${ICONS.image}</span>`}
              ${s.mirroredIn
              ? `<span class="icon-only mirror-on" title="${s.isVendored ? 'vendored full copy of ' + esc(s.mirrorFrom) + ' — runs standalone; edit the origin and re-sync' : 'mirrored-in copy from ' + esc(s.mirrorFrom || '') + ' — edit the origin viz, not this sink'}">${ICONS.link}</span>`
              : s.vendoredOut.length
                ? `<span class="icon-only mirror-src" title="origin viz — vendored (full copy) into: ${esc(s.vendoredOut.join(', '))}">${ICONS.link}</span>`
                : s.mirrorsOut.length
                  ? `<span class="icon-only mirror-src" title="origin viz — publish-mirrored to: ${esc(s.mirrorsOut.join(', '))}">${ICONS.link}</span>`
                  : `<span class="icon-only mirror-off" title="not mirrored">${ICONS.link}</span>`}
              ${s.mirroredIn && !s.isVendored // a vendored copy is managed here too: its drawer holds re-sync
              ? '<span class="manage-btn spacer" aria-hidden="true">⋯</span>'
              : `<button class="manage-btn" data-act="toggle" title="manage axes · rename · move · mirror">⋯</button>`}
            </span>
          </div>${s.id === openDrawerId ? drawerHtml(s) : ''}`;
      }).join('');
}

function renderCommits(allCommits: Commit[]) {
  const hidden = parseHidden();
  const commits = allCommits.filter(c => {
    const slug = commitSlug(c.subject);
    return !slug || !matchesAny(slug, hidden.commits);
  });
  document.getElementById('commit-total')!.textContent =
    commits.length === 0 ? '' : '(' + commits.length + ')';
  document.getElementById('commits')!.innerHTML = commits.length === 0
    ? '<div style="color: var(--muted)">no commits yet</div>'
    : commits.map(c => `<div class="commit">
          <span class="commit-hash">${esc(c.hash)}</span>${esc(c.subject)}<br>
          <span class="commit-when">${esc(c.when)}</span>
        </div>`).join('');
}

function renderServer(info: ServerInfo) {
  document.getElementById('server-info')!.innerHTML = [
    ['bun', info.bunVersion],
    ['pid', info.pid],
    ['uptime', fmtUptime(info.uptimeSec)],
    ['port', info.port],
    ['containers', info.containers],
  ].map(([k,v]) => `<div class="row"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join('');
  // These two used to be <text> nodes inside the runtime architecture SVG on
  // the old README tab. That diagram is gone (the Guide traces the runtime
  // interactively instead), so they're optional now — re-homed into the
  // Dashboard's stat row below. Guarded rather than deleted so the values
  // stay wired if either element exists.
  lastServerInfo = info;
  // Write into the value element, not the whole cell — the cell carries its
  // own <i> label now, and textContent on the parent would delete it.
  const upEl = document.querySelector('#server-uptime b');
  if (upEl) upEl.textContent = fmtUptime(info.uptimeSec);
  const ctEl = document.querySelector('#server-containers b');
  if (ctEl) ctEl.textContent = String(info.containers);
}

// ---- Fast loop (5s): server-info + slugs only. NO git feed here. -------
async function loadFast() {
  try {
    const [info, slugs]: [ServerInfo, Slug[]] = await Promise.all([
      fetch('api/server-info').then(r => r.json()),
      fetch('api/slugs').then(r => r.json()),
    ]);
    renderServer(info);
    // An open drawer holds live form state — don't clobber it on the 5s poll.
    // Keep the snapshot fresh so closing/re-rendering shows current data.
    if (openDrawerId) lastSlugs = slugs; else renderSlugs(slugs);
  } catch (e) {
    console.error('loadFast failed:', e);
  }
}

async function loadCommits() {
  try {
    renderCommits(await fetch('api/log').then(r => r.json()));
  } catch (e) {
    console.error('loadCommits failed:', e);
  }
}

// ---- Rescan button -----------------------------------------------------
const rescanBtn = (document.getElementById('rescan-btn') as HTMLButtonElement);
document.getElementById('rescan-icon')!.innerHTML = ICONS.refresh;
rescanBtn.addEventListener('click', async () => {
  rescanBtn.disabled = true;
  rescanBtn.classList.add('scanning');
  document.getElementById('rescan-label')!.textContent = 'scanning…';
  document.getElementById('git-status')!.textContent = '· git feed refreshing…';
  gitLoaded = false; // force "—" placeholders until the fresh git feed lands
  try {
    // /_rescan is an ABSOLUTE server route (not under this viz's api/).
    await fetch('/_rescan').then(r => r.json());
    // Re-pull fast feed (slugs/containers may have changed) + slow git feed.
    await loadFast();
    await loadGit();
  } catch (e) {
    console.error('rescan failed:', e);
    await loadGit(); // the commit counts were blanked for the rescan: bring them back
  } finally {
    rescanBtn.disabled = false;
    rescanBtn.classList.remove('scanning');
    document.getElementById('rescan-label')!.textContent = 'Rescan $HOME';
  }
});

// ---- Live preview ------------------------------------------------------
const previewBtn = (document.getElementById('preview-btn') as HTMLButtonElement);
const previewStop = (document.getElementById('preview-stop') as HTMLButtonElement);
const previewScope = (document.getElementById('f-scope') as HTMLSelectElement); // preview builds whatever the scope filter is pinned to
const previewResult = document.getElementById('preview-result')!;
document.getElementById('preview-icon')!.innerHTML = ICONS.refresh;
function setPreviewResult(html: string, isErr?: boolean) {
  previewResult.innerHTML = html;
  previewResult.className = 'preview-result' + (isErr ? ' err' : '');
}
// "preview" needs a specific container — disabled while scope is "all". So does base-url.
const syncPreviewEnabled = () => {
  previewBtn.disabled = !previewScope.value;
  (document.getElementById('baseurl-btn') as HTMLButtonElement).disabled = !previewScope.value;
};
previewScope.addEventListener('change', syncPreviewEnabled);
syncPreviewEnabled();
previewBtn.addEventListener('click', async () => {
  const container = previewScope.value; // never empty: the button is disabled while scope is "all"
  previewBtn.disabled = true;
  previewBtn.classList.add('scanning');
  document.getElementById('preview-label')!.textContent = 'building…';
  setPreviewResult('building the publishable tree — this can take a bit…');
  const r = await mgmt('preview', { container }); // POST blocks until the build serves
  previewBtn.classList.remove('scanning');
  document.getElementById('preview-label')!.textContent = 'preview';
  syncPreviewEnabled();
  if (r.ok) { // api/preview and api/base-url answer ok only with a url
    setPreviewResult(`serving → <a href="${esc(r.url!)}" target="_blank" rel="noopener">${esc(r.url!)}</a>`);
    previewStop.hidden = false;
    lobbyContainer = container;
    renderLobbyKey(r.lobby);
  } else {
    setPreviewResult('preview failed: ' + esc(r.err || 'unknown error'), true);
    previewStop.hidden = true;
    renderLobbyKey(null);
  }
});

// ---- Lobby key ---------------------------------------------------------
// Shown only for a container with a _private-lobby marker. The shim links are the
// hashtag-free form: a sealed page's <head> is encrypted and can't carry an OG card, so the
// shim is the only URL that unfurls. Their /<hash>/ segment depends solely on passphrase+salt,
// never the host, so swapping the 127.0.0.1 origin for the deployed one gives the real
// shareable link — that portability is why the localhost origin is not a dead end.
const lobbyKeyEl = document.getElementById('lobby-key')!;
// Remembered so "deployed url" can re-render the shims against the deployed origin without
// paying for another preview build. A shim's /<hash>/ segment is host-independent, so
// swapping the origin yields the real shareable link rather than an approximation of one.
let lastLobby: Lobby | null | undefined = null, deployedBase: string | null = null, lobbyContainer: string | null = null;
function renderLobbyKey(lobby: Lobby | null | undefined) {
  lastLobby = lobby;
  if (!lobby) { lobbyKeyEl.hidden = true; lobbyKeyEl.innerHTML = ''; return; }
  const copy = (v: string) => `<button class="copy" data-copy="${esc(v)}">copy</button>`;
  const row = (label: string, value: string, isLink?: boolean) => `<dt>${esc(label)}</dt><dd>${
    isLink ? `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>` : esc(value)
  }${copy(value)}</dd>`;
  lobbyKeyEl.innerHTML =
    `<h4>🔑 lobby key — this container is sealed behind one password` +
      `<button class="rot" title="viz rotate <container> --lobby — mints a new key; every existing lobby link and passphrase dies. Click twice.">rotate key</button></h4><dl>` +
    row('passphrase', lobby.passphrase) +
    row('hash', lobby.hash) +
    lobby.shims.map((u, i) => row(i ? '' : 'shim link', u, true)).join('') +
    // Once the deployed base is known, show the SHAREABLE form too — same hash, real origin.
    (deployedBase
      ? lobby.shims
          .map((u) => deployedBase + new URL(u).pathname)
          .map((u, i) => row(i ? '' : 'deployed', u, true))
          .join('')
      : '') +
    `</dl>` +
    (!lobby.shims.length
      ? `<p class="note">No shim links in this build. The hash above is host-independent, so it works against any origin.</p>`
      : deployedBase
        ? `<p class="note">Deployed links are the shareable ones — a sealed page can't unfurl, so the shim carries the card. They 404 until you actually deploy.</p>`
        : `<p class="note">Shim links open the site already unlocked, with no <code>#</code> fragment. Hit <b>deployed url</b> for the shareable form.</p>`);
  lobbyKeyEl.hidden = false;
}
// Explicit click, never automatic on scope change: this executes base-url.sh out of the
// selected repo, and its answer becomes a link that carries the lobby key.
const baseurlBtn = (document.getElementById('baseurl-btn') as HTMLButtonElement);
baseurlBtn.addEventListener('click', async () => {
  const container = previewScope.value; // never empty, as for preview
  baseurlBtn.disabled = true;
  baseurlBtn.textContent = 'asking…';
  const r = await mgmt('base-url', { container });
  baseurlBtn.textContent = 'deployed url';
  syncPreviewEnabled();
  if (r.ok) { // api/preview and api/base-url answer ok only with a url
    deployedBase = r.url!;
    // Card-public share pages (ADR 0018) — the one URL of a gated public viz that unfurls.
    // A _private-lobby container emits none: its lobby shims carry the card instead.
    // The list is computed server-side (lib/publish/base-url.ts) — the same one `viz urls` prints.
    const shares = r.shares!; // always sent with a url
    setPreviewResult(`deploys to → <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` +
      shares.map((u) => `<br>🪪 share → <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a> <button class="copy" data-copy="${esc(u)}">copy</button>`).join(''));
    if (lastLobby) renderLobbyKey(lastLobby); // re-render with the deployed shim links
  } else {
    deployedBase = null;
    setPreviewResult(esc(r.err || 'base-url.sh failed'), true);
  }
});
// Scope change invalidates a base URL read from a different container.
previewScope.addEventListener('change', () => { deployedBase = null; });

// Delegated: the rows are re-rendered on every preview, so per-button listeners would die.
const copyClick = async (e: MouseEvent) => {
  const btn = (e.target as Element).closest<HTMLElement>('button.copy');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset['copy']!);
    btn.textContent = 'copied';
    setTimeout(() => { btn.textContent = 'copy'; }, 1200);
  } catch { btn.textContent = 'copy failed'; }
};
lobbyKeyEl.addEventListener('click', copyClick);
// Rotate the lobby key: two clicks (like the drawer's arm()), then rebuild the preview so
// the NEW passphrase shows — rotate itself only mints the key; the build prints it.
lobbyKeyEl.addEventListener('click', async (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('button.rot');
  if (!btn) return;
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed'); btn.textContent = 'confirm? kills every lobby link';
    setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'rotate key'; }, 2500);
    return;
  }
  btn.disabled = true; btn.textContent = 'rotating…';
  const r = await mgmt('rotate', { container: lobbyContainer! }); // set by the preview that showed this key
  if (!r.ok) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = 'rotate key'; return setPreviewResult('rotate failed: ' + esc(r.err || 'unknown error'), true); }
  renderLobbyKey(null); // the shown key is dead now
  if (previewScope.value === lobbyContainer) previewBtn.click();
  else setPreviewResult(esc(r.out) + '<br>preview this container again to see the new key.');
});
previewResult.addEventListener('click', copyClick);
previewStop.addEventListener('click', async () => {
  previewStop.disabled = true;
  await mgmt('preview-stop', {});
  previewStop.disabled = false;
  previewStop.hidden = true;
  setPreviewResult('preview stopped');
});

// ---- Search wiring -----------------------------------------------------
const searchEl = (document.getElementById('slug-search') as HTMLInputElement);
document.getElementById('search-icon')!.innerHTML = ICONS.search;
// Re-render rows from the last snapshot on every keystroke — no refetch.
searchEl.addEventListener('input', () => renderSlugs(lastSlugs));
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchEl.value = ''; renderSlugs(lastSlugs); searchEl.blur(); }
});
// ⌘/Ctrl+F and "/" focus this box instead of the (futile) browser find.
window.addEventListener('keydown', (e) => {
  const typing = document.activeElement === searchEl;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault(); searchEl.focus(); searchEl.select();
  } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault(); searchEl.focus();
  }
});

// ---- Surface management (ADR 0009): drawer → api/{update,move,mirror,vendor,history,…} ----
// Reads are local; every write shells out to the viz CLI (one definition of the
// hard logic). The drawer is rendered inline by renderSlugs when its row is open.
const cssEsc = (s: string) => String(s).replace(/["\\]/g, '\\$&');
const drawerOf = (id: string) => document.querySelector(`.slug-drawer[data-id="${cssEsc(id)}"]`);
const chipHtml = (t: string) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}<button class="chip-x" data-act="chip-rm" title="remove">✕</button></span>`;

// Sink/destination containers = every other container in the library.
function containerOptions(currentContainer: string) {
  return [...new Set(lastSlugs.map(s => s.container))]
    .filter(c => c !== currentContainer)
    .map(c => ({ value: c, label: c.split('/').slice(-3).join('/') }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ value, label }) => `<option value="${esc(value)}">${esc(label)}</option>`).join('')
    || '<option value="" disabled>no other containers</option>';
}

function drawerHtml(s: Slug) {
  const cur: Record<string, string | undefined> = { posture: s.posture, listed: s.listed ? 'listed' : 'unlisted', approved: s.approval === 'approved' ? 'true' : 'false',
                'card-public': ({ public: 'true', 'not-public': 'false' } as Record<string, string>)[s.cardPublic] };
  const grp = (axis: string, label: string | undefined, opts: [string, string][]) => `<div class="dg"><span class="dg-l">${label}</span>` +
    opts.map(([v, t]) => `<button class="dg-b ${cur[axis] === v ? 'on' : ''}" data-act="axis" data-axis="${axis}" data-val="${v}">${t}</button>`).join('') + `</div>`;
  return `<div class="slug-drawer" data-id="${esc(s.id)}">
      <div class="dg-row">
        <div class="dg"><span class="dg-l" title="viz:uid — durable identity; survives move and rename (ADR 0014)">uid</span>${s.uid
        ? `<button class="dg-b" data-act="copy-uid" data-uid="${esc(s.uid)}" title="click to copy">${esc(s.uid)}</button>`
        : '<span class="mz">none yet — backfill-uids.ts mints one</span>'}</div>
      </div>
      ${s.template ? `<div class="dg-row">
        <div class="dg grow"><span class="dg-l" title="viz create <slug> --from this">new from this</span>
          <input class="d-in" data-fld="newSlug" placeholder="new-slug (central library)" spellcheck="false">
          <button class="dg-b" data-act="create-from">create</button></div>
      </div>` : ''}
      <div class="dg-row">
        ${grp('posture', 'posture', [['public','public'],['private','private'],['local','local']])}
        ${grp('listed', 'listed', [['listed','listed'],['unlisted','unlisted']])}
      </div>
      <div class="dg-row">
        ${grp('approved', { approved: 'approved', stale: '⚠ changed since approval', never: 'not approved' }[s.approval],
            [['true', s.approval === 'stale' ? 're-approve this version' : 'approve this version'], ['false', 'withdraw']])}
      </div>
      <div class="dg-row">
        ${grp('card-public', { public: '🪪 card public', 'not-public': '🪪 card not public', unreviewed: 'card unreviewed',
                             stale: `⚠ card changed since reviewed (was ${s.cardWas.replace('-', ' ')})` }[s.cardPublic],
            [['true', 'card is public'], ['false', 'card is not public']])}
        ${s.cardPublic === 'public' && (s.lobby || s.posture !== 'public') ? `<span class="mz">no share page: ${s.lobby
        ? 'this container has a private lobby — its lobby shim carries the card instead'
        : `posture is ${esc(s.posture)} — only public vizzes get one`}</span>` : ''}
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l">rename</span>
          <input class="d-in" data-fld="name" value="${esc(s.name)}" spellcheck="false">
          <button class="dg-b" data-act="rename">save</button></div>
        <div class="dg grow"><span class="dg-l">move →</span>
          <select class="d-sel" data-fld="toContainer">${containerOptions(s.container)}</select>
          <button class="dg-b warn" data-act="move">move</button></div>
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l">title</span>
          <input class="d-in wide" data-fld="title" value="${esc(s.title)}" placeholder="${esc(s.name)}" spellcheck="false"></div>
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l">desc</span>
          <input class="d-in wide" data-fld="description" value="${esc(s.description)}" placeholder="one-line description" spellcheck="false"></div>
      </div>
      <div class="dg-row">
        <div class="dg tag-edit"><span class="dg-l">tags</span>
          <span class="chips" data-fld="tags">${s.tags.map(chipHtml).join('')}<input class="tag-input" list="all-tags" placeholder="add tag…" spellcheck="false"></span>
          <button class="dg-b" data-act="meta-save" title="save title · description · tags">save</button></div>
      </div>
      <div class="dg-row">
        <div class="dg grow"><span class="dg-l" title="where this viz's URL is linked from; any entry makes move/delete/posture refuse (ADR 0016)">linked from</span>
          <span class="link-list">${s.linkedFrom.map(l => `<span class="mchip">${esc(l)}<button class="mx" data-act="unlink" data-link="${esc(l)}" title="remove this entry">✕</button></span>`).join('') || '<span class="mz">not linked</span>'}</span>
          <input class="d-in wide" data-fld="linkedFrom" placeholder="add: a URL, or e.g. 'a Confluence page'" spellcheck="false">
          <button class="dg-b" data-act="link">add</button></div>
      </div>
      <datalist id="all-tags">${[...new Set(lastSlugs.flatMap((x) => x.tags))].sort().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">mirror →</span>
          <select class="d-sel" data-fld="to">${containerOptions(s.container)}</select>
          <select class="d-sel" data-fld="access"><option value="public">public</option><option value="private">private</option></select>
          <button class="dg-b" data-act="mirror-add">add</button></div>
        <div class="dg"><span class="dg-l">mirrors</span><span class="mirror-list"><span class="mz">…</span></span></div>
        <div class="mirror-edit"></div>
      </div>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">vendor →</span>
          <select class="d-sel" data-fld="vto">${containerOptions(s.container)}</select>
          <button class="dg-b" data-act="vendor-add" title="copy this viz as a self-contained, runnable copy into another repo (+ a drift-guard hook)">copy as ${esc(s.posture)}</button></div>
        <div class="dg"><span class="dg-l">vendored</span><span class="vendor-list"><span class="mz">…</span></span></div>
        ${s.isVendored ? `<div class="dg"><span class="dg-l">origin</span>
          <button class="dg-b" data-act="vendor-sync" title="re-pull this vendored copy from its origin — overwrites local edits">re-sync</button></div>` : ''}
      </div>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">video</span>
          <button class="dg-b" data-act="render" title="render this viz to an mp4 (needs window.__viz.timeline for an exact render; narration.json adds audio + captions)">render mp4</button>
          <span class="render-state mz">${renderLine(s.id)}</span></div>
      </div>
      <details class="hist"><summary data-act="history">history · restore an earlier version</summary><div class="hist-rows"></div></details>
      <div class="dg-row">
        <div class="dg"><span class="dg-l">danger</span>
          <button class="dg-b warn" data-act="delete" title="delete this viz folder — click twice to confirm">delete viz</button></div>
      </div>
      ${drawerStatus.id === s.id ? `<div class="${drawerStatus.cls}">${esc(drawerStatus.msg)}</div>` : '<div class="drawer-status"></div>'}
    </div>`;
}

// Render jobs by viz id. The drawer re-renders on every poll, so the line is rebuilt from
// this map rather than kept in the DOM.
const renderJobs = new Map<string, RenderJob>();
function renderLine(id: string) {
  const j = renderJobs.get(id);
  if (!j) return '';
  const pct = j.frames ? ` ${Math.floor(j.frame / j.frames * 100)}%` : '';
  const warn = j.warnings?.length ? ` · ⚠ ${j.warnings.map(esc).join(' · ⚠ ')}` : '';
  if (j.state === 'running') return `rendering${pct} <button class="mx" data-act="render-cancel" title="cancel this render">✕</button>${warn}`;
  if (j.state === 'done') return `✓ <code title="copy the path to open it">${esc(j.out)}</code>${warn}`;
  return `${esc(j.state)}${j.error ? ': ' + esc(j.error) : ''} <span title="${esc(j.log)}">(log)</span>${warn}`;
}
async function pollRender(id: string) {
  for (;;) {
    const j = renderJobs.get(id);
    const box = drawerOf(id)?.querySelector('.render-state');
    if (box) box.innerHTML = renderLine(id);
    if (!j || j.state !== 'running') return;
    await new Promise(r => setTimeout(r, 1000));
    const r = await mgmt('render', { action: 'status', job: j.id });
    if (r.job) renderJobs.set(id, r.job);
  }
}

// Kept here as well as in the DOM: a write's refreshAfter() rebuilds the open drawer, and the
// status line saying what the write did must survive that.
let drawerStatus = { id: '', msg: '', cls: 'drawer-status' };
function setStatus(id: string, msg: string, ok?: boolean) {
  drawerStatus = { id, msg, cls: 'drawer-status' + (ok === true ? ' ok' : ok === false ? ' err' : '') };
  const el = drawerOf(id)?.querySelector('.drawer-status');
  if (el) { el.textContent = msg; el.className = drawerStatus.cls; }
}
/** A write's answer as the drawer's status line: the CLI's first line of output (`done` when it
 *  printed nothing), or why it failed. */
const said = (r: Mgmt, done: string) => r.ok ? (r.out.split('\n')[0] || done) : (r.err || 'failed');
async function mgmt(route: string, body: object): Promise<Mgmt> {
  try {
    const res = await fetch('api/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // A backend that THREW comes back as a plain-text 500 ("api error: ..."), not JSON, so
    // parsing blind reported every such failure as `Unexpected token 'a'` and buried the
    // real message. Read the body once, then fall back to showing it verbatim.
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, err: text.trim() || ('HTTP ' + res.status) }; }
  } catch (e) { return { ok: false, err: String(e) }; }
}
async function loadMirrors(id: string) {
  const [rows, vrows] = await Promise.all(['mirrors', 'vendors'].map(r =>
    fetch(`api/${r}?id=` + encodeURIComponent(id)).then(r => r.json()).catch(() => []))) as [Mirror[], Mirror[]];
  mirrorRows = new Map(rows.map(m => [m.to, m]));
  // Looked up AFTER the fetch: a refresh may have rebuilt the drawer meanwhile, or the write
  // that called this may have taken its row out of the filtered list.
  const d = drawerOf(id);
  if (!d) return;
  d.querySelector('.mirror-list')!.innerHTML = rows.length === 0 ? '<span class="mz">none</span>'
    : rows.map(m => `<span class="mchip">${esc(m.to)} <i>[${esc(m.access)}]</i>${m.listed ? '' : ' ·unlisted'}${m.overrides ? ' ·overrides' : ''}<button class="mx" data-act="mirror-edit" data-to="${esc(m.to)}" title="edit listed / title / description / tags for this mirror">✎</button><button class="mx" data-act="mirror-rm" data-to="${esc(m.to)}" title="remove mirror">✕</button></span>`).join('');
  d.querySelector('.vendor-list')!.innerHTML = vrows.length === 0 ? '<span class="mz">none</span>'
    : vrows.map(v => `<span class="mchip">${esc(v.to)} <i>[${esc(v.access)}]</i><button class="mx" data-act="vendor-rm" data-to="${esc(v.to)}" title="undeclare — the copy is pruned on the next publish --push-vendors">✕</button></span>`).join('');
}
let mirrorRows = new Map<string, Mirror>(); // last /mirrors answer for the open drawer, to prefill the editor
// Per-mirror overrides: every field is sent, so blanking one clears that override.
function mirrorEditHtml(m: Mirror) {
  const o = m.overrides || {};
  return `<div class="dg-row">
      <div class="dg"><span class="dg-l">→ ${esc(m.to)}</span>
        <select class="d-sel" data-fld="m-listed"><option value="listed"${m.listed ? ' selected' : ''}>listed</option><option value="unlisted"${m.listed ? '' : ' selected'}>unlisted</option></select></div>
      <div class="dg grow"><input class="d-in" data-fld="m-title" value="${esc(o.title || '')}" placeholder="title override" spellcheck="false">
        <input class="d-in" data-fld="m-description" value="${esc(o.description || '')}" placeholder="description override" spellcheck="false">
        <input class="d-in" data-fld="m-tags" value="${esc((o.tags || []).join(', '))}" placeholder="tags override (comma-separated)" spellcheck="false">
        <button class="dg-b" data-act="mirror-save" data-to="${esc(m.to)}">save</button></div>
    </div>`;
}
async function loadHistory(id: string) {
  const box = drawerOf(id)?.querySelector('.hist-rows');
  if (!box) return;
  box.innerHTML = '<span class="mz">…</span>';
  const r: { ok: boolean; err?: string; commits: { hash: string; date: string; subject: string }[] } =
    await fetch('api/history?id=' + encodeURIComponent(id)).then(r => r.json()).catch(() => ({ ok: false }));
  box.innerHTML = !r.ok ? `<span class="mz">${esc(r.err || 'no history')}</span>`
    : !r.commits.length ? '<span class="mz">no commits touching this viz</span>'
    : r.commits.map(c => `<div class="hist-row"><code title="${esc(c.hash)}">${esc(c.hash.slice(0, 7))}</code><span class="mz">${esc(fmtAgo(Date.parse(c.date)))}</span><span title="${esc(c.subject)}">${esc(c.subject)}</span>` +
        `<button class="dg-b warn" data-act="rollback" data-commit="${esc(c.hash)}" title="restore this viz's files to this commit (committed as a new change) — click twice">restore</button></div>`).join('');
}
function reopenRender() { renderSlugs(lastSlugs); if (openDrawerId) loadMirrors(openDrawerId); }
async function refreshAfter() { await loadFast(); await loadGit(); }

document.getElementById('slugs')!.addEventListener('click', async (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!btn) return;
  const act = btn.dataset['act'];
  const id = btn.closest<HTMLElement>('.slug, .slug-drawer')!.dataset['id']!; // every [data-act] is in a row or its drawer

  if (act === 'toggle') {
    openDrawerId = openDrawerId === id ? null : id;
    confirmKey = null; setStatus(id, '');
    reopenRender();
    return;
  }
  if (act === 'chip-rm') { btn.closest('.chip')!.remove(); return; }
  // The template badge opens the drawer at its "new from this" row — the drawer, not the
  // row, because the 5s poll leaves an open drawer's inputs alone.
  if (act === 'from-open') {
    if (openDrawerId !== id) { openDrawerId = id; confirmKey = null; setStatus(id, ''); reopenRender(); }
    drawerOf(id)!.querySelector<HTMLInputElement>('[data-fld="newSlug"]')!.focus();
    return;
  }
  if (act === 'copy-uid') {
    try { await navigator.clipboard.writeText(btn.dataset['uid']!); setStatus(id, 'uid copied', true); } catch { setStatus(id, 'copy failed', false); }
    return;
  }
  if (act === 'history') {
    if (!(btn.parentElement as HTMLDetailsElement).open) loadHistory(id); // clicked while closed = opening
    return;
  }
  // Two-step confirm for destructive actions: first click arms, second within 2.5s commits.
  const arm = (key: string) => {
    if (confirmKey === key) { confirmKey = null; return true; }
    confirmKey = key; btn.classList.add('armed');
    const was = btn.textContent;
    if (btn.classList.contains('dg-b')) btn.textContent = 'confirm?';
    // Unanswered: disarm, so a click long after still needs its confirming second one. The
    // button is put back in place, not by a re-render, which would reset the drawer's inputs
    // (the move destination picked before the first click among them).
    setTimeout(() => {
      if (confirmKey !== key) return;
      confirmKey = null; btn.classList.remove('armed'); btn.textContent = was; setStatus(id, '');
    }, 2500);
    return false;
  };
  // Every act below this line is a button inside the open drawer.
  const drawer = drawerOf(id)!;

  if (act === 'axis') {
    const body = { id, [btn.dataset['axis']!]: btn.dataset['val'] };
    setStatus(id, 'saving…');
    const r = await mgmt('update', body);
    setStatus(id, said(r, 'updated'), r.ok);
    if (r.ok) { await refreshAfter(); loadMirrors(id); }
  } else if (act === 'meta-save') {
    const val = (f: string) => drawer.querySelector<HTMLInputElement>(`input[data-fld="${f}"]`)!.value.trim();
    const chips = [...drawer.querySelectorAll<HTMLElement>('[data-fld="tags"] .chip')].map(c => c.dataset['tag']!);
    const pend = drawer.querySelector<HTMLInputElement>('.tag-input')!.value.trim(); // commit an un-entered tag too
    if (pend && !chips.some(t => t.toLowerCase() === pend.toLowerCase())) chips.push(pend);
    setStatus(id, 'saving…');
    const r = await mgmt('update', { id, title: val('title'), description: val('description'), tags: chips.join(', ') });
    setStatus(id, said(r, 'saved'), r.ok);
    if (r.ok) { await refreshAfter(); loadMirrors(id); }
  } else if (act === 'link' || act === 'unlink') {
    const body = act === 'link'
      ? { id, 'linked-from': drawer.querySelector<HTMLInputElement>('[data-fld="linkedFrom"]')!.value.trim() }
      : { id, 'unlinked-from': btn.dataset['link'] };
    if (!body['linked-from'] && !body['unlinked-from']) return setStatus(id, 'entry required', false);
    setStatus(id, 'saving…');
    const r = await mgmt('update', body);
    if (r.ok) { await refreshAfter(); reopenRender(); } // the open drawer is not re-rendered by the poll
    setStatus(id, said(r, 'saved'), r.ok);
  } else if (act === 'rename') {
    const name = drawer.querySelector<HTMLInputElement>('[data-fld="name"]')!.value.trim();
    if (!name) return setStatus(id, 'name required', false);
    setStatus(id, 'renaming…');
    const r = await mgmt('move', { id, name });
    if (r.ok) { openDrawerId = null; await refreshAfter(); } else setStatus(id, said(r, ''), false);
  } else if (act === 'move') {
    const to = drawer.querySelector<HTMLSelectElement>('[data-fld="toContainer"]')!.value;
    if (!to) return setStatus(id, 'no destination container', false);
    if (!arm('move')) return setStatus(id, 'click move again to confirm');
    setStatus(id, 'moving…');
    const r = await mgmt('move', { id, toContainer: to });
    if (r.ok) { openDrawerId = null; await refreshAfter(); } else setStatus(id, said(r, ''), false);
  } else if (act === 'mirror-add') {
    const to = drawer.querySelector<HTMLSelectElement>('[data-fld="to"]')!.value;
    if (!to) return setStatus(id, 'no sink container', false);
    setStatus(id, 'mirroring…');
    const r = await mgmt('mirror', { id, sub: 'add', to, access: drawer.querySelector<HTMLSelectElement>('[data-fld="access"]')!.value });
    setStatus(id, said(r, 'mirror added'), r.ok);
    if (r.ok) loadMirrors(id);
  } else if (act === 'mirror-rm') {
    if (!arm('rm:' + btn.dataset['to'])) { btn.textContent = '✓?'; return setStatus(id, 'click ✕ again to confirm'); }
    setStatus(id, 'removing…');
    const r = await mgmt('mirror', { id, sub: 'rm', to: btn.dataset['to'] });
    setStatus(id, said(r, 'mirror removed'), r.ok);
    if (r.ok) loadMirrors(id);
  } else if (act === 'vendor-add') {
    const to = drawer.querySelector<HTMLSelectElement>('[data-fld="vto"]')!.value;
    if (!to) return setStatus(id, 'no sink container', false);
    const posture = lastSlugs.find(x => x.id === id)?.posture;
    if (!arm('vendor:' + to)) return setStatus(id, `click again to copy as ${posture} — writes a full copy + a pre-commit guard into the sink repo`);
    setStatus(id, 'vendoring…');
    const r = await mgmt('vendor', { id, to });
    setStatus(id, said(r, 'vendored'), r.ok);
    if (r.ok) { await refreshAfter(); loadMirrors(id); }
  } else if (act === 'vendor-rm') {
    if (!arm('vrm:' + btn.dataset['to'])) { btn.textContent = '✓?'; return setStatus(id, 'click ✕ again to confirm — undeclares the copy; it is pruned on the next publish --push-vendors'); }
    setStatus(id, 'removing…');
    const r = await mgmt('vendor-rm', { id, to: btn.dataset['to'] });
    setStatus(id, said(r, 'vendor removed'), r.ok);
    if (r.ok) loadMirrors(id);
  } else if (act === 'mirror-edit') {
    drawer.querySelector('.mirror-edit')!.innerHTML = mirrorEditHtml(mirrorRows.get(btn.dataset['to']!)!);
  } else if (act === 'mirror-save') {
    const box = drawer.querySelector('.mirror-edit')!;
    const val = (f: string) => box.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-fld="m-${f}"]`)!.value.trim();
    setStatus(id, 'saving…');
    const r = await mgmt('mirror', { id, sub: 'update', to: btn.dataset['to'], listed: val('listed'),
      title: val('title'), description: val('description'), tags: val('tags') });
    setStatus(id, said(r, 'mirror updated'), r.ok);
    if (r.ok) { box.innerHTML = ''; loadMirrors(id); }
  } else if (act === 'render') {
    if (renderJobs.get(id)?.state === 'running') return;
    setStatus(id, 'starting render…');
    const r = await mgmt('render', { action: 'start', id });
    setStatus(id, r.ok ? '' : said(r, ''), r.ok ? undefined : false);
    if (r.job) { renderJobs.set(id, r.job); pollRender(id); }
  } else if (act === 'render-cancel') {
    const r = await mgmt('render', { action: 'cancel', job: renderJobs.get(id)!.id }); // ✕ shows only for a running job
    if (r.job) renderJobs.set(id, r.job);
  } else if (act === 'rollback') {
    const commit = btn.dataset['commit'];
    if (!arm('rollback:' + commit)) return setStatus(id, `click restore again to roll this viz back to ${commit}`);
    setStatus(id, 'restoring…');
    const r = await mgmt('rollback', { id, commit });
    setStatus(id, said(r, 'restored'), r.ok);
    if (r.ok) { await refreshAfter(); loadHistory(id); }
  } else if (act === 'create-from') {
    const slug = drawer.querySelector<HTMLInputElement>('[data-fld="newSlug"]')!.value.trim();
    if (!slug) return setStatus(id, 'slug required', false);
    // Opened NOW, inside the click, so no popup blocker objects; pointed at the viz once it exists.
    const tab = window.open('', '_blank');
    setStatus(id, 'creating…');
    const r = await mgmt('create', { from: id, slug });
    if (r.ok && r.id) {
      if (tab) tab.location = '/' + r.id.split('/').map(encodeURIComponent).join('/') + '/';
      openDrawerId = null; await refreshAfter();
    } else { tab?.close(); setStatus(id, said(r, ''), false); }
  } else if (act === 'vendor-sync') {
    if (!arm('vsync:' + id)) return setStatus(id, 'click re-sync again to confirm — overwrites this copy from its origin');
    setStatus(id, 're-syncing…');
    const r = await mgmt('vendor-sync', { id });
    setStatus(id, said(r, 're-synced'), r.ok);
    if (r.ok) await refreshAfter();
  } else if (act === 'delete') {
    if (!arm('delete:' + id)) return setStatus(id, 'click delete again to confirm — this removes the folder');
    setStatus(id, 'deleting…');
    const r = await mgmt('delete', { id });
    if (r.ok) { openDrawerId = null; await refreshAfter(); } else setStatus(id, said(r, ''), false);
  }
});

// Tag chip entry: Enter/comma commits the typed tag (datalist suggests existing
// ones as you type); Backspace on an empty input removes the last chip.
document.getElementById('slugs')!.addEventListener('keydown', (e) => {
  const input = (e.target as Element).closest<HTMLInputElement>('.tag-input');
  if (!input) return;
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const v = input.value.trim().replace(/,+$/, '');
    if (!v) return;
    const chips = input.closest('.chips');
    if (![...chips!.querySelectorAll<HTMLElement>('.chip')].some(c => c.dataset['tag']!.toLowerCase() === v.toLowerCase()))
      input.insertAdjacentHTML('beforebegin', chipHtml(v));
    input.value = '';
  } else if (e.key === 'Backspace' && !input.value) {
    input.closest('.chips')?.querySelector('.chip:last-of-type')?.remove();
  }
});

// ---- Filter + sort controls (client-side over the fast snapshot) -------
type Filters = ReturnType<typeof filterState>;
function filterState() {
  const v = (id: string) => ((document.getElementById(id) as HTMLSelectElement) as HTMLSelectElement).value;
  return {
    sortKey: v('sort-key'),
    sortDir: document.getElementById('sort-dir')!.dataset['dir'],
    posture: v('f-posture'), listed: v('f-listed'),
    approved: v('f-approved'), card: v('f-card'), api: v('f-api'), scope: v('f-scope'),
    kind: v('f-kind'),
    tags: [...activeTags],
    originals: (document.getElementById('f-originals') as HTMLInputElement).checked,
    all: (document.getElementById('f-all') as HTMLInputElement).checked,
  };
}
function applyFilters(list: Slug[], f: Filters) {
  return list.filter(s => {
    if (f.tags.length && !s.tags.some(t => f.tags.includes(t))) return false; // OR within tags
    if (f.posture && s.posture !== f.posture) return false;
    if (f.listed === 'listed' && !s.listed) return false;
    if (f.listed === 'unlisted' && s.listed) return false;
    if (f.approved && s.approval !== f.approved) return false;
    if (f.card && s.cardPublic !== f.card) return false;
    if (f.api === 'yes' && !s.hasApi) return false;
    if (f.api === 'no' && s.hasApi) return false;
    // Empty string means "no kind" = a plain page, which the
    // lobby names `page`. Normalise here so the two surfaces agree.
    if (f.kind && (s.kind || 'page') !== f.kind) return false;
    if (f.scope && s.container !== f.scope) return false;
    if (f.originals && s.mirroredIn) return false;
    return true;
  });
}
const SORT_KEYS: Record<string, (s: Slug) => string | number> = {
  modified: s => s.mtime,
  created:  s => s.created,
  name:     s => s.name.toLowerCase(),
  size:     s => s.sizeBytes,
  files:    s => s.fileCount,
  commits:  s => (gitFor(s.id)?.commitCount ?? -1),
};
const NATURAL_DIR: Record<string, string> = { modified: 'desc', created: 'desc', name: 'asc', size: 'desc', files: 'desc', commits: 'desc' };
function sortSlugs(list: Slug[], f: Filters) {
  const key = SORT_KEYS[f.sortKey]!; // the <select> offers only these keys
  const dir = f.sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = key(a), vb = key(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.name.localeCompare(b.name); // stable tiebreak by name
  });
}
function markActiveControls(f: Filters) {
  for (const id of FILTER_IDS)
    (document.getElementById(id) as HTMLSelectElement).classList.toggle('active', !!(document.getElementById(id) as HTMLSelectElement).value);
  (document.getElementById('f-tag') as HTMLSelectElement).classList.toggle('active', activeTags.size > 0);
  document.querySelector('.ctl-check')!.classList.toggle('active', f.originals);
  document.getElementById('f-all-label')!.classList.toggle('active', f.all);
  persistFilters(f);
}

// ---- Filter state in the URL -----------------------------------------
// A filtered view is worth sharing, and the server's hot-reload is a full
// page refresh that would otherwise drop every filter you had set.
//
// NOT the kit's saveHash(): it serialises JSON into the hash, which would
// overwrite the "#dashboard" the tab shell routes on. The tab owns the
// hash; filters ride behind "&", which the tab router already splits off.
const FILTER_IDS = ['f-posture', 'f-listed', 'f-approved', 'f-card', 'f-api', 'f-scope', 'f-kind'];
let filtersReady = false;

function persistFilters(f: Filters) {
  // The Dashboard re-renders every 5s whether or not you are looking at it,
  // and this used to write "#dashboard&…" unconditionally — so reading the
  // Guide silently rewrote the URL out from under you, clobbering the guide's
  // own "&stop=" state. Only the visible tab owns the hash.
  if (!document.getElementById('tab-dashboard')!.classList.contains('active')) return;
  const q = new URLSearchParams();
  for (const id of FILTER_IDS) {
    const v = (document.getElementById(id) as HTMLSelectElement).value;
    if (v) q.set(id.slice(2), v);
  }
  if (f.sortKey && f.sortKey !== 'modified') q.set('sort', f.sortKey); // the default stays out of the URL
  if (f.sortDir === 'asc') q.set('dir', 'asc');
  if (f.originals) q.set('originals', '1');
  if (f.all) q.set('all', '1');
  if (activeTags.size) q.set('tags', [...activeTags].join(','));
  const search = (document.getElementById('slug-search') as HTMLInputElement).value.trim();
  if (search) q.set('q', search);
  const tail = q.toString();
  const next = '#dashboard' + (tail ? '&' + tail : '');
  if (location.hash !== next) history.replaceState(null, '', next);
}

function restoreFilters(fromHash?: string) {
  // On boot, read the ORIGINAL hash (see window.__initialHash). On a later
  // hashchange, read the new one — pasting a filtered link into an already
  // open tab is a same-document navigation, so nothing re-inits by itself.
  const tail = (fromHash ?? window.__initialHash).replace(/^#[^&]*&?/, '');
  if (tail) {
    const q = new URLSearchParams(tail);
    for (const id of FILTER_IDS) {
      const v = q.get(id.slice(2)), sel = document.getElementById(id) as HTMLSelectElement;
      if (!v) continue;
      // Scope and most kinds are options the first render adds; until then, hold the value in
      // one of its own (the render keeps it if the library has it, and drops it if not).
      if (![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v));
      sel.value = v;
    }
    // Only a key the <select> offers: an old link's sort=recent would blank it, and the list with it.
    const sortSel = document.getElementById('sort-key') as HTMLSelectElement, sort = q.get('sort');
    if (sort && [...sortSel.options].some((o) => o.value === sort)) sortSel.value = sort;
    if (q.get('dir') === 'asc') setSortDir('asc');
    if (q.get('originals')) (document.getElementById('f-originals') as HTMLInputElement).checked = true;
    if (q.get('all')) (document.getElementById('f-all') as HTMLInputElement).checked = true;
    for (const t of (q.get('tags') || '').split(',').filter(Boolean)) activeTags.add(t);
    if (q.get('q')) (document.getElementById('slug-search') as HTMLInputElement).value = q.get('q')!;
  }
  // "show all" is remembered across visits (like the list/grid view); a link's &all=1 still wins.
  if (fromHash === undefined) try { if (localStorage.getItem('sp-show-all') === '1') (document.getElementById('f-all') as HTMLInputElement).checked = true; } catch {}
  filtersReady = true;
}
// The posture bar is a chart AND the posture filter. Delegated on the
// container, which survives every re-render of its contents. Clicking the
// segment that's already active clears the filter, so the bar is a toggle
// rather than a one-way trip that leaves you hunting for the reset button.
document.getElementById('slug-totals')!.addEventListener('click', e => {
  const pseg = (e.target as Element).closest<HTMLElement>('.pb-seg');
  if (pseg) {
    const sel = (document.getElementById('f-posture') as HTMLSelectElement);
    sel.value = sel.value === pseg.dataset['posture'] ? '' : pseg.dataset['posture']!;
    return renderSlugs(lastSlugs);
  }
  const sseg = (e.target as Element).closest<HTMLElement>('.sb-seg');
  if (sseg) {
    const sel = (document.getElementById('f-kind') as HTMLSelectElement);
    sel.value = sel.value === sseg.dataset['kind'] ? '' : sseg.dataset['kind']!;
    return renderSlugs(lastSlugs);
  }
});

function setSortDir(dir: string) {
  const b = document.getElementById('sort-dir')!;
  b.dataset['dir'] = dir; b.textContent = dir === 'asc' ? '↑' : '↓';
}
[...FILTER_IDS, 'f-originals', 'f-all']
  .forEach(id => (document.getElementById(id) as HTMLSelectElement).addEventListener('change', () => renderSlugs(lastSlugs)));
document.getElementById('f-all')!.addEventListener('change', (e) => {
  try { localStorage.setItem('sp-show-all', (e.target as HTMLInputElement).checked ? '1' : '0'); } catch {}
});
// Tag dropdown ADDS to the active set (doesn't replace) — that's how one <select> gives the
// lobby's multi-tag behavior. Pills remove on click.
(document.getElementById('f-tag') as HTMLSelectElement).addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.value) { activeTags.add(sel.value); sel.value = ''; renderSlugs(lastSlugs); }
});
document.getElementById('tag-pills')!.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-tag-rm]');
  if (b) { activeTags.delete(b.dataset['tagRm']!); renderSlugs(lastSlugs); }
});
// List / grid view toggle — flips a class on #slugs (same markup, CSS reflow); choice persists.
const viewSeg = document.getElementById('slug-view')!;
function setView(v: string) {
  document.getElementById('slugs')!.classList.toggle('cards', v === 'cards');
  for (const b of viewSeg.querySelectorAll('button')) b.classList.toggle('on', b.dataset['view'] === v);
  try { localStorage.setItem('sp-view', v); } catch {}
}
viewSeg.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('button[data-view]'); if (b) setView(b.dataset['view']!); });
setView((() => { try { return localStorage.getItem('sp-view') || 'list'; } catch { return 'list'; } })());
(document.getElementById('sort-key') as HTMLSelectElement).addEventListener('change', () => {
  setSortDir(NATURAL_DIR[(document.getElementById('sort-key') as HTMLSelectElement).value]!); // sensible default per key
  renderSlugs(lastSlugs);
});
document.getElementById('sort-dir')!.addEventListener('click', () => {
  setSortDir(document.getElementById('sort-dir')!.dataset['dir'] === 'asc' ? 'desc' : 'asc');
  renderSlugs(lastSlugs);
});
document.getElementById('filters-reset')!.addEventListener('click', () => {
  FILTER_IDS.forEach(id => (document.getElementById(id) as HTMLSelectElement).value = '');
  activeTags.clear();
  (document.getElementById('f-originals') as HTMLInputElement).checked = false;
  (document.getElementById('f-all') as HTMLInputElement).checked = false;
  try { localStorage.setItem('sp-show-all', '0'); } catch {}
  (document.getElementById('sort-key') as HTMLSelectElement).value = 'modified';
  setSortDir('desc');
  renderSlugs(lastSlugs);
});

// ---- Boot --------------------------------------------------------------
// Live data only means anything with a running server behind us. Detect the
// environment (this is the kit's vizEnv(), inlined since this standalone page
// doesn't import the module): a static publish (window.__VIZ_STATIC__, stamped
// by viz publish) or an unreachable server → show a "run me locally" placeholder in
// each live region and skip all fetching / auto-refresh. Live → business as usual.
async function vizEnv() {
  if (window.__VIZ_STATIC__) return 'static';
  try { return (await fetch('/_health', { cache: 'no-store' })).ok ? 'live' : 'offline'; }
  catch { return 'offline'; }
}
(async function boot() {
  const env = await vizEnv();
  if (env !== 'live') {
    const why = env === 'static'
      ? "This is a static copy — there's no live server behind it."
      : "The viz server isn't reachable right now.";
    const ph = (what: string) =>
      '<div style="padding:26px 20px; text-align:center; color:var(--muted); line-height:1.7; ' +
      'border:1px dashed var(--border); border-radius:10px; background:var(--panel)">' +
      '🔌 <b style="color:var(--text)">Live only.</b> ' + why + '<br>Run <code>/viz</code> locally and open the ' +
      'self-portrait to see ' + what + ' here.</div>';
    document.getElementById('slug-totals')!.innerHTML = '';
    document.getElementById('git-status')!.textContent = '';
    document.getElementById('slugs')!.innerHTML = ph('your live library');
    document.getElementById('server-info')!.innerHTML = ph('server status');
    document.getElementById('commits')!.innerHTML = ph('recent commits');
    rescanBtn.style.display = 'none';
    // Nothing to search, filter or sort: without this, typing in the search box replaced the
    // "Live only" placeholder with "no viz matches".
    for (const el of document.querySelectorAll<HTMLInputElement>('#slug-search, #slug-controls select, #slug-controls input, #slug-controls button')) el.disabled = true;
    return;
  }
  document.getElementById('git-status')!.textContent = '· git feed loading…';
  restoreFilters();   // must precede the first render, or it renders unfiltered
  loadFast();
  loadCommits();
  loadGit();          // slow feed: once on load (and again after rescan)
  setInterval(loadFast, 5000);
  setInterval(loadCommits, 30000);
})();
