// The spec as a short narrated film, played in the page (no mp4). Scenes and words come from script.ts.
import { film } from "@viz/kit/film.js";
import { script } from "./script.js";
import { SpecSchema } from "./spec.schema.js";
import { esc } from "@viz/kit";

const spec = SpecSchema.parse(await (await fetch("spec.json", { cache: "no-store" })).json());
let beat = 0;
const scenes = script(spec).map((s) => {
  const a = beat + 1;
  beat += s.lines.length;
  return { title: s.title, kind: s.kind, lines: s.lines, a, z: beat };
});
const mark = { should: "✓", shouldnt: "✗", plan: "→", ask: "", call: "" };

const body = scenes
  .map((s) => {
    const items =
      s.kind === "ask"
        ? `<div class="frame f-hero"><div class="asked" data-b="${s.a}"><small>Asked</small>${esc(spec.task.title)}</div>
             <div class="slot" data-b="${s.a}" data-d="0.4">${spec.hero.slot}</div>
             <div class="done" data-b="${s.a + 1}"><span>${esc(spec.ask)}</span></div>
             <div class="scope" data-b="${s.z}">${esc(spec.hero.scope)}</div></div>`
        : s.kind === "call"
          ? `<div class="f-call" data-b="${s.a}">${esc(s.lines[0] ?? "")}</div>`
          : s.lines
              .map(
                (l, i) =>
                  `<div class="f-item ${s.kind}" data-b="${s.a + i}"><b>${mark[s.kind]}</b>${esc(l)}</div>`,
              )
              .join("");
    return `<section class="scene" data-title="${esc(s.title)}" data-beats="${s.a}-${s.z}"><h2 class="f-h" data-b="${s.a}">${esc(s.title)}</h2>${items}</section>`;
  })
  .join("");

document.body.classList.add("film");
document.body.innerHTML = `<div id="stage">${body}</div>`;
const css = document.createElement("style");
css.textContent = `
#stage .f-h { font-size: 40px; margin: 0 0 24px; color: var(--muted); letter-spacing: .06em; text-transform: uppercase; }
#stage .f-item { display: grid; grid-template-columns: 56px 1fr; gap: 12px; font-size: 44px; line-height: 1.25; margin: 0 0 22px; padding: 16px 22px; border: 2px solid var(--border); border-radius: 14px; background: var(--panel); }
#stage .f-item b { font-size: 50px; }
#stage .f-item.should { border-color: var(--good); } #stage .f-item.should b { color: var(--good); }
#stage .f-item.shouldnt { border-color: var(--danger); } #stage .f-item.shouldnt b { color: var(--danger); }
#stage .f-item.plan b { color: var(--accent); }
#stage .f-call { font-size: 60px; line-height: 1.3; font-weight: 800; margin-top: 120px; max-width: 1500px; }
#stage .f-hero { max-width: 1760px; aspect-ratio: auto; height: 800px; }
#stage .f-hero .asked { font-size: 52px; }
#stage .f-hero .done { font-size: 34px; }
#stage .f-hero .done span::before { content: ""; }
#stage .f-hero .scope { font-size: 30px; }`;
document.head.append(css);
await film();
