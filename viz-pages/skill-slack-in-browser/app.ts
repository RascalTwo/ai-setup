import { arrowMarkers, labelBox, side, stepper, vizAudit, $ } from "@viz/kit";

interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
}

const arrow = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  mk: string,
  col: string,
  dash = "",
): string =>
  `<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" stroke="${col}" stroke-width="1.8" ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#${mk})"/>`;
const tag = (
  x: number,
  y: number,
  txt: string,
  col: string,
  size = 11,
  anchor = "middle",
): string =>
  `<g><text x="${x}" y="${y}" text-anchor="${anchor}" font-family="var(--mono)" font-size="${size}" fill="${col}">${txt}</text></g>`;

/* ─────────────────────────── 1. the card ─────────────────────────── */
const agentC: Node = { x: 0, y: 0, w: 600, h: 80 };
const tabC: Node = { x: 0, y: 150, w: 600, h: 290 };
const chips: Node[] = [0, 1, 2].map((i) => ({ x: 20, y: 200 + i * 80, w: 560, h: 62 }));
const chipText = [
  `<b>1</b> token = <u>localStorage</u>.localConfig_v2<i>…token</i>`,
  `<b>2</b> fetch(<u>'/api/conversations.history'</u>)<i> +cookie</i>`,
  `<b>3</b> { ok, messages } <i>→ map →</i> [{ ts, reactions }]`,
];
const chipTag = ["STAYS INSIDE", "SAME-ORIGIN", "THE ONLY EXIT"];
let c = arrowMarkers();
c += `<g data-viz-id="card-agent" data-label="the agent, outside the tab">
  <rect x="${agentC.x}" y="${agentC.y}" width="${agentC.w}" height="${agentC.h}" rx="14" fill="var(--panel)" stroke="var(--border)"/>
  ${labelBox(agentC, `<div class="cc"><b>AGENT</b> <i>· outside the tab</i><br>javascript_tool( <u>expression</u> )</div>`)}
</g>
<g data-viz-id="card-tab" data-label="the signed-in Slack tab, the trust boundary">
  <rect x="${tabC.x}" y="${tabC.y}" width="${tabC.w}" height="${tabC.h}" rx="16" fill="color-mix(in srgb, var(--accent) 5%, transparent)" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="7 6"/>
</g>
${tag(20, 180, "SIGNED-IN SLACK TAB · page JavaScript", "var(--accent)", 13, "start")}`;
chips.forEach((n, i) => {
  c += `<g data-viz-id="card-chip-${i}" data-label="step ${i + 1} inside the tab">
    <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="var(--panel)" stroke="${i === 0 ? "var(--danger)" : "var(--border)"}"/>
    ${labelBox({ x: n.x, y: n.y, w: n.w - 118, h: n.h }, `<div class="cc">${chipText[i]}</div>`)}
  </g>
  ${tag(n.x + n.w - 14, n.y + n.h / 2 + 4, chipTag[i]!, i === 0 ? "var(--danger)" : i === 2 ? "var(--good)" : "var(--muted)", 11.5, "end")}`;
  const nx = chips[i + 1];
  if (nx) c += arrow({ x: 300, y: n.y + n.h }, { x: 300, y: nx.y }, "ah-accent", "var(--accent)");
});
c += arrow({ x: 140, y: agentC.h }, { x: 140, y: tabC.y }, "ah-accent", "var(--accent)");
c += tag(152, 120, "one expression in", "var(--accent)", 13, "start");
c += arrow({ x: 460, y: tabC.y }, { x: 460, y: agentC.h }, "ah-good", "var(--good)");
c += tag(472, 108, "results out", "var(--good)", 13, "start");
c += tag(472, 130, "token never ✗", "var(--danger)", 13, "start");
$("#cardsvg")!.innerHTML = c;

/* ─────────────────────────── 2. the stepper figure ─────────────────────────── */
const agent: Node = { x: 10, y: 90, w: 150, h: 120 };
const tab: Node = { x: 215, y: 14, w: 370, h: 312 };
const ls: Node = { x: 235, y: 56, w: 150, h: 64 };
const tok: Node = { x: 410, y: 56, w: 155, h: 64 };
const fetchN: Node = { x: 235, y: 146, w: 330, h: 64 };
const proj: Node = { x: 235, y: 236, w: 330, h: 64 };
const slack: Node = { x: 640, y: 90, w: 150, h: 120 };
const verify: Node = { x: 10, y: 20, w: 150, h: 54 };

