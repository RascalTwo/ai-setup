// Renders spec.json: the promised demo, what was agreed, and the gate to sign off. Nothing here is task-specific.
import { esc } from "@viz/kit";
import { api, ApiError } from "@viz/kit/api.js";
import type { Routes } from "./contract.js";
import { NO_ONE_CHANGES, noOneChanges } from "./rules.js";
import { SpecSchema, type Spec } from "./spec.schema.js";

type Verdict = "ok" | "kinda" | "fix" | "lost";
type Entry = { type: string; at?: string; q?: string; opt?: string };
type Feedback = {
  log(e: { type: string; [k: string]: unknown }): Promise<void>;
  send(extra?: { round?: number }): Promise<void>;
  settle(): Promise<void>;
  ready: Promise<Entry[]>;
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kit's feedback.ts declares window.vizFeedback in full; this page types only the part it uses
const feedback = (): Feedback | undefined => (window as { vizFeedback?: Feedback }).vizFeedback;

const spec = SpecSchema.parse(await (await fetch("spec.json", { cache: "no-store" })).json());
const signed = spec.signedOffAt !== null;
// A persona is judged like an example (same verdicts, same [P1] anchor); first, so the lock points at it first.
const personas = spec.demo.personas.map((p) => ({ id: p.id, text: p.who, verdict: p.verdict }));
const items = [...personas, ...spec.examples, ...spec.assumptions];
const judged = new Map<string, Verdict>();
// Everything starts ✓: the page asks only the questions, and the user changes what they disagree with.
for (const i of items) judged.set(i.id, i.verdict ?? "ok");
const answers = new Map<string, string>();
for (const q of spec.questions) if (q.answer) answers.set(q.id, q.answer);

// A ✗ or kinda the user sent, which the agent has since answered by rebuilding (spec.revisedAt), goes
// back to "to judge" so the page shows what is theirs to look at again. ✓ stay. Grill's restore asks too.
const handedBack = (all: Entry[]): Set<string> => {
  const revised = spec.revisedAt ?? "";
  const sentAt = all.findLast((e) => e.type === "send" && (e.at ?? "~") < revised)?.at ?? "";
  const last = new Map<string, Entry>();
  for (const e of all) if (e.type === "pick" && e.q) last.set(e.q, e);
  return new Set(
    [...last.values()]
      .filter((e) => e.opt !== "ok" && (e.at ?? "~") < sentAt && items.some((i) => i.id === e.q))
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
  ["lost", "?", "Don't follow"],
] as const;
// A "should NOT happen" card is agreed by agreeing it must not happen, which "Right" read backwards for.
const NOT = {
  ok: "Right: must not happen",
  kinda: "Kinda",
  fix: "Wrong: that's fine",
  lost: "Don't follow",
} as const;
// The prototype loads only when opened. Same origin so the viz server's injected kit loads in it (else CORS errors fail verify).
const tryIt = (id: string, src: string) =>
  `<details class="try"><summary>Try it</summary><iframe src="${esc(src)}" title="Prototype of ${esc(id)}" loading="lazy" sandbox="allow-scripts allow-forms allow-modals allow-same-origin"></iframe></details>`;
// One grill question card per item: grill.ts owns the picking and folding.
const row = (i: {
  id: string;
  kind?: "should" | "shouldnt";
  text: string;
  detail?: string | undefined;
  visual?: string | undefined;
  try?: string | undefined;
  body?: string | undefined; // a persona's before | after, shown under the title in place of detail and picture
}) => {
  const v = judged.get(i.id) ?? "";
  const buttons = CHOICES.map(
    ([opt, k, label]) =>
      `<button type="button" data-pick="${esc(i.id)}:${opt}"${opt === v ? ' class="picked"' : ""}${signed ? " disabled" : ""}><span class="opt-label"><span class="k">${k}</span>${i.kind === "shouldnt" ? NOT[opt] : label}</span></button>`,
  ).join("");
  return `<div class="q ex ${v}" id="ex-${esc(i.id)}" data-viz-id="${esc(i.id)}" data-label="${esc(i.text)}"><h3><span class="n">${esc(i.id)}</span>${esc(i.text)}</h3>${i.body ?? ""}${i.detail ? `<details class="more"><summary>Detail</summary><p>${esc(i.detail)}</p></details>` : ""}${i.visual ? `<div class="vbox">${i.visual}</div>` : ""}${i.try ? tryIt(i.id, i.try) : ""}<div class="opts">${buttons}</div></div>`;
};
// A persona card: what they do today beside what they will do. Today's real capture is shown; "described" says nothing could be.
const personaCard = (p: Spec["demo"]["personas"][number]) =>
  row({
    id: p.id,
    text: p.who,
    body: `<div class="pcols"><div class="pcol before"><small>Today${p.before.capture === "described" ? ' <span class="badge" title="Brand-new work: nothing exists yet to capture">described</span>' : ""}</small><p>${esc(p.before.text)}</p>${p.before.visual ? `<div class="vbox">${p.before.visual}</div>` : ""}</div><div class="pcol after"><small>After</small><p>${esc(p.after.text)}</p></div></div>`,
  });
// A question: real options, none recommended. grill.ts logs the pick and folds it like any card.
const ask = (q: Spec["questions"][number]) => {
  const opts = q.options
    .map(
      (o) =>
        `<button type="button" data-pick="${esc(q.id)}:${esc(o.id)}" data-label="${esc(o.label)}"${answers.get(q.id) === o.id ? ' class="picked"' : ""}${signed ? " disabled" : ""}><span class="opt-label"><span class="k">${esc(o.id)}</span>${esc(o.label)}</span>${o.visual ? `<div class="vbox">${o.visual}</div>` : ""}</button>`,
    )
    .join("");
  return `<div class="q ex" id="ex-${esc(q.id)}" data-viz-id="${esc(q.id)}" data-label="${esc(q.text)}"><h3><span class="n">${esc(q.id)}</span>${esc(q.text)}</h3>${q.detail ? `<details class="more"><summary>Detail</summary><p>${esc(q.detail)}</p></details>` : ""}${q.visual ? `<div class="vbox">${q.visual}</div>` : ""}<div class="opts">${opts}</div></div>`;
};
const should = spec.examples.filter((e) => e.kind === "should");
const shouldnt = spec.examples.filter((e) => e.kind === "shouldnt");
const when = spec.signedOffAt ? new Date(spec.signedOffAt).toLocaleString() : "";

const app = document.querySelector("#app") ?? document.body;
app.innerHTML = `
<header class="top"><h1>${esc(spec.task.title)}</h1>
  <div class="chips"><span class="chip">spec v${spec.version}</span><span class="chip ${signed ? "good" : "warn"}">${signed ? `signed off ${esc(when)}` : "draft: not signed off"}</span></div></header>
${spec.version > 1 && spec.changes.length > 0 ? `<p class="changed">Changed since v${spec.version - 1}: ${esc(spec.changes.at(-1)?.what ?? "")}</p>` : ""}
<section class="demo" id="demo" data-viz-id="demo" data-label="The promised demo: who it changes, before and after">
  <div class="asked"><small>Asked</small>${esc(spec.ask)}</div>
  <div class="scope">${esc(spec.demo.scope)}</div>
  <h2>Who it changes: judge each one</h2>${spec.demo.personas.map(personaCard).join("")}
  <div class="promised" data-viz-id="demo-page" data-label="The promised demo, clickable">
    <h2>The promised demo <a href="${esc(spec.demo.page)}" target="_blank" rel="noopener">open full size</a></h2>
    <iframe src="${esc(spec.demo.page)}" title="The promised demo" loading="lazy" sandbox="allow-scripts allow-forms allow-modals allow-same-origin"></iframe>
  </div>
</section>
<section><h2>I read this as</h2><p class="iread">${esc(spec.ask)}</p></section>
${spec.questions.length > 0 ? `<section><h2>Your call: I'm not sure about these</h2>${spec.questions.map(ask).join("")}</section>` : ""}
<section><h2>Examples: already marked right, change any you disagree with</h2>
  ${spec.demo.personas
    .map(
      (p) =>
        `<h3>${esc(p.id)} · ${esc(p.who)}: the journey</h3>${should
          .filter((e) => e.persona === p.id)
          .map(row)
          .join("")}`,
    )
    .join("")}
  <h3>Should NOT happen</h3>${shouldnt.map(row).join("")}</section>
<section><h2>I assumed these: already marked right, change any you disagree with</h2>${spec.assumptions.map(row).join("")}</section>
${spec.visuals.map((v) => `<section class="visual" data-viz-id="visual-${esc(v.id)}" data-label="${esc(v.title)}"><h2>${esc(v.title)}</h2><p class="says">${esc(v.says)}</p><div class="vbox">${v.html}</div></section>`).join("")}
${spec.plan.length > 0 ? `<section><h2>What I'd do, in order</h2><div class="steps">${spec.plan.map((p, n) => `<div class="st" data-viz-id="plan-${esc(p.id)}" data-label="${esc(p.step)}"><b>${n + 1}</b> ${esc(p.step)}</div>`).join("")}</div><div class="stepnav"><button type="button" id="st-prev" aria-label="Previous step">◀</button><span id="st-pos"></span><button type="button" id="st-next" aria-label="Next step">▶</button></div></section>` : ""}
<footer class="signbar" id="bar"><span id="bar-msg"></span><span class="acts"><button type="button" id="send-fix" hidden>Send corrections</button><select id="when" aria-label="When the build starts"><option value="slot">Start when a slot frees</option><option value="now">Start now</option><option value="hold">Hold until I say</option></select><button type="button" id="sign" aria-disabled="true">Sign off</button></span></footer>`;

const $ = (s: string) => document.querySelector<HTMLElement>(s);
const sign = document.querySelector<HTMLButtonElement>("#sign");
const sendFix = document.querySelector<HTMLButtonElement>("#send-fix");
const startWhen = document.querySelector<HTMLSelectElement>("#when");
const msg = $("#bar-msg");

function refresh() {
  const count = (v: Verdict) => items.filter((i) => judged.get(i.id) === v).length;
  const ok = count("ok");
  const off = count("kinda") + count("fix") + count("lost");
  const left = items.length - ok - off;
  const open = spec.questions.filter((q) => !answers.has(q.id)).length;
  if (signed) {
    if (msg)
      msg.textContent = `Signed off ${when}. Changing your mind re-opens it as v${spec.version + 1}.`;
    if (sign) sign.hidden = true;
    if (startWhen) startWhen.hidden = true;
    return;
  }
  if (msg)
    msg.textContent = noOneChanges(personas, (id) => judged.get(id))
      ? NO_ONE_CHANGES
      : off
        ? `${off} not right yet: pin a comment on each (Alt-click it, or the 🎙 💬 pill), then Send corrections`
        : left || open
          ? `${open ? `${open} question${open === 1 ? "" : "s"} to answer · ` : ""}${left ? `${left} revised card${left === 1 ? "" : "s"} to judge · ` : ""}🔒 (Send corrections works any time)`
          : "Ready to sign off: your comments count, even on cards marked right";
  // Locked, not disabled: a click says what's locking it (pointAtLock) instead of doing nothing.
  sign?.setAttribute("aria-disabled", String(!(ok === items.length && open === 0)));
  // Corrections can go back half-judged (a comment may change the spec before the rest is worth judging).
  if (sendFix) sendFix.hidden = ok === items.length && open === 0;
}

function paint(id: string) {
  const r = document.querySelector(`#ex-${CSS.escape(id)}`);
  if (!r) return;
  r.classList.remove("ok", "kinda", "fix", "lost");
  const v = judged.get(id);
  if (v) r.classList.add(v);
}

// grill.ts logs the pick and folds the card; this only keeps the verdicts for the gate.
const verdictOf = (opt: string | undefined): Verdict | undefined =>
  opt === "ok" || opt === "kinda" || opt === "fix" || opt === "lost" ? opt : undefined;
document.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-pick]") : null;
  if (b?.closest(".q.collapsed")) return; // grill.ts only unfolds it (this listener runs first) and logs nothing
  const [id, opt] = (b?.dataset["pick"] ?? "").split(":");
  if (id && opt && !signed && spec.questions.some((q) => q.id === id)) {
    answers.set(id, opt);
    refresh();
    return;
  }
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
    // A card sent back and rewritten isn't ✓ by default: it's theirs to judge again.
    for (const id of again) {
      judged.delete(id);
      paint(id);
      document.querySelector(`#ex-${CSS.escape(id)}`)?.classList.add("again");
      document.querySelector(`[data-pick="${CSS.escape(id)}:ok"]`)?.classList.remove("picked");
    }
    for (const e of all) {
      if (e.type === "pick" && e.q && e.opt && spec.questions.some((q) => q.id === e.q))
        answers.set(e.q, e.opt);
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
const mark = {
  ok: "✓",
  kinda: "kinda",
  fix: "✗",
  lost: "don't follow (rewrite it plainer)",
} as const;
// Every send reaches the agent: this button, and the 🎙 💬 panel's own Send, which logs the same line and
// fires viz-feedback:sent. The page tells Kelpie on that event, so the agent hears either one now.
const relay = async () => {
  const off = items.filter((i) => judged.get(i.id) && judged.get(i.id) !== "ok");
  const left = items.filter((i) => !judged.get(i.id)).length;
  const picked = spec.questions.filter((q) => answers.has(q.id));
  const words = `Corrections sent on the spec page (v${spec.version}).${noOneChanges(personas, (id) => judged.get(id)) ? " They marked every persona ✗: no one's experience changes, so this task goes back through the gate. Hand back with who you checked and your recommendation; don't close or park it yourself." : ""}${picked.length > 0 ? ` Answered:\n${picked.map((q) => `- ${q.id}: ${q.text} → ${q.options.find((o) => o.id === answers.get(q.id))?.label ?? answers.get(q.id)}`).join("\n")}\n` : ""}${off.length > 0 ? ` Not right yet:\n${off.map((i) => `- ${mark[judged.get(i.id) ?? "fix"]} ${i.id}: ${i.text}`).join("\n")}` : " Nothing marked ✗, kinda or don't follow."}${left > 0 ? `\n${left} not judged yet.` : ""}\n\nWhat they said outranks what they clicked: a comment on a ✓ card is a correction too. Revise spec.json from the answers, picks and what they said (below; \`viz feedback ${vizId} --detail\` adds where they pointed), rebuild, and hand it back.`;
  const reply = await post("/sent", { body: { words } });
  return reply;
};
let relaying = false; // this page's own press relays itself: the viz-feedback:sent it fires mustn't relay again
// The 🎙 💬 panel's own Send still relays fire-and-forget (its receipt is the viz kit's, out of this page's reach).
addEventListener("viz-feedback:sent", () => {
  if (!signed && !relaying) relay().catch(warn);
});
// Send corrections: the agent has it before anything says sent. Kelpie's answer goes in the bar; only then
// is the send logged (which closes the tab). A failed relay logs nothing and leaves the tab open to retry.
async function sendCorrections(lead = ""): Promise<boolean> {
  if (relaying) return false;
  relaying = true;
  if (sendFix) sendFix.disabled = true;
  const f = feedback();
  if (msg) msg.textContent = `${lead}Sending to the agent…`;
  try {
    await f?.settle(); // words still being spoken or transcribed belong to this send
    const { message } = await relay();
    if (msg) msg.textContent = `${lead}${message}`;
    await f?.send({ round: spec.version }).catch((e: unknown) => {
      // The agent has it; only the page's own record of the send failed, so the tab stays open.
      if (msg)
        msg.textContent = `${lead}${message} (Saving the send on the page failed: ${String(e)}.)`;
    });
    return true;
  } catch (e) {
    const why =
      e instanceof ApiError
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- api.ts's refuse() answers {ok, message}
          ((e.body as { message?: string } | null)?.message ?? `HTTP ${e.status}`)
        : String(e);
    if (msg)
      msg.textContent = `${lead}Not sent to the agent: ${why}. Your comments are saved; press Send corrections again.`;
    return false;
  } finally {
    relaying = false;
    if (sendFix) sendFix.disabled = false;
  }
}
sendFix?.addEventListener("click", () => {
  sendCorrections().catch(warn);
});

// A click on a locked Sign off shows what's locking it: the first card (in page order) not yet ✓ or answered.
const said = { kinda: "kinda", fix: "✗", lost: "? (don't follow)" } as const;
function pointAtLock() {
  const why = (id: string): string | undefined => {
    if (spec.questions.some((q) => q.id === id)) return answers.has(id) ? undefined : "unanswered";
    const v = judged.get(id);
    return v === "ok" ? undefined : v ? said[v] : "still to judge";
  };
  const card = [...document.querySelectorAll<HTMLElement>(".q.ex")].find((c) =>
    why(c.dataset["vizId"] ?? ""),
  );
  const id = card?.dataset["vizId"] ?? "";
  if (!card) return;
  card.classList.remove("collapsed");
  const warnColor = getComputedStyle(card).getPropertyValue("--warn");
  card.animate(
    [{ boxShadow: "none" }, { boxShadow: `0 0 0 3px ${warnColor}` }, { boxShadow: "none" }],
    {
      duration: 600,
      iterations: 3,
    },
  );
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  if (msg)
    msg.textContent = noOneChanges(personas, (p) => judged.get(p))
      ? NO_ONE_CHANGES
      : `Sign off is locked: ${id} is ${why(id)}. Mark it ✓, or Send corrections.`;
}

async function signOff() {
  if (!sign) return;
  sign.disabled = true;
  const words = `Signed off from the spec page (v${spec.version}). ${spec.questions.length > 0 ? ` Answered:\n${spec.questions.map((q) => `- ${q.text} → ${q.options.find((o) => o.id === answers.get(q.id))?.label ?? ""}`).join("\n")}\n` : ""}Every persona, example and assumption was agreed (most left as pre-marked):\n${items.map((i) => `- ✓ ${i.text}`).join("\n")}`;
  const f = feedback();
  try {
    await f?.settle(); // a comment still being spoken or transcribed when they pressed belongs to this sign-off
    await post("/signoff", {
      body: {
        words,
        verdicts: Object.fromEntries([...judged, ...answers]),
        when: startWhen?.value ?? "slot",
      },
    });
    close(); // done: the agent reopens the URL if it's needed again
    setTimeout(() => location.reload(), 300); // still here (a tab the browser won't let a page close): show the signed-off state
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) {
      // Comments the agent hasn't read: send them as corrections; it revises and hands the page back.
      const lead = "Not signed off yet: your comments go to the agent first. ";
      if (!(await sendCorrections(lead))) sign.disabled = false;
      return;
    }
    if (msg)
      msg.textContent =
        e instanceof ApiError
          ? `Not signed off: ${JSON.stringify(e.body)}`
          : `Not signed off: ${String(e)}`;
    sign.disabled = false;
  }
}
sign?.addEventListener("click", () => {
  if (sign.getAttribute("aria-disabled") === "true") pointAtLock();
  else signOff().catch(warn);
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
