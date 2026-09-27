// pr-viz.js — renders plan.json as a narrated film (the default) or a review document
// (hash {"mode":"review"}). One set of scenes, two ways to read them: the film plays them
// with narration; the review page lays the same scenes out with the transcript, the full
// diff, and "agreed" / "reviewed" checkboxes. Every scene links to its twin in the other mode.
//
// Scene kinds and their fields: pr-viz/reference/scenes.md.

import { $, $$, esc, loadHash, saveHash } from "/_kit/viz.js";
import { film } from "/_kit/film.js";

const plan = await fetch("plan.json").then((r) => r.json());
const diff = await fetch("hunks.json").then((r) => (r.ok ? r.json() : { files: [] }), () => ({ files: [] }));
// Add-on output (addons/, written by build.ts when the change has Python code / PDF fixtures).
const callgraphs = await fetch("callgraph.json").then((r) => (r.ok ? r.json() : { graphs: [] }), () => ({ graphs: [] }));
const fixtures = await fetch("fixtures.json").then((r) => (r.ok ? r.json() : { fixtures: {} }), () => ({ fixtures: {} }));
const ptName = (x) => String(x).replace(/[^\w.-]/g, "_");

// Acceptance criteria ("behaviors" is the older name for the same list).
const criteria = plan.criteria ?? plan.behaviors ?? [];
const hunkById = new Map(diff.files.flatMap((f) => f.hunks.map((h) => [h.id, h])));

// ---- syntax highlighting (highlight.js, the viz kit's pick — reference/assets/code-highlighting.md) ----
// A hunk is highlighted as one text, so a docstring spanning lines colours correctly, then split
// back into lines with every open <span> closed at each line end and reopened on the next.
const HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0";
document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${HLJS}/styles/atom-one-dark.min.css">`);
await new Promise((ok) => document.head.append(Object.assign(document.createElement("script"), { src: `${HLJS}/highlight.min.js`, onload: ok, onerror: ok })));
const LANG = { py: "python", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", go: "go", rs: "rust",
  java: "java", kt: "kotlin", rb: "ruby", cs: "csharp", php: "php", sh: "bash", bash: "bash", yml: "yaml", yaml: "yaml", json: "json",
  toml: "ini", ini: "ini", md: "markdown", css: "css", scss: "scss", html: "xml", xml: "xml", sql: "sql", tf: "ini", dockerfile: "dockerfile" };
const langOf = (file) => LANG[(/\.([\w]+)$/.exec(file)?.[1] ?? file.split("/").pop()).toLowerCase()];
function splitBalanced(html) {
  const out = [], stack = [];
  let cur = "";
  for (const t of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+/g) ?? []) {
    if (t === "\n") { out.push(cur + "</span>".repeat(stack.length)); cur = stack.join(""); }
    else if (t.startsWith("<span")) { stack.push(t); cur += t; }
    else if (t === "</span>") { stack.pop(); cur += t; }
    else cur += t;
  }
  return [...out, cur];
}
const codeOf = new Map(); // hunk id → highlighted line HTML, same order as h.lines
function code(h, k) {
  if (!codeOf.has(h.id)) {
    const lang = langOf(h.file), text = h.lines.map((l) => l[3]).join("\n");
    const html = window.hljs && lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : esc(text);
    codeOf.set(h.id, splitBalanced(html));
  }
  return codeOf.get(h.id)[k] ?? "";
}
// One numbering on screen — the file as it will be. A removed line shows no number (its old
// one is in data-old, for pointers: "-42"), so "-62 +88" never reads as two different files.
const lineHTML = (h, l) => `<span class="l ${l[0] === "+" ? "add" : l[0] === "-" ? "del" : ""}"${l[0] === "-" ? ` data-old="${l[1]}"` : ""}><em>${l[0] === "-" ? "" : l[2] ?? ""}</em><i>${l[0] === " " ? " " : l[0]}</i>${code(h, h.lines.indexOf(l)) || " "}</span>`;
const mode = loadHash().mode === "review" ? "review" : "film";
document.title = `${plan.pr?.number ? `#${plan.pr.number} ` : ""}${plan.pr?.title ?? "Change review"}`;

// Pointer marks in say lines: "[finds every link](L40-41)" is spoken as "finds every link" while
// lines 40–41 light up; "(@name)" points at an element with data-pt="name" instead.
const MARK = /\[([^\]]+)\]\(([^)]+)\)/g;
const spoken = (line) => line.replace(MARK, "$1");

// Inline markup for every text field: **strong**, `code`, {{c:concept-id|words}} (a glossary hover).
const md = (s = "") => esc(String(s))
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\{\{c:([\w-]+)\|([^}]+)\}\}/g, (_, id, t) => `<abbr title="${esc(plan.concepts?.[id] ?? "")}">${t}</abbr>`)
  .replace(MARK, "<u>$1</u>")
  .replace(/\n/g, "<br>");
const tone = (t) => (t ? ` tone-${t}` : "");
// The kit keeps page state in the hash as JSON (saveHash/loadHash); mode links use the same.
const hashFor = (obj) => "#" + encodeURIComponent(JSON.stringify(obj));
const go = (obj) => { location.hash = hashFor(obj).slice(1); location.reload(); };

// ---- beats: every say line (or tour entry) is one beat, numbered across the whole film ----
let next = 1;
const scenes = (plan.scenes ?? []).map((s, i) => {
  const lines = s.kind === "tour" ? (s.entries ?? []).map((e) => e.say) : (s.say ?? []);
  const sc = { ...s, i, lines, b0: next };
  if (s.kind === "tour") {
    const n = (s.entries ?? []).reduce((a, e) => a + (e.hunks ?? [e.hunk]).length, 0);
    sc.heading ??= "Diff tour";
    sc.subheading ??= `every changed line of code · all ${n} production hunks, in ${lines.length} steps`;
  }
  next += lines.length;
  return sc;
});

/**
 * When an item appears: on the scene's `line` (0-based) if given, else item i on line i while
 * lines last. Items that share a line queue up on it, 0.7s apart, in the order they're drawn.
 */