interface El {
  id: string;
  at: number;
  cur: number[];
  label: string;
  svg: string;
}
const box = (n: Node, stroke: string, fill: string, rx = 10): string =>
  `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;

const els: El[] = [
  {
    id: "agent",
    at: 0,
    cur: [0],
    label: "the agent, outside the tab",
    svg: `${box(agent, "var(--border)", "var(--panel)")}${labelBox(agent, `<div class="nd"><b>AGENT</b>browser tool that can run JS in the page</div>`)}`,
  },
  {
    id: "tab",
    at: 0,
    cur: [0],
    label: "the signed-in Slack tab",
    svg: `<rect x="${tab.x}" y="${tab.y}" width="${tab.w}" height="${tab.h}" rx="14" fill="color-mix(in srgb, var(--accent) 5%, transparent)" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="7 6"/>
      ${tag(tab.x + tab.w / 2, tab.y + 24, "app.slack.com/client/&lt;TEAM&gt;/&lt;CHANNEL&gt;", "var(--accent)", 11)}`,
  },
  {
    id: "nav",
    at: 0,
    cur: [0],
    label: "open the web client, not the archive link",
    svg: `${arrow({ x: agent.x + agent.w, y: 104 }, { x: tab.x, y: 104 }, "ah-accent", "var(--accent)")}${tag(187, 96, "open", "var(--accent)", 10.5)}`,
  },
  {
    id: "expr",
    at: 1,
    cur: [1],
    label: "one JavaScript expression goes in",
    svg: `${arrow({ x: agent.x + agent.w, y: 134 }, { x: tab.x, y: 134 }, "ah-accent", "var(--accent)")}${tag(187, 126, "expr", "var(--accent)", 10.5)}`,
  },
  {
    id: "ls",
    at: 2,
    cur: [2],
    label: "localStorage.localConfig_v2",
    svg: `${box(ls, "var(--border)", "var(--panel)")}${labelBox(ls, `<div class="nd"><b>L22 · STORAGE</b><code>localConfig_v2</code></div>`)}`,
  },
  {
    id: "tok",
    at: 2,
    cur: [2],
    label: "the token, a local variable that stays inside",
    svg: `${arrow(side(ls, "right"), side(tok, "left"), "ah-accent", "var(--accent)")}
      ${box(tok, "var(--danger)", "color-mix(in srgb, var(--danger) 9%, transparent)")}${labelBox(tok, `<div class="nd"><b style="color:var(--danger)">TOKEN</b>never leaves the tab</div>`)}`,
  },
  {
    id: "fetch",
    at: 3,
    cur: [3],
    label: "fetch POST /api/method with the token and the cookie",
    svg: `${arrow(side(tok, "bottom"), { x: side(tok, "bottom").x, y: fetchN.y }, "ah-accent", "var(--accent)")}
      ${box(fetchN, "var(--accent)", "var(--panel)")}${labelBox(fetchN, `<div class="nd"><b>L23-24 · FETCH</b><code>POST /api/conversations.history</code><br>{ token, …params } · credentials: include</div>`)}`,
  },
  {
    id: "slack",
    at: 3,
    cur: [3],
    label: "Slack's web API",
    svg: `${box(slack, "var(--border)", "var(--panel)")}${labelBox(slack, `<div class="nd"><b>SLACK WEB API</b><code>/api/&lt;method&gt;</code></div>`)}
      ${arrow({ x: fetchN.x + fetchN.w, y: 160 }, { x: slack.x, y: 160 }, "ah-accent", "var(--accent)")}${tag(602, 152, "POST", "var(--accent)", 10.5)}
      ${arrow({ x: slack.x, y: 190 }, { x: fetchN.x + fetchN.w, y: 190 }, "ah", "var(--muted)")}${tag(602, 208, "JSON", "var(--muted)", 10.5)}`,
  },
  {
    id: "proj",
    at: 4,
    cur: [4],
    label: "map to ts and reactions, the last expression",
    svg: `${arrow(side(fetchN, "bottom"), { x: side(fetchN, "bottom").x, y: proj.y }, "ah-accent", "var(--accent)")}
      ${box(proj, "var(--good)", "color-mix(in srgb, var(--good) 9%, transparent)")}${labelBox(proj, `<div class="nd"><b style="color:var(--good)">L25-26 · RESULT</b>map → <code>[{ ts, reactions }]</code></div>`)}`,
  },
  {
    id: "out",
    at: 4,
    cur: [4, 5],
    label: "only the projection comes back out",
    svg: `<path d="M ${proj.x} ${proj.y + 32} L 85 ${proj.y + 32} L 85 ${agent.y + agent.h}" fill="none" stroke="var(--good)" stroke-width="1.8" marker-end="url(#ah-good)"/>
      ${tag(96, 246, "results only", "var(--good)", 11, "start")}${tag(96, 264, "no token ✗", "var(--danger)", 11, "start")}`,
  },
  {
    id: "verify",
    at: 5,
    cur: [5],
    label: "verify every write by reading it back",
    svg: `${box(verify, "var(--accent)", "color-mix(in srgb, var(--accent) 12%, transparent)")}${labelBox(verify, `<div class="nd"><b>L30 · VERIFY</b>write, then read it back</div>`)}
      ${arrow(side(verify, "bottom"), { x: side(verify, "bottom").x, y: agent.y }, "ah-accent", "var(--accent)", "3 3")}`,
  },
];

let t = arrowMarkers();
for (const e of els)
  t += `<g class="el" id="el-${e.id}" data-viz-id="${e.id}" data-label="${e.label}">${e.svg}</g>`;
$("#flow")!.innerHTML = t;

const ledes: string[] = [
  "<b>Land in the client (L17-18).</b> Not <code>&lt;workspace&gt;.slack.com/archives/…</code>, which bounces to a “launching the desktop app” page, but <code>app.slack.com/client/&lt;TEAM&gt;/&lt;CHANNEL&gt;</code>. A tab that shows the Slack client is signed in. A login page means the user signs in: the skill cannot.",
  "<b>Send one expression (L19, L29).</b> The browser tool runs JavaScript in the page and returns the value of the last expression. That return value is the only channel back, which is why the skill is strict about what it contains. Use the bare top-level-<code>await</code> form: an async IIFE may return <code>{}</code>.",
  "<b>Read the token inside (L22).</b> <code>JSON.parse(localStorage.getItem('localConfig_v2')).teams['&lt;TEAM&gt;'].token</code> into a local variable. It exists for the length of the expression and is never printed.",
  "<b>Call the API (L23-24).</b> A relative <code>fetch('/api/' + method)</code>, a POST with the token in the form body, and <code>credentials: 'include'</code> so the page's session cookie rides along. Slack answers with JSON that stays in the page.",
  "<b>Return a projection (L25-26).</b> The last expression maps the response down to <code>ts</code> and <code>name:count</code> per reaction. That is what crosses back to the agent: results only. The skill's warning: a token in the result is a leaked credential.",
  "<b>Verify the write (L30).</b> After <code>reactions.add</code>, run <code>conversations.history</code> again and say what the reaction list shows. The projection in step 4 is exactly what makes that cheap: the same snippet is the check.",
];

const lede = $("#lede")!;
const pos = $("#pos")!;
const render = (i: number): void => {
  for (const e of els) {
    const node = $(`#el-${e.id}`)!;
    node.classList.toggle("on", i >= e.at);
    node.classList.toggle("cur", e.cur.includes(i));
  }
  lede.innerHTML = ledes[i]!;
  pos.textContent = `${i + 1} / ${ledes.length}`;
};
const st = stepper({ n: ledes.length, onStep: render, autoplayMs: 4200, hashKey: "flow" });
$("#next")!.addEventListener("click", () => st.next());
$("#prev")!.addEventListener("click", () => st.prev());
const play = $("#play")!;
let on = false;
play.addEventListener("click", () => {
  on = !on;
  if (on) st.play();
  else st.pause();
  play.textContent = on ? "❚❚ pause" : "▶ play";
});
const stopPlay = (): void => {
  on = false;
  play.textContent = "▶ play";
};
for (const el of [$("#next")!, $("#prev")!]) el.addEventListener("click", stopPlay);

vizAudit();
