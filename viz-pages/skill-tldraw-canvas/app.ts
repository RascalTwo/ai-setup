import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "PROBE THE TRANSPORT",
    rows: [["GET /agent/room/probe-does-not-exist", "404 + JSON = present", "ok"], ["HTML back", "wrong HOST, not no API", "bad"],
           ["/health non-200", "server parked", "bad"], ["nothing known", "ask, never guess", "ok"]],
    lede: "The web app is an SPA that answers <code>200</code> + index.html for any path, so HTML from a probe means you hit the wrong host. Try the sync host before giving up on HTTP." },
  { t: "PICK AND READ THE BOARD",
    rows: [["GET /agent/room/:id", "{viewers, pages, shapes, bindings}", "ok"], [".pages[0].id", "the parentId you need", "ok"],
           ["shapes without shape:ai-", "confirm before adding", "bad"], ["viewers > 0", "humans are watching", "bad"]],
    lede: "Read before you write, always. <code>viewers</code> is the only thing that tells you whether every intermediate state is being watched — and the browser transport can't tell you at all." },
  { t: "PLAN THE GEOMETRY",
    rows: [["grid coordinates, listed", "every shape", "ok"], ["arrow route vs bounding boxes", "checked", "ok"],
           ["children inside their frame", "checked", "ok"], ["writing it out ≠ applying it", "the real failure", "bad"]],
    lede: "Sizing over HTTP is a heuristic — 2-line rect 260×110, diamond 320×200 — because nothing measures text. Background furniture is bounded by the region it annotates, never the layout's extent." },
  { t: "BUILD",
    rows: [["shape:ai- prefix", "on every id", "ok"], ["arrow = 3 records", "shape + 2 bindings", "ok"],
           ["bad prop over HTTP", "400 lists the valid enums", "ok"], ["__td newId()", "random, not deterministic", "bad"]],
    lede: "Records are identical across transports; how much of each you write is not. The prefix holds everywhere — <b>deterministic</b> ids are yours to supply, and that is what makes a rebuild an overwrite." },
  { t: "VERIFY — TWO ORACLES",
    rows: [["every shape exists", "records", "ok"], ["every arrow has 2 bindings", "records", "ok"],
           ["no bounding boxes overlap", "your arithmetic", "ok"], ["does the text fit?", "pixels only", "bad"]],
    lede: "Records are the oracle for <b>what exists</b>; pixels for <b>how it lays out</b>. An authoritative read echoes your own numbers back, so an overflowing label reads perfectly clean." },
  { t: "REPORT AND HAND BACK",
    rows: [["board link", "given", "ok"], ["what was made + count", "given", "ok"],
           ["'clean up'", "removes shape:ai- only", "ok"], ["undo", "also works", "ok"]],
    lede: "The board belongs to the user. The prefix is what makes \"clean up\" an exact operation rather than a page clear — and it is the only thing standing between a tidy-up and somebody's afternoon." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "build" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
