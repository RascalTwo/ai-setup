// explorer.ts: draws the r2-app-stack skill from its own markdown, three ways.
// The parsing is stack-model.ts and the choice of what to look at is stack-lens.ts; both are also
// run by tests/r2-app-stack.test.ts. This file only turns what they return into HTML.
import { need } from "@viz/kit";
import {
  enforcement,
  esc,
  loadStack,
  md,
  sourceUrl,
  type Doc,
  type Flag,
  type Problem,
  type Rule,
  type Section,
  type Stack,
} from "./stack-model.js";
import {
  cellSections,
  checkLens,
  FLOW,
  hitsFor,
  KINDS,
  LAYERS,
  MATRIX,
  needleOf,
  resolveCaption,
  resolveNode,
  tabOfKind,
  TABS,
  toolState,
  type Hit,
  type KindId,
  type LayerId,
} from "./stack-lens.js";

const FLAG_TEXT: Record<Flag, string> = {
  candidate: "candidate",
  "not-decided": "not decided yet",
  "to-be-packaged": "to be packaged",
  "not-enforced": "not enforced yet",
  "to-build": "to build",
};
const FILTERS: Flag[] = ["candidate", "not-decided", "to-be-packaged", "not-enforced", "to-build"];
const ENF_TEXT = {
  gate: "held by a gate",
  human: "held by review",
  none: "not enforced yet",
  unstated: "no enforcement stated",
} as const;

const badge = (f: Flag): string =>
  f === "not-enforced" ? "" : `<span class="bd" data-flag="${f}">${FLAG_TEXT[f]}</span>`;
const base = (file: string): string => file.split("/").pop() ?? file;

// ---------------------------------------------------------------- problems

function problemsHtml(problems: Problem[]): string {
  if (problems.length === 0) return "";
  const items = problems
    .map((p) => {
      const where =
        p.file === "explorer"
          ? "explorer"
          : `<a href="${esc(sourceUrl(p.file, p.line ? { line: p.line } : undefined))}">${esc(p.file)}${p.line ? `:${p.line}` : ""}</a>`;
      return `<li>${where} ${esc(p.message)}</li>`;
    })
    .join("");
  return `<div class="x-problems" role="alert"><b>${problems.length} thing${problems.length === 1 ? "" : "s"} in the skill's files the explorer could not read.</b> What follows may be incomplete.<ul>${items}</ul></div>`;
}

// ---------------------------------------------------------------- cards

function srcLink(file: string, sec: Section, line: number): string {
  const head = sec.level === 1 ? sourceUrl(file) : sourceUrl(file, { anchor: sec.anchor });
  return `<span class="src"><a href="${esc(head)}">${esc(base(file))}${sec.level === 1 ? "" : ` › ${esc(sec.heading)}`}</a><a class="ln" href="${esc(sourceUrl(file, { line }))}">line ${line}</a></span>`;
}

function ruleCard(r: Rule, sec: Section): string {
  const enf = enforcement(r);
  const extras =
    r.extras.length > 0
      ? `<details class="more"><summary>${r.extras.map((x) => esc(x.label)).join(" · ")}</summary>${r.extras.map((x) => `<p><b>${esc(x.label)}.</b> ${md(x.text, r.file)}</p>`).join("")}</details>`
      : "";
  return `<article class="rc" data-enf="${enf}" data-viz-id="rule-${esc(base(r.file))}-${r.line}" data-label="rule at ${esc(base(r.file))} line ${r.line}">
    ${r.flags.map(badge).join("")}
    <p class="rule">${md(r.rule, r.file)}</p>
    <dl>
      <div><dt>Why</dt><dd>${md(r.why, r.file)}</dd></div>
      <div><dt>Sources</dt><dd>${md(r.sources, r.file)}</dd></div>
      <div class="enf"><dt>Enforced</dt><dd><i class="dot" title="${ENF_TEXT[enf]}"></i><span>${r.enforced ? md(r.enforced, r.file) : "not stated"}</span></dd></div>
    </dl>
    ${extras}
    ${srcLink(r.file, sec, r.line)}
  </article>`;
}

function noteCard(
  file: string,
  sec: Section,
  line: number,
  flags: Flag[],
  text: string,
  label = "",
): string {
  const parked = flags.includes("not-decided");
  return `<article class="rc note" data-parked="${parked}">
    ${flags.map(badge).join("")}
    <p class="rule">${label ? `<b>${esc(label)}.</b> ` : ""}${md(text, file)}</p>
    ${srcLink(file, sec, line)}
  </article>`;
}

function hitCard(h: Hit): string {
  if (h.kind === "rule") return ruleCard(h.rule, h.section);
  if (h.kind === "bullet")
    return noteCard(
      h.section.file,
      h.section,
      h.bullet.line,
      h.bullet.flags,
      h.bullet.text,
      h.bullet.label,
    );
  return noteCard(h.section.file, h.section, h.prose.line, h.prose.flags, h.prose.text);
}

