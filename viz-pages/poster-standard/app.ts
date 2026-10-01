import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "WALK THE TREE",
    rows: [["tools/*/README.md", "5 found", "ok"], ["skills/*/SKILL.md", "36 found", "ok"],
           ["rascaltwo-ai-setup: block", "41 owned", "ok"]],
    lede: "No registry. Anything whose frontmatter carries the manifest block <b>is</b> an owned thing — so a skill added in a hurry cannot hide from the check." },
  { t: "RESOLVE THE SLUG",
    rows: [["ttyimgspool → tool-ttyimgspool", "found", "ok"], ["viz → skill-viz", "found", "ok"],
           ["omnissa-horizon-vdi", "no poster", "bad"]],
    lede: "Tries <code>&lt;kind&gt;-&lt;name&gt;</code> then both prefixes, so a thing that changes kind does not silently lose its page. Anything unresolved is reported, not skipped." },
  { t: "EXTRACT THE BEATS",
    rows: [["data-beat=\"why\"", "index 0", "ok"], ["data-beat=\"using\"", "index 1", "ok"],
           ["data-beat=\"limits\"", "index 2", "ok"], ["data-beat=\"where\"", "index 3", "ok"],
           ["data-beat=\"how\"", "index 4", "ok"]],
    lede: "Attributes only. The checker has read no heading text at any point, and never will — that is what keeps the prose yours." },
  { t: "ASSERT THE ORDER",
    rows: [["first why < first using", "0 < 1", "ok"], ["first limits < first where", "2 < 3", "ok"],
           ["repeats allowed", "3× how", "ok"], ["interleaving", "rejected", "bad"]],
    lede: "Order is judged on <b>first</b> appearance, so a beat may be split across sections but the beats themselves cannot braid together." },
  { t: "CROSS-CHECK THE MANIFEST",
    rows: [["state: true", "poster names the dir", "ok"], ["state: false", "poster claims none", "ok"],
           ["state-owner: r2-sdlc", "exempt", "ok"], ["declared but unnamed", "fail", "bad"]],
    lede: "The one check with an opinion about content. Two descriptions of one fact always drift, so the poster is asserted against the frontmatter rather than trusted." },
  { t: "EXIT",
    rows: [["with a poster", "38", "ok"], ["without", "3", "bad"], ["exit code", "1", "bad"]],
    lede: "Non-zero while anything fails, so it can gate a commit. <code>--fix-list</code> prints just the names, which is what you hand an agent." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "check" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
