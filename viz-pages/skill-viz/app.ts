import { stepper, $ } from "/_kit/viz.js";

type Status = "ok" | "bad" | "warn";
interface Step { t: string; rows: [string, string, Status][]; lede: string }

const S: Step[] = [
  { t: "CREATE",
    rows: [["viz create flow --local . --from poster-dive", "commands/create.ts", "ok"],
           ["copy the template", "viz-pages/poster-dive/", "ok"],
           ["register the container", "addContainer()", "ok"],
           ["posture", "local · unlisted", "warn"]],
    lede: "<code>lib/create/createViz()</code> copies a template, writes <code>viz:posture</code>/<code>viz:listed</code> as meta tags, and registers the repo's <code>viz-pages/</code> in <code>.discovered.json</code>. A new page starts <b>local</b> and <b>unlisted</b> — always." },
  { t: "SERVE",
    rows: [["bind", "127.0.0.1:5180", "ok"],
           ["allContainers()", "central + bundled + registry", "ok"],
           ["idFor(dir, $HOME)", "the id IS the URL", "ok"],
           ["two repos, one slug", "no collision", "ok"]],
    lede: "One Bun server, many roots. A viz's identity is its path relative to <code>$HOME</code>, so <code>buildSlugMap()</code> can serve a <code>dashboard</code> from two different repos without either shadowing the other." },
  { t: "EDIT → RELOAD",
    rows: [["fs watcher fires", "onFsEvent()", "ok"],
           ["debounce + re-map", "scheduleRebuild()", "ok"],
           ["push to the page", "broadcastReload(id)", "ok"],
           ["the page's end of it", "reloadSnippet()", "ok"]],
    lede: "Saving the file is the whole edit loop. A watcher per container calls <code>onFsEvent()</code>, the slug map rebuilds, and the reload WebSocket pushes to exactly the page that changed." },
  { t: "VERIFY",
    rows: [["drive installed Chrome", "puppeteer-core", "ok"],
           [".verify/latest.png", "written", "ok"],
           ["layout report", "3 findings", "bad"],
           ["mark census", "17 rect · 40 text", "ok"]],
    lede: "<code>verifyViz()</code> renders it for real and reports what eyes miss: text past its box, content clipped by an <code>overflow:hidden</code> ancestor, anything escaping the 1200×630 card. <b>Findings are not taste</b> — someone still has to look at the PNG." },
  { t: "PUBLISH",
    rows: [["viz history / rollback", "git log, scoped", "ok"],
           ["--commit on a clean run", "committed", "ok"],
           ["viz publish", "writes artifacts", "ok"],
           ["deploy", "separate, human", "warn"]],
    lede: "The central library is a git repo, so history and rollback are per-viz for free. <code>--commit</code> only commits a <b>clean</b> run, and <code>viz publish</code> never deploys — that stays a step a human confirms." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const mark: Record<Status, [string, string]> = { ok: ["var(--good)", "✓"], bad: ["var(--danger)", "✗"], warn: ["var(--warn)", "•"] };
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${mark[st][0]};white-space:nowrap">${mark[st][1]} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "viz" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