// ---------------------------------------------------------------- view 1: the matrix

let picked: { layer: LayerId; kind: KindId; i: number } | undefined;

function ruleCount(stack: Stack, file: string): number {
  return stack.docs[file]?.sections.reduce((n, s) => n + s.rules.length, 0) ?? 0;
}

function matrixHtml(stack: Stack): string {
  const head = KINDS.map((k) => {
    const tab = TABS.find((t) => t.id === tabOfKind(k.id));
    return `<div class="mx-h" role="columnheader"><button type="button" data-tab="${tabOfKind(k.id)}" title="Open all ${esc(k.label)} rules">${esc(k.label)}<small>${tab ? `${ruleCount(stack, tab.file)} rules` : ""}</small></button></div>`;
  }).join("");
  const rows = LAYERS.map((layer) => {
    const cells = KINDS.map((kind) => {
      const c = MATRIX[layer.id][kind.id];
      const tag = `<span class="mx-k">${esc(kind.label)}</span>`;
      if (!c)
        return `<div class="mx-c empty" role="cell">${tag}<span class="none" title="nothing particular to this kind; the shared rules apply">—</span></div>`;
      const chips = c.tools
        .map((t, i) => {
          const st = toolState(hitsFor(stack, c, t));
          const on = picked?.layer === layer.id && picked.kind === kind.id && picked.i === i;
          const flags = st.flags
            .filter((f) => f === "candidate" || f === "to-build")
            .map((f) => `<em>${FLAG_TEXT[f]}</em>`)
            .join("");
          return `<button type="button" class="chip" data-pick="${layer.id}:${kind.id}:${i}" data-enf="${st.enforcement}" aria-pressed="${on}" data-viz-id="chip-${layer.id}-${kind.id}-${i}" data-label="${esc(t.label)}, ${esc(kind.label)}, ${esc(layer.label)}"><i class="dot"></i><span class="t">${esc(t.label)}${t.note ? `<small>${esc(t.note)}</small>` : ""}${flags}</span></button>`;
        })
        .join("");
      return `<div class="mx-c" role="cell">${tag}${chips}</div>`;
    }).join("");
    return `<div class="mx-r" role="row"><div class="mx-l" role="rowheader">${esc(layer.label)}</div>${cells}</div>`;
  }).join("");
  return `<div class="mx" role="table" aria-label="Tools by kind of app and layer"><div class="mx-r mx-head" role="row"><div class="mx-l"></div>${head}</div>${rows}</div>`;
}

function legendHtml(stack: Stack): string {
  const how = stack.docs["SKILL.md"]?.sections.find(
    (s) => s.heading === "How a standard is written",
  )?.prose[0];
  return `<div class="legend">
    <span class="key"><i class="dot" data-enf="gate"></i>held by a gate</span>
    <span class="key"><i class="dot" data-enf="human"></i>held by review</span>
    <span class="key"><i class="dot" data-enf="none"></i>not enforced yet, or only a candidate</span>
    <span class="key"><i class="dot" data-enf="unknown"></i>no enforcement stated</span>
    ${how ? `<p class="how">${md(how.text, "SKILL.md")}</p>` : ""}
  </div>`;
}

function detailHtml(stack: Stack): string {
  const p = picked;
  if (!p) return "";
  const kind = KINDS.find((k) => k.id === p.kind);
  const layer = LAYERS.find((l) => l.id === p.layer);
  const c = MATRIX[p.layer][p.kind];
  const tool = c?.tools[p.i];
  if (!kind || !layer || !c || !tool) return "";
  const hits = hitsFor(stack, c, tool);
  const where = [...new Set(cellSections(stack, c).map((s) => `${base(s.file)} › ${s.heading}`))]
    .map(esc)
    .join(", ");
  return `<div class="detail" data-viz-id="matrix-detail" data-label="rules behind ${esc(tool.label)}">
    <button type="button" class="close" data-close="1">Close</button><h3>${esc(tool.label)} <span>${esc(kind.label)} · ${esc(layer.label)}</span></h3>
    <p class="m">Where the skill says <code>${esc(needleOf(tool))}</code>: ${hits.length} place${hits.length === 1 ? "" : "s"}, in ${where}.</p>
    ${hits.map(hitCard).join("")}
    <button type="button" class="open" data-tab="${tabOfKind(kind.id)}">Read all of ${esc(kind.label)}'s rules</button>
  </div>`;
}

// ---------------------------------------------------------------- view 2: one kind at a time

let tab = "shared";
const filters = new Set<Flag>();

const flagsOfDoc = (d: Doc): Flag[][] =>
  d.sections.flatMap((s) => [
    ...s.rules.map((r) => r.flags),
    ...s.bullets.map((b) => b.flags),
    ...s.prose.map((p) => p.flags),
  ]);

