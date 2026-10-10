// Renders spec.json: the hero, what was agreed, and the gate to sign off. Nothing here is task-specific.
import { esc } from "@viz/kit";
import { api, ApiError } from "@viz/kit/api.js";
import type { Routes } from "./contract.js";
import { SpecSchema } from "./spec.schema.js";

type Verdict = "ok" | "kinda" | "fix";
type Entry = { type: string; at?: string; q?: string; opt?: string };
type Feedback = {
  log(e: { type: string; [k: string]: unknown }): Promise<void>;
  send(extra?: { round?: number }): Promise<void>;
  ready: Promise<Entry[]>;
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kit's feedback.ts declares window.vizFeedback in full; this page types only the part it uses
const feedback = (): Feedback | undefined => (window as { vizFeedback?: Feedback }).vizFeedback;

const spec = SpecSchema.parse(await (await fetch("spec.json", { cache: "no-store" })).json());
const signed = spec.signedOffAt !== null;
const items = [...spec.examples, ...spec.assumptions];
const judged = new Map<string, Verdict>();
for (const i of items) if (i.verdict) judged.set(i.id, i.verdict);

// A ✗ or kinda the user sent, which the agent has since answered by rebuilding (spec.revisedAt), goes
// back to "to judge" so the page shows what is theirs to look at again. ✓ stay. Grill's restore asks too.
const handedBack = (all: Entry[]): Set<string> => {
  const revised = spec.revisedAt ?? "";
  const sentAt = all.findLast((e) => e.type === "send" && (e.at ?? "~") < revised)?.at ?? "";
  const last = new Map<string, Entry>();
  for (const e of all) if (e.type === "pick" && e.q) last.set(e.q, e);
  return new Set(
    [...last.values()]
      .filter((e) => e.opt !== "ok" && (e.at ?? "~") < sentAt)
      .map((e) => e.q ?? ""),
  );
};
window.grillSkip = (e, all) => e.type === "pick" && handedBack(all).has(e.q ?? "");

const warn = (e: unknown) => {
  console.warn("spec-viz:", e);
};

const CHOICES = [
  ["ok", "✓", "Right"],
  ["kinda", "~", "Kinda"],
  ["fix", "✗", "Wrong"],
] as const;
// One grill question card per item: grill.ts owns the picking and folding.
const row = (i: { id: string; text: string; visual?: string | undefined }) => {
  const v = judged.get(i.id) ?? "";
  const buttons = CHOICES.map(
    ([opt, k, label]) =>
      `<button type="button" data-pick="${esc(i.id)}:${opt}"${signed ? " disabled" : ""}><span class="opt-label"><span class="k">${k}</span>${label}</span></button>`,
  ).join("");
  return `<div class="q ex ${v}" id="ex-${esc(i.id)}" data-viz-id="${esc(i.id)}" data-label="${esc(i.text)}"><h3><span class="n">${esc(i.id)}</span>${esc(i.text)}</h3>${i.visual ? `<div class="vbox">${i.visual}</div>` : ""}<div class="opts">${buttons}</div></div>`;
};
const should = spec.examples.filter((e) => e.kind === "should");
const shouldnt = spec.examples.filter((e) => e.kind === "shouldnt");
const when = spec.signedOffAt ? new Date(spec.signedOffAt).toLocaleString() : "";

const app = document.querySelector("#app") ?? document.body;
app.innerHTML = `
<header class="top"><h1>${esc(spec.task.title)}</h1>
  <div class="chips"><span class="chip">spec v${spec.version}</span><span class="chip ${signed ? "good" : "warn"}">${signed ? `signed off ${esc(when)}` : "draft: not signed off"}</span></div></header>
${spec.version > 1 && spec.changes.length > 0 ? `<p class="changed">Changed since v${spec.version - 1}: ${esc(spec.changes.at(-1)?.what ?? "")}</p>` : ""}
<section class="frame" id="hero" data-viz-id="hero" data-label="Hero: what is asked and agreed">
  <div class="asked"><small>Asked</small>${esc(spec.ask)}</div>
  <div class="slot" data-viz-id="hero-slot" data-label="Picture of the result">${spec.hero.slot}</div>
  <div class="done">${spec.hero.done.map((d) => `<span>${esc(d)}</span>`).join("")}</div>
  <div class="scope">${esc(spec.hero.scope)}</div>
</section>
<section><h2>I read this as</h2><p class="iread">${esc(spec.ask)}</p></section>
<section><h2>Examples: is each one right?</h2>
  <h3>Should happen</h3>${should.map(row).join("")}
  <h3>Should NOT happen</h3>${shouldnt.map(row).join("")}</section>
<section><h2>Assumptions: did I assume right?</h2>${spec.assumptions.map(row).join("")}</section>
${spec.visuals.map((v) => `<section class="visual" data-viz-id="visual-${esc(v.id)}" data-label="${esc(v.title)}"><h2>${esc(v.title)}</h2><p class="says">${esc(v.says)}</p><div class="vbox">${v.html}</div></section>`).join("")}
${spec.plan.length > 0 ? `<section><h2>What I'd do, in order</h2><div class="steps">${spec.plan.map((p, n) => `<div class="st" data-viz-id="plan-${esc(p.id)}" data-label="${esc(p.step)}"><b>${n + 1}</b> ${esc(p.step)}</div>`).join("")}</div><div class="stepnav"><button type="button" id="st-prev" aria-label="Previous step">◀</button><span id="st-pos"></span><button type="button" id="st-next" aria-label="Next step">▶</button></div></section>` : ""}
<footer class="signbar" id="bar"><span id="bar-msg"></span><span class="acts"><button type="button" id="send-fix" hidden>Send corrections</button><button type="button" id="sign" disabled>Sign off</button></span></footer>`;

const $ = (s: string) => document.querySelector<HTMLElement>(s);
const sign = document.querySelector<HTMLButtonElement>("#sign");
const sendFix = document.querySelector<HTMLButtonElement>("#send-fix");
const msg = $("#bar-msg");

function refresh() {
  const count = (v: Verdict) => items.filter((i) => judged.get(i.id) === v).length;
  const ok = count("ok");
  const off = count("kinda") + count("fix");
  const left = items.length - ok - off;
  if (signed) {
    if (msg)
      msg.textContent = `Signed off ${when}. Changing your mind re-opens it as v${spec.version + 1}.`;
    if (sign) sign.hidden = true;
    return;
  }
  if (msg)
    msg.textContent = off
      ? `${off} not right yet: pin a comment on each (Alt-click it, or the 🎙 💬 pill), then Send corrections`
      : left
        ? `${ok} of ${items.length} agreed · ${left} to judge · 🔒`
        : "Everything agreed: ready to sign off";
  if (sign) sign.disabled = !(ok === items.length);
  if (sendFix) sendFix.hidden = off === 0;
}

function paint(id: string) {
  const r = document.querySelector(`#ex-${CSS.escape(id)}`);
  if (!r) return;
  r.classList.remove("ok", "kinda", "fix");
  const v = judged.get(id);
  if (v) r.classList.add(v);
}

