// The fixed frame every PR hero shares. Never edited per PR: hero.json is the text, drawing.ts the picture.
// Timeline (viz's seek contract, reference/timeline.md): 4 s of build, then a 2 s hold on the finished picture.
import { need } from "@viz/kit";
import mount from "./drawing.js";

const BUILD = 4;
const TOTAL = 6;
interface Hero {
  title: string;
  subtitle: string;
  repo: string;
  pr?: number | null;
  branch?: string;
}

// oxlint-disable-next-line typescript/no-unsafe-assignment -- hero.json is this skill's own file
const hero: Hero = await (await fetch("hero.json")).json();
// `code` spans in the title become mono.
need("#title").replaceChildren(
  ...hero.title.split("`").map((s, i) => {
    if (i % 2 === 0) return document.createTextNode(s);
    const c = document.createElement("code");
    c.textContent = s;
    return c;
  }),
);
need("#subtitle").textContent = hero.subtitle;
need("#badge").textContent = hero.pr
  ? `${hero.repo} #${hero.pr}`
  : hero.branch
    ? `${hero.repo} · ${hero.branch}`
    : hero.repo;

const draw = mount(need("#area"));
const stage = need("#stage");
const scrub = need<HTMLInputElement>("#scrub");
const playBtn = need("#play");
const clock = need("#clock");
const fit = () => {
  stage.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
};
addEventListener("resize", fit);
fit();

let cur = 0;
let playing = false;
let last = 0;
const seek = (t: number) => {
  cur = Math.min(TOTAL, Math.max(0, t));
  draw(Math.min(BUILD, cur));
  scrub.value = String(cur);
  clock.textContent = `${cur.toFixed(1)} / ${TOTAL} s`;
};
const tick = (now: number) => {
  if (!playing) return;
  seek(cur + (now - last) / 1000 >= TOTAL ? 0 : cur + (now - last) / 1000);
  last = now;
  requestAnimationFrame(tick);
};
const play = () => {
  playing = true;
  last = performance.now();
  playBtn.textContent = "pause";
  requestAnimationFrame(tick);
};
const pause = () => {
  playing = false;
  playBtn.textContent = "play";
};
playBtn.addEventListener("click", () => (playing ? pause() : play()));
scrub.addEventListener("input", () => {
  pause();
  seek(Number(scrub.value));
});

window.__viz ??= {};
window.__viz.timeline = {
  total: TOTAL,
  seek,
  pause,
  play,
  at: () => cur,
  chapters: [
    { n: 1, title: "Build", t0: 0, dur: BUILD },
    { n: 2, title: "Hold", t0: BUILD, dur: TOTAL - BUILD },
  ],
};
seek(0);
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) play();
else seek(TOTAL);