function barHtml(d: Doc): string {
  const rules = d.sections.flatMap((s) => s.rules);
  if (rules.length === 0) return "";
  const n = { gate: 0, human: 0, none: 0, unstated: 0 };
  for (const r of rules) n[enforcement(r)]++;
  const seg = (k: keyof typeof n) =>
    n[k] ? `<span data-enf="${k}" style="flex:${n[k]}" title="${n[k]} ${ENF_TEXT[k]}"></span>` : "";
  return `<div class="enfbar"><div class="bar" role="img" aria-label="${rules.length} rules: ${n.gate} held by a gate, ${n.human} by review, ${n.none} not enforced yet">${seg("gate")}${seg("human")}${seg("none")}${seg("unstated")}</div><p>${rules.length} rules: ${n.gate} held by a gate, ${n.human} by review, ${n.none} not enforced yet${n.unstated > 0 ? `, ${n.unstated} with no enforcement stated` : ""}</p></div>`;
}

function sectionHtml(s: Section, show: (f: Flag[]) => boolean): string {
  if (s.heading === "Contents") return "";
  const rules = s.rules.filter((r) => show(r.flags));
  const bullets = s.bullets.filter((b) => show(b.flags));
  const prose = s.prose.filter((p) => show(p.flags));
  const steps = filters.size === 0 ? s.steps : [];
  if (rules.length + bullets.length + prose.length + steps.length === 0) return "";
  const lede = s.level === 1;
  const title = lede
    ? ""
    : `<h3 id="x-${esc(base(s.file))}-${esc(s.anchor)}">${esc(s.heading)}<a href="${esc(sourceUrl(s.file, { anchor: s.anchor }))}" aria-label="Open ${esc(s.heading)} in ${esc(base(s.file))}">${esc(base(s.file))} ↗</a></h3>`;
  const stepHtml =
    steps.length > 0
      ? `<ol class="steps">${steps.map((st) => `<li><b>${md(st.title, s.file)}</b> ${md(st.text, s.file)}${st.sub.length > 0 ? `<ol>${st.sub.map((x) => `<li>${md(x, s.file)}</li>`).join("")}</ol>` : ""}</li>`).join("")}</ol>`
      : "";
  return `<section class="ksec">
    ${title}
    ${prose.map((p) => (p.flags.length > 0 ? noteCard(s.file, s, p.line, p.flags, p.text) : `<p class="m">${md(p.text, s.file)}</p>`)).join("")}
    ${stepHtml}
    ${rules.map((r) => ruleCard(r, s)).join("")}
    ${s.code.map((c) => `<pre><code>${esc(c.text)}</code></pre>`).join("")}
    ${bullets.map((b) => noteCard(s.file, s, b.line, b.flags, b.text, b.label)).join("")}
  </section>`;
}

function kindsHtml(stack: Stack): string {
  const bar = TABS.map(
    (t) =>
      `<button type="button" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-selected="${t.id === tab}" tabindex="${t.id === tab ? 0 : -1}">${esc(t.label)}</button>`,
  ).join("");
  const cur = TABS.find((t) => t.id === tab) ?? TABS[0];
  const doc = cur ? stack.docs[cur.file] : undefined;
  if (!cur || !doc)
    return `<div class="tabs" role="tablist" aria-label="Kind of app">${bar}</div><p class="x-loading">${esc(cur?.file ?? tab)} did not load.</p>`;
  const route = stack.docs["SKILL.md"]?.routes.find((r) => r.read.includes(cur.file));
  const counts = FILTERS.map((f) => ({
    f,
    n: flagsOfDoc(doc).filter((fl) => fl.includes(f)).length,
  }));
  const chips = counts
    .filter((c) => c.n > 0)
    .map(
      (c) =>
        `<button type="button" class="fchip" data-flag="${c.f}" aria-pressed="${filters.has(c.f)}">${FLAG_TEXT[c.f]} <b>${c.n}</b></button>`,
    )
    .join("");
  const show = (fl: Flag[]) => filters.size === 0 || fl.some((f) => filters.has(f));
  const body = doc.sections.map((s) => sectionHtml(s, show)).join("");
  return `<div class="tabs" role="tablist" aria-label="Kind of app">${bar}</div>
  <div class="kpanel" role="tabpanel" aria-labelledby="tab-${cur.id}" data-viz-id="kind-panel" data-label="${esc(cur.label)} rules">
    <header>
      <h3>${esc(doc.title)}</h3>
      <p class="m">${route ? `Read for ${md(route.building, "SKILL.md")}. ` : cur.hint ? `For “${esc(cur.hint)}”. ` : ""}<a href="${esc(sourceUrl(cur.file))}">${esc(cur.file)} on GitHub ↗</a></p>
      ${barHtml(doc)}
      ${chips ? `<div class="filters"><span>Show only</span>${chips}</div>` : ""}
    </header>
    ${body || `<p class="x-loading">Nothing here matches that filter.</p>`}
  </div>`;
}