function at(s, i, line, extra = 0) {
  const l = line ?? Math.min(i, s.lines.length - 1);
  s.slots ??= {};
  const k = (s.slots[l] = (s.slots[l] ?? -1) + 1);
  return `data-b="${s.b0 + l}" data-d="${(0.3 + 0.7 * k + extra).toFixed(2)}"`;
}

// ---- word diff for compare: unchanged words muted, changed words marked ----
function wordDiff(a, b) {
  // Words, whitespace and punctuation are separate tokens, so "Rectangle." vs "Rectangle (url)."
  // marks only the added "(url)", not the word next to it.
  // (Sentence punctuation only at a word's end — a URL's dots stay inside the URL.)
  const tok = (x) => String(x).split(/(\s+|[()[\]"']|[.,;:!?](?=\s|$))/).filter((t) => t !== "");
  const A = tok(a), B = tok(b);
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const left = [], right = []; // [token, changed]
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { left.push([A[i++], false]); right.push([B[j++], false]); }
    else if (j < B.length && (i >= A.length || L[i][j + 1] >= L[i + 1][j])) right.push([B[j++], true]);
    else left.push([A[i++], true]);
  }
  // One highlight per changed phrase: glue (a space, a comma) between two changes joins the run,
  // so the mark never breaks mid-phrase; then each run is one <del>/<ins>.
  const runs = (side, tag) => {
    const glue = (t) => /^(\s+|[.,;:!?()[\]"'])$/.test(t);
    side.forEach((x, k) => { if (!x[1] && glue(x[0]) && side[k - 1]?.[1] && side.slice(k + 1).find((y) => !glue(y[0]) || y[1])?.[1]) x[1] = true; });
    let out = "", open = false;
    for (const [t, ch] of side) {
      if (ch && !open) { out += `<${tag}>`; open = true; }
      if (!ch && open) { out += `</${tag}>`; open = false; }
      out += md(t);
    }
    return out + (open ? `</${tag}>` : "");
  };
  return [runs(left, "del"), runs(right, "ins")];
}

// ---- renderers: one HTML string per kind, identical in both modes ----
const R = {
  statement: (s) => `<div class="k-statement"><div class="big" ${at(s, 0)}>${md(s.big)}</div>${s.sub ? `<div class="sub" ${at(s, 0, 0)}>${md(s.sub)}</div>` : ""}
    <div class="chips">${(s.chips ?? []).map((c, i) => `<span ${at(s, i + 1)}>${md(c)}</span>`).join("")}</div></div>`,

  compare: (s) => `<div class="k-compare">${(s.rows ?? []).map((r, i) => {
    const [l, rt] = wordDiff(r.before ?? "", r.after ?? "");
    return `<div class="row" data-pt="${i + 1}" ${at(s, i, r.at)}>${r.label ? `<div class="lbl">${md(r.label)}</div>` : ""}
      <div class="pair"><div class="side before"><span class="tag">${md(s.beforeLabel ?? "Before")}</span><div class="txt">${l || "<i>(nothing)</i>"}</div></div>
      <div class="side after" ${at(s, i, r.at, 0.8)}><span class="tag">${md(s.afterLabel ?? "After")}</span><div class="txt">${rt || "<i>(nothing)</i>"}</div></div></div>
      ${r.note ? `<div class="note">${md(r.note)}</div>` : ""}</div>`;
  }).join("")}</div>`,

  chat: (s) => `<div class="k-chat">${(s.messages ?? []).map((m, i) => `<div class="bubble ${m.who === "q" ? "q" : "a"}" ${at(s, i, m.at)}>${md(m.text)}${m.badge ? ` <span class="badge${tone(m.tone)}">${md(m.badge)}</span>` : ""}</div>`).join("")}</div>`,

  pipeline: (s) => `<div class="k-pipeline">${(s.rows ?? []).map((r, ri) => {
    const prev = new Set(s.rows[ri - 1]?.steps ?? []), nxt = new Set(s.rows[ri + 1]?.steps ?? []);
    const cls = (st) => (ri > 0 ? (prev.has(st) ? "same" : "new") : nxt.size && !nxt.has(st) ? "old" : "same");
    // group: { label, from, to } — a dashed box around steps from..to (0-based), e.g. the two
    // steps an old library call did inside itself, labelled with that call.
    const g = r.group;
    return `<div class="prow" ${at(s, ri, r.at)}><div class="plbl">${md(r.label ?? "")}</div><div class="steps">${r.steps.map((st, k) =>
      `${k && !(g && k === g.from) ? '<span class="ar">→</span>' : ""}${g && k === g.from ? `${k ? '<span class="ar">→</span>' : ""}<span class="grp"><span class="glbl">${md(g.label)}</span>` : ""}<span class="step ${cls(st)}" data-step="${esc(st)}">${md(st)}</span>${g && k === g.to ? "</span>" : ""}`).join("")}</div>${r.note ? `<div class="note">${md(r.note)}</div>` : ""}</div>`;
  }).join("")}<svg class="links"></svg></div>`,

  rules: (s) => `<div class="k-rules">${(s.rows ?? []).map((r, i) => `<div class="rrow" data-pt="${i + 1}" ${at(s, i, r.at)}><div class="name">${md(r.name)}</div>
    <div class="in">${md(r.in)}</div><div class="to">→</div><div class="out">${md(r.out)}</div>${r.test ? `<div class="test">✓ ${md(r.test)}</div>` : ""}</div>`).join("")}</div>`,

  bars: (s) => {
    const max = Math.max(...(s.rows ?? []).map((r) => r.parts.reduce((a, p) => a + p.n, 0)), s.limit?.n ?? 0, 1);
    // limit: a dashed threshold across every bar ({ n, label }), e.g. a size cap a change can cross.
    const lim = (first) => (s.limit ? `<span class="limit" style="left:${(s.limit.n / max) * 100}%">${first ? `<b>${md(s.limit.label ?? String(s.limit.n))}</b>` : ""}</span>` : "");
    return `<div class="k-bars">${(s.rows ?? []).map((r, i) => `<div class="brow" data-pt="${i + 1}" ${at(s, i, r.at)}><div class="blbl">${md(r.label)}${r.sub ? `<small>${md(r.sub)}</small>` : ""}</div>
      <div class="btrack">${r.parts.map((p) => `<span class="bar${tone(p.tone)}" style="--w:${(p.n / max) * 100}%">${md(p.text ?? String(p.n))}</span>`).join("")}${lim(i === 0)}</div>${r.tag ? `<div class="btag">${md(r.tag)}</div>` : ""}</div>`).join("")}
      ${s.legend ? `<div class="legend" ${at(s, (s.rows ?? []).length)}>${s.legend.map((l) => `<span><i class="bar${tone(l.tone)}"></i>${md(l.text)}</span>`).join("")}</div>` : ""}
      ${s.note ? `<div class="bnote" ${at(s, (s.rows ?? []).length + 1)}>${md(s.note)}</div>` : ""}</div>`;
  },

  cards: (s) => `<div class="k-cards">${(s.items ?? []).map((c, i) => `<div class="card${tone(c.tone)}" data-pt="${i + 1}" ${at(s, i, c.at)}>${c.badge ? `<span class="badge${tone(c.tone)}">${md(c.badge)}</span>` : ""}<b>${md(c.title)}</b><div>${md(c.body ?? "")}</div></div>`).join("")}</div>`,

  steps: (s) => `<div class="k-steps"><div class="line" ${at(s, 0)}></div><div class="nodes">${(s.nodes ?? []).map((n, i) => `<div class="node${tone(n.tone)}" data-pt="${i + 1}" ${at(s, i, n.at)}><i></i><b>${md(n.title)}</b><small>${md(n.sub ?? "")}</small></div>`).join("")}</div>
    ${s.items ? `<div class="k-cards small">${s.items.map((c, i) => `<div class="card${tone(c.tone)}" ${at(s, i + (s.nodes ?? []).length, c.at)}><b>${md(c.title)}</b><div>${md(c.body ?? "")}</div></div>`).join("")}</div>` : ""}</div>`,

  checklist: (s) => `<div class="k-check">${(s.items ?? []).map((c, i) => `<div ${at(s, i)}>${md(c)}</div>`).join("")}${s.stamp ? `<div class="stamp" ${at(s, (s.items ?? []).length)}>${md(s.stamp)}</div>` : ""}</div>`,

  // Trace: every acceptance criterion, what proves it, and how well — built from plan.criteria.
  trace: (s) => `<div class="k-trace">${criteria.map((b, i) => `<div class="trow st-${b.status ?? "tested"}" data-pt="${esc(b.id)}" ${at(s, i)}>
    <span class="bid">${esc(b.id)}</span><span class="btitle">${md(b.title)}</span>
    <span class="ev">${(b.proof ?? []).map((p) => `<span>${md(p)}</span>`).join("")}${b.gap ? `<span class="gap">${md(b.gap)}</span>` : ""}</span></div>`).join("")}</div>`,

  // The diff tour: one entry per beat, each fading out as the next arrives. An entry shows
  // one hunk, or several: identical bodies (a helper copied into three modules) are drawn once
  // and labelled with every file; different ones stack.
  tour: (s) => {
    const entries = s.entries ?? [], total = entries.length;
    const changed = (h) => h.lines.filter((l) => l[0] !== " ").map((l) => l[0] + l[3].trim()).filter((x) => x.length > 1);
    // Same code in several files (a helper copied per module): drawn once, labelled with every
    // file; anything a copy changes beyond the shared code is shown under it, so nothing hides.
    const sameCode = (a, b) => { const A = new Set(changed(a)), B = changed(b); const hit = B.filter((x) => A.has(x)).length;
      return hit >= 0.8 * Math.min(A.size, B.length) && hit > 2; };
    // On film, only the changed lines and one line either side ("⋯" marks a gap).
    const trim = (h, only) => { const keep = h.lines.map((l, j) => (only ? only.has(l) : h.lines.slice(Math.max(0, j - 1), j + 2).some((x) => x[0] !== " ")));
      const out = []; let gap = false;
      h.lines.forEach((l, j) => { if (keep[j]) { if (gap && out.length) out.push(null); out.push(l); gap = false; } else gap = true; });
      return out; };
    const pre = (h, rows) => `<pre>${rows.map((l) => (l === null ? `<span class="l gap">⋯</span>` : lineHTML(h, l))).join("")}</pre>`;
    return `<div class="k-tour">${entries.map((e, i) => {
      const hs = (e.hunks ?? [e.hunk]).map((id) => hunkById.get(id)).filter(Boolean);
      const groups = [];
      for (const h of hs) { const g = groups.find((g) => sameCode(g[0], h) || sameCode(h, g[0])); g ? g.push(h) : groups.push([h]); }
      return `<div class="hunk" data-b="${s.b0 + i}" data-d="0.1"${i < total - 1 ? ` data-x="${s.b0 + i + 1}"` : ""}>
        <div class="hhead">${i + 1} / ${total}</div>
        ${groups.map((g, gi) => {
          const rep = g.reduce((a, b) => (changed(b).length > changed(a).length ? b : a)), shared = new Set(changed(rep));
          // Another change in the file just shown: no second header (that read as a second file) —
          // a gap marker saying how much is skipped, and which function this change is in.
          const prev = groups[gi - 1];
          if (g.length === 1 && prev?.length === 1 && prev[0].file === rep.file) {
            // Counted from the lines actually on screen, so the numbers either side agree with it.
            const shown = (h) => trim(h).filter((l) => l && l[2]).map((l) => l[2]);
            const end = Math.max(...shown(prev[0])), next = Math.min(...shown(rep));
            return `<div class="hgap">⋯ lines ${end + 1}–${next - 1} not shown${rep.header ? ` · in <code>${esc(rep.header.replace(/:$/, ""))}</code>` : ""} ⋯</div>${pre(rep, trim(rep))}`;
          }
          const also = groups.slice(gi + 1).filter((x) => x.length === 1 && x[0].file === rep.file).length;
          const extra = g.filter((h) => h !== rep).map((h) => {
            // Blank lines are shared by nature — only a copy's real extra lines count as its own.
            const own = new Set(h.lines.filter((l) => l[0] !== " " && l[3].trim() && !shared.has(l[0] + l[3].trim())));
            return own.size ? `<div class="hfile only"><span class="file">only in ${esc(h.file)}</span></div>${pre(h, trim(h, own))}` : "";
          }).join("");
          return `<div class="hfile"><span class="file">${[rep, ...g.filter((h) => h !== rep)].map((x) => esc(x.file)).join("<br>")}</span>${g.length > 1 ? `<span class="same">same code in ${g.length} files</span>` : also ? `<span class="same">${also + 1} changes in this file</span>` : ""}<span class="stat">+${rep.add} −${rep.del}</span></div>
          ${pre(rep, trim(rep))}${extra}`;
        }).join("")}
        <div class="say">${md(e.say)}</div></div>`;
    }).join("")}</div>`;
  },

  // Flow: something passes through a step and loses (or keeps) parts of itself — v1's page →
  // index → answer, as a kind. In from.text, [[words|detail]] marks a token (a link's words and
  // its URL). to.mode "drop": details strike through and collapse out as the arrow fires, and
  // the result keeps only the words; "keep": they carry across, green. Beats: line 0 the source,
  // line 1 the arrow and result, line 2 the question/answer (fewer lines compress onto the last).
  flow: (s) => {
    const TOK = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
    const line = (k) => s.b0 + Math.min(k, s.lines.length - 1);
    const keep = s.to?.mode === "keep";
    let i = 0;
    // The source shows the details only when losing them is the point ("drop"); a kept one is
    // as hidden on the page as a real link's URL, and appears only on the other side.
    const from = md(s.from?.text ?? "").replace(TOK, (_, w, d) => { const k = i++;
      if (keep) return `<a class="lnk">${w}</a>`;
      return `<a class="lnk">${w}</a><span class="drop" data-b="${line(0)}" data-d="${(1.2 + 0.2 * k).toFixed(2)}"${keep ? "" : ` data-fx="${line(1)}" data-fd="${(0.9 + 0.1 * k).toFixed(2)}"`}><span class="url">${d}</span></span>`; });
    const to = md(s.from?.text ?? "").replace(TOK, (_, w, d) => (keep ? `${w} <span class="url">(${d})</span>` : w));
    const a = s.ask;
    return `<div class="k-flow${keep ? " keep" : ""}">
      <div class="flow">
        <div class="card" data-pt="from" data-b="${line(0)}" data-d="0.2">${s.from?.label ? `<div class="lbl">${md(s.from.label)}</div>` : ""}<p>${from}</p></div>
        <div class="arrow" data-b="${line(1)}" data-d="0.3">→${s.via ? `<small>${md(s.via)}</small>` : ""}</div>
        <div class="card" data-pt="to" data-b="${line(1)}" data-d="1.2">${s.to?.label ? `<div class="lbl">${md(s.to.label)}</div>` : ""}<p class="${keep ? "" : "mut"}">${to}</p>${s.to?.badge ? `<div class="tobadge"><span class="badge${tone(s.to.tone)}">${md(s.to.badge)}</span></div>` : ""}</div>
      </div>
      ${a ? `<div class="k-chat">${a.q ? `<div class="bubble q" data-pt="q" data-b="${line(2)}" data-d="0.2">${md(a.q)}</div>` : ""}<div class="bubble a" data-pt="a" data-b="${line(2)}" data-d="${a.q ? 1.2 : 0.3}">${md(a.a)}${a.badge ? ` <span class="badge${tone(a.tone)}">${md(a.badge)}</span>` : ""}</div></div>` : ""}
      ${s.cards ? `<div class="k-cards flowcards">${s.cards.map((c, k) => `<div class="card${tone(c.tone)}" data-pt="card${k + 1}" data-b="${line(c.at ?? 2)}" data-d="${(0.3 + 2.6 * k).toFixed(2)}">${c.badge ? `<span class="badge${tone(c.tone)}">${md(c.badge)}</span>` : ""}<b>${md(c.title)}</b><div>${md(c.body ?? "")}</div></div>`).join("")}</div>` : ""}
    </div>`;
  },

  // Call graph (python_callgraph add-on): who reaches the new function — entry points on the
  // left, the new code on the right. Green = changed in this PR, amber = unchanged but now reaches
  // new behaviour (the blast radius a reviewer can't see in the diff). One graph per helper.
  callgraph: (s) => `<div class="k-callgraph">${(s.helpers ?? []).map((name, gi) => {
    const g = callgraphs.graphs.find((x) => x.helper === name);
    if (!g) return `<p class="mut">no call graph for ${esc(name)} — run build.ts with a checkout</p>`;
    const depth = (n) => (n.kind === "helper" ? 0 : n.depth ?? 1), D = Math.max(...g.nodes.map(depth));
    const cols = Array.from({ length: D + 1 }, (_, c) => g.nodes.filter((n) => depth(n) === D - c));
    const mod = (p) => (p ?? "").split("/")[1] ?? "";
    const tests = Object.values(g.tests ?? {}).reduce((a, t) => a + new Set(t.map((x) => x[0])).size, 0);
    return `<div class="cg" data-cg="${gi}" ${at(s, gi)}><div class="cgcols">${cols.map((col) => `<div class="cgcol">${col.map((n) => `<div class="cgnode ${n.kind} ${n.changed ? "changed" : "affected"}" data-node="${esc(n.id)}" data-pt="${ptName(n.kind === "helper" ? n.name : `${mod(n.path)}.${n.name}`)}">
        <b>${esc(n.name)}</b><small>${n.kind === "helper" ? `same code in ${n.copies.length} modules` : esc(mod(n.path))}</small></div>`).join("")}</div>`).join("")}</div>
      <svg class="cgedges" data-edges='${esc(JSON.stringify(g.edges.map((e) => [e.from, e.to])))}'></svg>
      <div class="cgfoot">${tests} tests reach it · <span class="changed">■</span> changed here <span class="affected">■</span> unchanged, now reaches new code</div></div>`;
  }).join("")}</div>`,

  // PDF fixture (pdf_fixtures add-on): the real test file's page, with its real link rectangles
  // and URLs, and the entries that are malformed. What the tests feed the code, visibly.
  fixture: (s) => `<div class="k-fixture">${(s.pages ?? []).map((ref, i) => {
    const fx = fixtures.fixtures[ref.file], pg = fx?.pages?.[(ref.page ?? 1) - 1];
    if (!pg) return `<p class="mut">no fixture ${esc(ref.file)} p${ref.page ?? 1} — run build.ts with a checkout</p>`;
    const [cx0, cy0, cx1, cy1] = pg.crop, cw = cx1 - cx0, ch = cy1 - cy0, k = pg.dpi / 72, [mx0, , , my1] = pg.mediabox;
    const pct = (px, py) => [((px - cx0) / cw) * 100, ((py - cy0) / ch) * 100];
    const rects = pg.annots.map((a, j) => { const [l, t] = pct((a.rect[0] - mx0) * k, (my1 - a.rect[3]) * k), [r, b] = pct((a.rect[2] - mx0) * k, (my1 - a.rect[1]) * k);
      return `<div class="fxlink" data-pt="${ptName(ref.file)}-link${j + 1}" style="left:${l}%;top:${t}%;width:${r - l}%;height:${b - t}%"><span>${j + 1}</span></div>`; }).join("");
    // URLs go in a numbered legend under the page — labels on the page would cover its own text.
    const legend = pg.annots.map((a, j) => `<span><i>${j + 1}</i>${esc(a.uri) || "<em>no URI</em>"}</span>`).join("");
    return `<div class="fxpage" ${at(s, i, ref.at)}><div class="fxhead"><code>${esc(ref.file)}</code> page ${ref.page ?? 1}${fx.copies.length > 1 ? ` · identical in ${fx.copies.length} modules` : ""}</div>
      <div class="fximg" style="aspect-ratio:${cw}/${ch}"><img data-fetch="${esc(pg.png)}" style="left:${(-cx0 / cw) * 100}%;top:${(-cy0 / ch) * 100}%;width:${(pg.size[0] / cw) * 100}%">${rects}</div>
      ${legend ? `<div class="fxlegend">${legend}</div>` : ""}
      ${pg.malformed.length ? `<div class="fxbad" data-pt="${ptName(ref.file)}-malformed">${pg.malformed.map((m) => `<span>✕ ${esc(m.kind)}${m.detail ? ` ${esc(m.detail)}` : ""}</span>`).join("")}</div>` : ""}</div>`;
  }).join("")}</div>`,

  // Custom: an HTML fragment (+ optional module) for the one visual a PR needs. Inside it,
  // data-r="k" means "appear on this scene's k-th line" (0-based); data-rx="k" fades out there.
  custom: (s) => `<div class="k-custom" data-src="${esc(s.html)}"></div>`,
};

// Images the page ships as files (rendered PDF fixtures) load through fetch(), so a single-file
// export (viz:bundle) can answer them; all are in before the film starts, so renders have them.
async function hydrateImages(root) {
  await Promise.all($$("img[data-fetch]", root).map(async (img) => {
    const blob = await fetch(img.dataset.fetch).then((r) => (r.ok ? r.blob() : null), () => null);
    if (blob) { img.src = URL.createObjectURL(blob); await img.decode().catch(() => {}); }
  }));
}

async function hydrateCustom(root) {
  for (const el of $$(".k-custom", root)) {
    const s = scenes[+el.closest("[data-scene]").dataset.scene];
    // Parsed inert first (a <template> loads nothing), then stylesheets and modules go through
    // fetch() — so a single-file export (viz:bundle) can answer them; a live <link> or import()
    // would ask the network for a file that isn't there.
    const tpl = document.createElement("template");
    tpl.innerHTML = await fetch(el.dataset.src).then((r) => r.text());
    for (const l of $$('link[rel="stylesheet"]', tpl.content)) l.replaceWith(Object.assign(document.createElement("style"), { textContent: await fetch(l.getAttribute("href")).then((r) => r.text()) }));
    el.append(tpl.content);
    for (const x of $$("[data-r],[data-rx],[data-rfx]", el)) {
      if (x.dataset.r !== undefined) x.dataset.b = String(s.b0 + +x.dataset.r);
      if (x.dataset.rx !== undefined) x.dataset.x = String(s.b0 + +x.dataset.rx);
      if (x.dataset.rfx !== undefined) x.dataset.fx = String(s.b0 + +x.dataset.rfx);
    }
    if (s.js) {
      const src = await fetch(s.js).then((r) => r.text());
      (await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })))).default?.(el, s, { mode });
    }
  }
}