// grill.ts logs the pick and folds the card; this only keeps the verdicts for the gate.
const verdictOf = (opt: string | undefined): Verdict | undefined =>
  opt === "ok" || opt === "kinda" || opt === "fix" ? opt : undefined;
document.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-pick]") : null;
  const [id, opt] = (b?.dataset["pick"] ?? "").split(":");
  const v = verdictOf(opt);
  if (!id || !v || signed || !items.some((i) => i.id === id)) return;
  judged.set(id, v);
  paint(id);
  refresh();
});

// Verdicts survive a reload: replay the log, latest pick per item wins. A signed spec uses its saved ones.
if (!signed) {
  const restore = (all: Entry[]) => {
    const again = handedBack(all);
    for (const id of again) document.querySelector(`#ex-${CSS.escape(id)}`)?.classList.add("again");
    for (const e of all) {
      const v = verdictOf(e.opt);
      if (e.type !== "pick" || !e.q || !v || again.has(e.q) || !items.some((i) => i.id === e.q))
        continue;
      judged.set(e.q, v);
      paint(e.q);
    }
    refresh();
  };
  const whenReady = () => {
    feedback()?.ready.then(restore).catch(warn);
  };
  if (feedback()) whenReady();
  else addEventListener("viz-feedback:ready", whenReady, { once: true });
}

const { post } = api<Routes>();
const vizId = location.pathname.replaceAll(/^\/|\/$/gu, "");
const mark = { ok: "✓", kinda: "kinda", fix: "✗" } as const;
sendFix?.addEventListener("click", () => {
  const off = items.filter((i) => judged.get(i.id) && judged.get(i.id) !== "ok");
  const words = `Corrections sent on the spec page (v${spec.version}). Not right yet:\n${off.map((i) => `- ${mark[judged.get(i.id) ?? "fix"]} ${i.id}: ${i.text}`).join("\n")}\n\nWhat they said about each is pinned on its card: run \`viz feedback ${vizId}\`, revise spec.json, rebuild, and hand it back.`;
  // The widget logs the send; the page also tells Kelpie, which puts it in the agent's pane now.
  Promise.all([
    feedback()?.send({ round: spec.version }),
    post("/sent", { body: { words } }),
  ]).catch(warn);
});

async function signOff() {
  if (!sign) return;
  sign.disabled = true;
  const words = `Signed off from the spec page (v${spec.version}). Every example and assumption was agreed:\n${items.map((i) => `- ✓ ${i.text}`).join("\n")}`;
  try {
    await post("/signoff", { body: { words, verdicts: Object.fromEntries(judged) } });
    location.reload();
  } catch (e) {
    if (msg)
      msg.textContent =
        e instanceof ApiError
          ? `Not signed off: ${JSON.stringify(e.body)}`
          : `Not signed off: ${String(e)}`;
    sign.disabled = false;
  }
}
sign?.addEventListener("click", () => {
  signOff().catch(warn);
});

const steps = [...document.querySelectorAll<HTMLElement>(".st")];
let cur = 0;
function showStep(n: number) {
  cur = (n + steps.length) % steps.length;
  steps.forEach((s, i) => {
    s.classList.toggle("on", i === cur);
  });
  const pos = $("#st-pos");
  if (pos) pos.textContent = `${cur + 1} / ${steps.length}`;
}
if (steps.length > 0) {
  $("#st-prev")?.addEventListener("click", () => showStep(cur - 1));
  $("#st-next")?.addEventListener("click", () => showStep(cur + 1));
  showStep(0);
}
refresh();

// The cards exist now, so the shared grill scripts (static in index.html, waiting on <body data-grill-late>) can wire them.
dispatchEvent(new Event("grill:start"));