// ---------------------------------------------------------------- view 3: the flow

function flowHtml(stack: Stack): string {
  return FLOW.map((lane) => {
    const stages = lane.stages
      .map((nodes, si) => {
        const cards = nodes
          .map((n) => {
            const v = resolveNode(stack, n);
            if (!v) return "";
            return `<div class="node" data-viz-id="node-${lane.id}-${si}" data-label="${esc(v.title)}">
              <h4>${esc(v.title)}</h4>
              <p>${esc(v.body)}</p>
              ${v.flags.map(badge).join("")}
              <a href="${esc(sourceUrl(v.file, { anchor: v.anchor }))}">${esc(base(v.file))} › ${esc(v.anchor.replaceAll("-", " "))}</a>
            </div>`;
          })
          .join("");
        const arrow =
          si === 0
            ? ""
            : `<div class="arrow" data-two="${lane.id === "per-test"}" aria-hidden="true"><svg viewBox="0 0 40 24" width="40" height="24"><path d="M2 12h34M28 4l8 8-8 8"/>${lane.id === "per-test" ? '<path d="M12 4l-8 8 8 8"/>' : ""}</svg></div>`;
        return `${arrow}<div class="stage">${cards}</div>`;
      })
      .join("");
    return `<section class="lane" data-viz-id="lane-${lane.id}" data-label="${esc(lane.title)}"><h3>${esc(lane.title)}</h3><p class="m">${esc(resolveCaption(stack, lane) ?? "")}.</p><div class="stages">${stages}</div></section>`;
  }).join("");
}

// ---------------------------------------------------------------- boot

async function readSkillFile(file: string): Promise<string> {
  const r = await fetch(`skill/${file}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for skill/${file}`);
  const text = await r.text();
  if (/^\s*<(?:!doctype|html)/iu.test(text))
    throw new Error(`skill/${file} came back as a web page, not markdown`);
  return text;
}

export async function startExplorer(): Promise<void> {
  const roots = { stack: need("#x-stack"), kinds: need("#x-kinds"), flow: need("#x-flow") };
  const stack = await loadStack(readSkillFile);
  const problems = [
    ...stack.problems,
    ...(stack.problems.some((p) => p.line === 0) ? [] : checkLens(stack)),
  ];
  const banner = problemsHtml(problems);

  const draw = (): void => {
    roots.stack.innerHTML = `${banner}${legendHtml(stack)}${matrixHtml(stack)}${detailHtml(stack)}`;
    roots.kinds.innerHTML = `${banner}${kindsHtml(stack)}`;
    roots.flow.innerHTML = `${banner}${flowHtml(stack)}`;
  };
  draw();
  if (problems.length > 0) {
    // viz verify fails on a console error, and so does anyone watching the console.
    console.error(
      `r2-app-stack explorer: ${problems.length} problem(s): ${problems.map((p) => `${p.file}:${p.line} ${p.message}`).join("; ")}`,
    );
  }

  const openTab = (id: string): void => {
    tab = id;
    filters.clear();
    draw();
    roots.kinds.scrollIntoView({ block: "start" });
  };
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const t = e.target.closest<HTMLElement>(
      "[data-pick], [data-tab], [data-close], [data-flag].fchip",
    );
    if (!t) return;
    if (t.dataset["close"]) {
      picked = undefined;
      draw();
      return;
    }
    const pick = t.dataset["pick"];
    if (pick) {
      const [layer, kind, i] = pick.split(":");
      const l = LAYERS.find((x) => x.id === layer);
      const k = KINDS.find((x) => x.id === kind);
      if (l && k) picked = { layer: l.id, kind: k.id, i: Number(i) };
      draw();
      document.querySelector<HTMLElement>(`[data-pick="${pick}"]`)?.focus();
      return;
    }
    const target = t.dataset["tab"];
    if (target) {
      if (t.closest(".tabs")) {
        tab = target;
        filters.clear();
        draw();
        document.querySelector<HTMLElement>(`#tab-${target}`)?.focus();
      } else openTab(target);
      return;
    }
    const f = FILTERS.find((x) => x === t.dataset["flag"]);
    if (!f) return;
    if (filters.has(f)) filters.delete(f);
    else filters.add(f);
    draw();
    document.querySelector<HTMLElement>(`.fchip[data-flag="${f}"]`)?.focus();
  });
  roots.kinds.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((x) => x.id === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    tab = next.id;
    filters.clear();
    draw();
    document.querySelector<HTMLElement>(`#tab-${next.id}`)?.focus();
  });
}