// Pipeline connectors: a line from each step to the identical step in the next row — "this part
// didn't change" at a glance. Layout offsets, not getBoundingClientRect: rows slide in with a
// transform, and a rect taken mid-slide would bend every line. (.k-pipeline is the offsetParent.)
function drawLinks(root) {
  const pos = (el, pipe) => { let x = 0, y = 0; for (let e = el; e && e !== pipe; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };
  for (const pipe of $$(".k-pipeline", root)) {
    const svg = $("svg.links", pipe), rows = $$(".prow", pipe);
    let paths = "";
    rows.forEach((row, ri) => {
      if (!ri) return;
      for (const st of $$(".step.same", row)) {
        const up = $$(".step", rows[ri - 1]).find((u) => u.dataset.step === st.dataset.step);
        if (!up) continue;
        const a = pos(up, pipe), b = pos(st, pipe);
        const x1 = a.x + a.w / 2, y1 = a.y + a.h + 4, x2 = b.x + b.w / 2, y2 = b.y - 4;
        paths += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}"/>`;
      }
    });
    svg.setAttribute("viewBox", `0 0 ${pipe.offsetWidth} ${pipe.offsetHeight}`);
    svg.innerHTML = paths;
  }
  // Call graph edges: caller's right edge → callee's left edge, same offset measure.
  for (const cg of $$(".k-callgraph .cg", root)) {
    const svg = $("svg.cgedges", cg), node = (id) => $$(".cgnode", cg).find((n) => n.dataset.node === id);
    let paths = "";
    for (const [from, to] of JSON.parse(svg.dataset.edges)) {
      const a = node(from), b = node(to);
      if (!a || !b) continue;
      const p = pos(a, cg), q = pos(b, cg), x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = q.x, y2 = q.y + q.h / 2;
      paths += `<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2 - 6},${y2}"/><path class="head" d="M${x2 - 12},${y2 - 6} L${x2 - 2},${y2} L${x2 - 12},${y2 + 6}"/>`;
    }
    svg.setAttribute("viewBox", `0 0 ${cg.offsetWidth} ${cg.offsetHeight}`);
    svg.innerHTML = paths;
  }
}

