import { stepper, $ } from "@viz/kit";

type Row = [string, string, "ok" | "bad"];
interface Step {
  t: string;
  rows: Row[];
  lede: string;
}

const S: Step[] = [
  {
    t: "PIN THE FACTS",
    rows: [
      ["real size in mm", "w × h × d, with its source", "ok"],
      ["reference photos", "the owner's own photos win", "ok"],
      ["what photos can't show", "asked: facing, buttons, removable", "ok"],
      ["guessing the size", "refused", "bad"],
    ],
    lede: "Nothing is built until the size has a <b>source</b> and the owner has been asked about what is hidden. In the bakeoff only the owner knew the I/O was on the top panel.",
  },
  {
    t: "WRITE THE BUILD SCRIPT",
    rows: [
      ["build.py", "whole object, exports &lt;name&gt;.glb", "ok"],
      ["glTF conventions", "Y up · metres · front +Z · centred", "ok"],
      ["movable parts", "own named node, own origin", "ok"],
      ["fine detail as geometry", "refused: alpha textures", "bad"],
    ],
    lede: "Run inside Blender through the <b>Blender Lab MCP</b> code tool. Done when the script runs <b>from scratch</b> to a GLB.",
  },
  {
    t: "CHECK IT LIKE THE JUDGE",
    rows: [
      ["scripts/render.py", "Blender headless, shared camera + lights", "ok"],
      ["scripts/score.py", "within_1pct · missing_nodes · budget", "ok"],
      ["close-ups", "of whatever the owner cares about", "ok"],
      ["judging by the scorer alone", "refused", "bad"],
    ],
    lede: "Done when <b>within_1pct</b> is true, <b>missing_nodes</b> is empty, it is under 50k triangles and 5 MB, and the renders match the photos.",
  },
  {
    t: "HAND IT TO THE OWNER",
    rows: [
      ["the render + the score", "shown together", "ok"],
      ["what's wrong?", "asked", "ok"],
      ["declaring it finished", "refused", "bad"],
    ],
    lede: "Every bakeoff model passed the scorer and still had the front buttons on the wrong side. <b>The owner's eye is the real check.</b>",
  },
  {
    t: "CHANGE REQUESTS EDIT THE SCRIPT",
    rows: [
      ["the fix", "an edit to build.py, then step 3 again", "ok"],
      ["NOTES.md", "each change's what and why", "ok"],
      ["regenerating from scratch", "refused", "bad"],
    ],
    lede: "This is what the format buys: a change request took <b>8.1 minutes</b> for the Blender Lab model. A generated mesh could not take one at all.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number) => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2800, hashKey: "flow" });
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