// Film mode: scale each scene (and each diff-tour step) to fill the stage without spilling,
// so neither a sparse scene nor a long hunk needs a hand-tuned zoom. plan "zoom" still wins.
function autofit(stage) {
  // Measured at zoom 1, then scaled so the content just fits its box (between 0.5× and max).
  // Content size, not scrollHeight: a box's scrollHeight never reports less than the box, so it
  // can say "too big" but never "room to spare".
  const extent = (el) => Math.max(1, ...[...el.children].map((c) => c.offsetTop + c.offsetHeight));
  // Fit the height; width reflows (text wraps into the narrower zoomed box), so it only
  // matters if something rigid then spills sideways — back off until it doesn't.
  const fit = (el, box, max) => {
    el.style.zoom = "1";
    let z = Math.max(0.5, Math.min(max, box.clientHeight / extent(el)));
    for (;;) {
      el.style.zoom = z.toFixed(2);
      if (z <= 0.5 || (el.scrollWidth <= el.clientWidth + 2 && extent(el) <= box.clientHeight / (el === box ? 1 : z) + 2)) break;
      z -= 0.05;
    }
  };
  for (const sc of $$(".scene", stage)) {
    for (const hk of $$(".k-tour .hunk", sc)) fit(hk, hk.parentNode, 1.25);
    if (sc.dataset.zoom === undefined) fit(sc, sc, 1.4);
  }
}

function sceneHTML(s) {
  const body = (R[s.kind] ?? (() => `<p>unknown scene kind "${esc(s.kind)}"</p>`))(s);
  return `${s.heading === false ? "" : `<h2 data-b="${s.b0}" data-d="0">${md(s.heading ?? s.title)}${s.subheading ? `<small>${md(s.subheading)}</small>` : ""}</h2>`}${body}`;
}

// Pointers: light each mark's target from the moment its words are spoken (Kokoro word timings,
// in the compiled manifest) until the next mark on that line, or the line's end. Targets, comma-
// separated: "L40-41" whole lines · "L69:inline_link_urls" just that text on line 69 · "-42" a
// removed line (old number) · "@name" an element with data-pt; several @names get ONE outline.
// Boxes use ui-narration's highlight look, so films and recordings point the same way.
const pending = []; // boxes to measure once the stage is laid out: [container, rect fn, interval]
const aims = [];    // one per mark: where the cursor goes, and when
// "^" in front of a target means POINT at it (the cursor, aimed at its centre) instead of
// highlighting it. The same thing is never both: highlight a container and point inside it,
// or do one — pointing at what is already lit is just noise.
function targetsOf(spec, box) {
  const lines = [], els = [], subs = [], points = [];
  for (let x of spec.split(",").map((v) => v.trim())) {
    const point = x.startsWith("^");
    if (point) x = x.slice(1);
    if (point) { const t = targetsOf(x, box); points.push(...t.lines, ...t.els, ...t.subs.map(([l, sub]) => ({ line: l, sub }))); continue; }
    if (x.startsWith("@")) { els.push(...$$(`[data-pt="${x.slice(1)}"]`, box)); continue; }
    const [range, sub] = x.split(":");
    const old = range.startsWith("-");
    const [a, b] = range.replace(/^[L-]/, "").split("-").map(Number);
    const nums = new Set(Array.from({ length: (b || a) - a + 1 }, (_, i) => String(a + i)));
    const hit = $$(".l", box).filter((l) => (old ? nums.has(l.dataset.old) : nums.has($("em", l)?.textContent)));
    if (sub) subs.push(...hit.map((l) => [l, sub.trim()])); else lines.push(...hit);
  }
  return { lines, els, subs, points };
}
async function pointers(stage) {
  const manifest = window.__vizTts ?? (await fetch(".tts/manifest.json").then((r) => (r.ok ? r.json() : null), () => null));
  const wordsOf = new Map((manifest?.cues ?? []).filter((c) => c.text && c.words).map((c) => [c.text, c.words]));
  const words = (x) => x.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const add = (el, iv) => (el.dataset.h = [el.dataset.h, iv].filter(Boolean).join(";"));
  for (const s of scenes) s.lines.forEach((line, k) => {
    const marks = [...line.matchAll(MARK)];
    if (!marks.length) return;
    const timed = (wordsOf.get(spoken(line)) ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w[0]));
    if (!timed.length) return; // not compiled yet — the next verify compiles it
    const scene = $(`[data-scene="${s.i}"]`, stage);
    const box = s.kind === "tour" ? $$(".hunk", scene)[k] : scene;
    const beat = s.b0 + k;
    const starts = marks.map((m) => timed[Math.min(timed.length - 1, words(spoken(line.slice(0, m.index))).length)]?.[1] ?? 0);
    marks.forEach((m, j) => {
      const iv = `${beat}:${Math.max(0, starts[j] - 0.1).toFixed(2)}:${j + 1 < marks.length ? `${beat}:${(starts[j + 1] - 0.1).toFixed(2)}` : `${beat + 1}:0`}`;
      const t = targetsOf(m[2], box);
      if (!t.lines.length && !t.els.length && !t.subs.length && !t.points.length) console.error(`pr-viz: pointer "${m[1]}" → ${m[2]} matches nothing in scene "${s.title}"`);
      for (const l of t.lines) add(l, iv);
      if (t.els.length === 1) add(t.els[0], iv);
      if (t.els.length > 1) pending.push({ kind: "union", els: t.els, host: scene, iv });
      for (const [l, sub] of t.subs) {
        if (!l.textContent.includes(sub)) console.error(`pr-viz: pointer "${m[1]}" → "${sub}" isn't on line ${$("em", l)?.textContent || l.dataset.old}`);
        else pending.push({ kind: "sub", line: l, sub, iv });
      }
      // Only pointing targets get the cursor — see aimCursor.
      if (t.points.length) aims.push({ iv, target: t.points[0] });
    });
  });
}
// After layout (and autofit): draw each pending box in its container's own coordinates — offsets
// for element outlines (ignore the slide-in transforms), a text Range for a code fragment.
function drawBoxes() {
  const offset = (el, host) => { let x = 0, y = 0; for (let e = el; e && e !== host; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return { x, y }; };
  for (const b of pending) {
    const div = document.createElement("div");
    b.div = div;
    div.className = "ptbox";
    div.dataset.h = b.iv;
    if (b.kind === "union") {
      const ps = b.els.map((e) => ({ ...offset(e, b.host), w: e.offsetWidth, h: e.offsetHeight }));
      const x = Math.min(...ps.map((p) => p.x)), y = Math.min(...ps.map((p) => p.y));
      Object.assign(div.style, { left: x - 8 + "px", top: y - 8 + "px", width: Math.max(...ps.map((p) => p.x + p.w)) - x + 16 + "px", height: Math.max(...ps.map((p) => p.y + p.h)) - y + 16 + "px" });
      b.host.append(div);
    } else {
      const walker = document.createTreeWalker(b.line, NodeFilter.SHOW_TEXT);
      const text = [];
      for (let n; (n = walker.nextNode());) text.push(n);
      const full = text.map((n) => n.data).join(""), at = full.indexOf(b.sub);
      let seen = 0; const range = document.createRange();
      for (const n of text) {
        if (at >= seen && at < seen + n.length) range.setStart(n, at - seen);
        if (at + b.sub.length > seen && at + b.sub.length <= seen + n.length) range.setEnd(n, at + b.sub.length - seen);
        seen += n.length;
      }
      const lr = b.line.getBoundingClientRect(), k = lr.width / b.line.offsetWidth || 1, rr = range.getBoundingClientRect();
      Object.assign(div.style, { left: b.line.offsetLeft + (rr.left - lr.left) / k - 4 + "px", top: b.line.offsetTop + (rr.top - lr.top) / k - 2 + "px",
        width: rr.width / k + 8 + "px", height: rr.height / k + 4 + "px", borderRadius: "6px", borderWidth: "2px" });
      b.line.parentNode.append(div); // the <pre>, positioned
    }
  }
}

// The cursor: for each mark, the point to glide to, measured with the film sought to that
// moment (so slide-ins have finished and autofit zoom is in) — then the film goes back.
function aimCursor(f, stage) {
  if (!aims.length) return;
  const back = f.timeline.at(), sr = () => stage.getBoundingClientRect();
  const iv = (spec) => { const [b, d, xb, xd] = spec.split(":").map(Number); const B = f.beats;
    return { t: B[b - 1].t0 + d, until: xb - 1 < B.length ? B[xb - 1].t0 + xd : f.timeline.total }; };
  // The centre of what's pointed at: an element's box, a line's text, or a fragment's text.
  const centre = (tg) => {
    let r;
    if (tg.sub !== undefined) {
      const walker = document.createTreeWalker(tg.line, NodeFilter.SHOW_TEXT), text = [];
      for (let n; (n = walker.nextNode());) text.push(n);
      const at = text.map((n) => n.data).join("").indexOf(tg.sub), rg = document.createRange();
      let seen = 0;
      for (const n of text) {
        if (at >= seen && at < seen + n.length) rg.setStart(n, at - seen);
        if (at + tg.sub.length > seen && at + tg.sub.length <= seen + n.length) rg.setEnd(n, at + tg.sub.length - seen);
        seen += n.length;
      }
      r = rg.getBoundingClientRect();
    } else if (tg.classList?.contains("l")) { const rg = document.createRange(); rg.selectNodeContents(tg); const rs = [...rg.getClientRects()]; r = rs[rs.length - 1] ?? tg.getBoundingClientRect(); }
    else r = tg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const frames = [];
  for (const a of aims) {
    const when = iv(a.iv);
    f.seek(when.t + 0.7);
    const [x, y] = centre(a.target), s = sr(), k = s.width / 1920;
    frames.push({ ...when, x: (x - s.left) / k, y: (y - s.top) / k });
  }
  f.seek(back);
  f.setCursor(frames);
}

// ================================ film ================================
if (mode === "film") {
  const stage = document.createElement("div");
  stage.id = "stage";
  stage.innerHTML = scenes.map((s) => `<section class="scene" data-scene="${s.i}" data-title="${esc(s.title)}" data-beats="${s.b0}-${s.b0 + s.lines.length - 1}"${s.zoom ? ` data-zoom style="--z:${s.zoom}"` : ""}>${sceneHTML(s)}</section>`).join("");
  document.body.append(stage);
  await hydrateCustom(stage);
  await hydrateImages(stage);
  await pointers(stage);
  const f = await film();
  autofit(stage);
  drawBoxes();
  f.rescan();
  aimCursor(f, stage); // only marks that point ("^") move the cursor
  const jump = +(loadHash().chapter ?? 0);
  if (jump) { f.seek(f.chapters[jump - 1]?.t0 ?? 0); const { chapter, ...rest } = loadHash(); saveHash({ ...rest, t: f.timeline.at() }); }
  // Opened from review mode's "▶ watch": play at once, and stop at the end of that section.
  const { autoplay, only } = loadHash();
  if (autoplay) f.timeline.play();
  if (only && jump) {
    const end = f.chapters[jump - 1].t0 + f.chapters[jump - 1].dur - 0.45; // before the scene's fade-out
    (function stop() { if (f.timeline.at() >= end) { f.timeline.pause(); f.seek(end); } else requestAnimationFrame(stop); })();
  }
  drawLinks(stage);
  addEventListener("resize", () => drawLinks(stage));
  // Embedded as review mode's section player, the review page is already behind it.
  if (window.top === window) document.body.insertAdjacentHTML("beforeend", `<a id="to-review" data-viz-chrome href="${hashFor({ mode: "review" })}">Review this ↗</a>`);
  if ($("#to-review")) $("#to-review").onclick = (e) => {
    e.preventDefault();
    const ci = f.chapters.findLastIndex((c) => f.timeline.at() >= c.t0 - 0.01);
    go({ mode: "review", scene: Math.max(0, ci) });
  };
}

// =============================== review ===============================
else {
  document.body.classList.add("review-mode");
  const key = `pr-viz:${plan.pr?.repo ?? ""}#${plan.pr?.number ?? ""}@${plan.pr?.head ?? ""}`;
  const state = { reviewed: {}, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  const save = () => { localStorage.setItem(key, JSON.stringify(state)); tally(); };
  const sections = [["why", "Why"], ["what", "What"], ["how", "How"], ["proof", "Proof"], ["risk", "Risk & rollout"], ["verdict", "Verdict"]];
  const watch = (s) => `<a class="watch" data-go='${JSON.stringify({ mode: "film", chapter: s.i + 1 })}' href="${hashFor({ mode: "film", chapter: s.i + 1 })}">▶ watch</a>`;

  const tourHTML = (s) => `<div class="files">${diff.files.map((f) => {
    const entries = new Map((s.entries ?? []).flatMap((e) => (e.hunks ?? [e.hunk]).map((id, k) => [id, k ? "" : e.say])));
    return `<details class="file k-${f.kind}"${f.kind === "prod" ? " open" : ""}><summary><label onclick="event.stopPropagation()"><input type="checkbox" data-reviewed="${esc(f.path)}"${state.reviewed[f.path] ? " checked" : ""}> reviewed</label>
      <span class="fk">${f.kind}</span> <code>${esc(f.path)}</code> <span class="mut">+${f.add} −${f.del}</span></summary>
      ${f.hunks.map((h) => `${entries.get(h.id) ? `<p class="say">${md(entries.get(h.id))}</p>` : ""}<pre>${h.lines.map((l) => lineHTML(h, l)).join("")}</pre>`).join("") || '<p class="mut">binary — not shown</p>'}</details>`;
  }).join("")}</div>`;

  const review = document.createElement("main");
  review.id = "review";
  review.innerHTML = `<header><div class="mut">${esc(plan.pr?.repo ?? "")}${plan.pr?.number ? ` · <a href="${esc(plan.pr.url ?? "#")}">#${plan.pr.number}</a>` : ""}${plan.pr?.head ? ` · head ${esc(String(plan.pr.head).slice(0, 7))}` : ""}</div>
      <h1>${md(plan.pr?.title ?? "Change review")}</h1><div class="bar"><a class="watch big" data-go='{"mode":"film"}' href="${hashFor({ mode: "film" })}">▶ Watch the film</a><span id="tally"></span></div></header>
    ${criteria.length ? `<section class="sec"><h2>Acceptance criteria</h2>${criteria.map((b) => `<div class="beh st-${b.status ?? "tested"}"><b>${esc(b.id)}</b> ${md(b.title)}<span class="proof">${(b.proof ?? []).map((p) => md(p)).join(" · ")}${b.gap ? ` <span class="gap">${md(b.gap)}</span>` : ""}</span></div>`).join("")}</section>` : ""}
    ${sections.map(([id, label]) => {
      const mine = scenes.filter((s) => (s.section ?? "what") === id);
      if (!mine.length) return "";
      return `<section class="sec"><h2>${label}</h2>${mine.map((s) => `<article class="rscene" id="scene-${s.i}" data-scene="${s.i}"><h3>${md(s.title)} ${watch(s)}</h3>
        <div class="frame"><div class="scene">${s.kind === "tour" ? `<h2>${md(s.heading ?? s.title)}</h2>${tourHTML(s)}` : sceneHTML(s)}</div></div>
        ${s.kind === "tour" ? "" : `<blockquote>${s.lines.map(md).join(" ")}</blockquote>`}</article>`).join("")}</section>`;
    }).join("")}`;
  document.body.append(review);
  await hydrateCustom(review);
  await hydrateImages(review);

  function tally() {
    const r = Object.values(state.reviewed).filter(Boolean).length;
    $("#tally").textContent = `${r} / ${diff.files.length} files reviewed`;
  }
  review.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.reviewed) state.reviewed[t.dataset.reviewed] = t.checked;
    save();
  });
  // "▶ watch" plays that section right here, over the page (the click lets the player start with
  // sound: allow="autoplay" hands this page's user gesture to the frame). The big button opens the
  // whole film instead.
  for (const a of $$("a.watch", review)) a.onclick = (e) => {
    e.preventDefault();
    const target = JSON.parse(a.dataset.go);
    if (!target.chapter) return go(target);
    const src = location.pathname + hashFor({ ...target, autoplay: true, only: true });
    document.body.insertAdjacentHTML("beforeend", `<div id="player"><iframe allow="autoplay" src="${src}"></iframe><button title="close (Esc)">✕</button></div>`);
    const close = () => $("#player")?.remove();
    $("#player button").onclick = close;
    $("#player").onclick = (ev) => { if (ev.target.id === "player") close(); };
    addEventListener("keydown", (ev) => ev.key === "Escape" && close(), { once: true });
  };
  // Scenes are drawn for a 1920px stage; the review page scales each one to its column.
  const fit = () => { for (const fr of $$(".frame", review)) fr.style.setProperty("--k", fr.clientWidth / 1920); drawLinks(review); };
  addEventListener("resize", fit);
  fit();
  tally();
  const s = loadHash().scene;
  if (s !== undefined) $(`#scene-${s}`)?.scrollIntoView();
}
