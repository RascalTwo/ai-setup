import { stepper, arrowMarkers, connect, side, labelBox, $$, esc, need } from "@viz/kit";

/* ════════════════════════════════════════════════════════════════════════════
   Figure 1 — one hero, end to end: the eight steps of SKILL.md, walked over the
   pipeline they build. Nodes are defined once; every arrow derives from them.
   ════════════════════════════════════════════════════════════════════════════ */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Step {
  title: string;
  makes: string;
  refuses: string[];
  code: [string, string][];
  lede: string;
}

const STEPS: Step[] = [
  {
    title: "pin and read",
    makes: "base and head, a checkout at the head, and the idea in one sentence",
    refuses: [
      "drawing before the idea fits in one sentence a stranger could follow",
      "a sentence that names no one helped and nothing that now works",
    ],
    code: [
      [
        "SKILL.md",
        "*Done when* `git diff <base>...<head> --stat` matches what you read and the sentence names who is helped or what now works.",
      ],
    ],
    lede: "The picture is of the idea, so the first job is being able to say it. The surrounding code is part of that reading, not just the diff. The input is a PR (a URL or <code>owner/repo#n</code>) or a local range, and everything after is about exactly those two commits.",
  },
  {
    title: "create from the template",
    makes:
      "a viz folder with <code>index.html</code> and <code>frame.ts</code> (never edited), <code>ramp.ts</code>, <code>hero.json</code> and a starter <code>drawing.ts</code>",
    refuses: [
      "editing <code>index.html</code> or <code>frame.ts</code>: the frame is the same for every PR",
      "going public by accident: the template's posture is <code>local</code> and <code>unlisted</code>",
    ],
    code: [
      ["SKILL.md", 'viz create pr-<n>-<slug> --from "$PRVIZ/template"'],
      [
        "index.html",
        "<!-- Never edit this file. The PR's title/subtitle/badge are hero.json; the picture is drawing.ts. -->",
      ],
      ["index.html", '<meta name="viz:posture" content="local" />'],
    ],
    lede: "The whole template is five small files. Template files are copied per viz, so an existing hero does not pick up a later fix to the frame by itself: copy the changed file over again.",
  },
  {
    title: "fill hero.json",
    makes:
      "the title, one subtitle line and the badge: the only words on the frame that are not in the drawing",
    refuses: [
      "a subtitle that runs past one line: it says who the PR is for or what it does, no more",
    ],
    code: [
      [
        "hero.json",
        '{ "title": "…", "subtitle": "…", "repo": "repo-name", "pr": null, "branch": "feature/branch" }',
      ],
      ["frame.ts", "// `code` spans in the title become mono."],
    ],
    lede: 'The title is the PR\'s title in plain English. With a <code>pr</code> number the badge reads <i>repo #pr</i>; with <code>"pr": null</code> it reads <i>repo · branch</i>, and with no branch just the repo, so a hero can be drawn before the PR exists.',
  },
  {
    title: "draw the idea",
    makes:
      "<code>drawing.ts</code>: a <code>mount(area)</code> that builds the picture once and returns <code>draw(t)</code>, for t from 0 to 4 seconds",
    refuses: [
      "timers, CSS transitions and rAF: the page is seeked, not played, so none of them render",
      "marks under 14 px at 1920 wide, and a picture that needs other text on the page to explain it",
    ],
    code: [
      ["drawing.ts", "export default function mount(area: HTMLElement): (t: number) => void {"],
      [
        "drawing.ts",
        "//   It returns draw(t): t is seconds into the build, 0…4 … draw must be a pure function of t",
      ],
      ["drawing.ts", 'bar?.setAttribute("width", String(1760 * ramp(t, 0.3, 3)));'],
    ],
    lede: "The drawing area is 1760×770 CSS px on the 1920×1080 stage. Every mark gets a <code>data-viz-id</code> and <code>data-label</code>, and viz's own <code>SKILL.md</code> sets the bar: meaning in position, size and colour, not boxes with words in them. At t = 4 the picture must explain the idea by itself.",
  },
  {
    title: "verify",
    makes:
      "a clean <code>viz verify</code> (lint and format included) and a <code>chapters.png</code> of two frames: the end of the build and the end of the hold",
    refuses: [
      "any lint, format or console error: verify exits non-zero",
      "what the two frames show wrong: clipped, overlapping or too-small marks are fixed, then verify runs again",
    ],
    code: [
      [
        "SKILL.md",
        "`viz verify .agents/state/viz/<viz>` until 0 errors (lint and format included), then read `.verify/<viz>/chapters.png`",
      ],
      [
        "frame.ts",
        'chapters: [ { n: 1, title: "Build", t0: 0, dur: BUILD }, { n: 2, title: "Hold", t0: BUILD, dur: TOTAL - BUILD } ]',
      ],
    ],
    lede: "The frame registers a two-chapter timeline, so verify's contact sheet is exactly the two frames that matter. A person reads it: nothing in verify can tell that a picture is clear, only that it renders.",
  },
  {
    title: "make the files",
    makes:
      "<code>&lt;prefix&gt;.hero.png</code> and <code>&lt;prefix&gt;.hero.gif</code> (default prefix <code>~/Desktop/pr-&lt;n&gt;</code>)",
    refuses: [
      "a GIF over 5 MB: it retries at fewer frames, then fewer colours, and fails naming the size",
    ],
    code: [
      ["SKILL.md", 'node "$PRVIZ/scripts/hero.ts" <viz-dir> [--out <prefix>]'],
      ["hero.ts:21", "const MAX_BYTES = 5_000_000;"],
      ["hero.ts:23", "const TRIES = [[20, 256], [10, 256], [10, 128], [10, 64]] as const;"],
    ],
    lede: "The still is the page seeked to the timeline's total with the controls hidden. The GIF is the 6 s timeline rendered at 20 fps by viz's own renderer, then palette-optimised by ffmpeg to 960 px wide. Both come from the same page, so the GIF's last frame is the still.",
  },
  {
    title: "check both",
    makes: "a PNG you have looked at full size, and a GIF whose probe matches the limits",
    refuses: [
      "a PNG that is not 1920×1080, or a GIF that is not 960 px wide, at most 6 s and at most 5 MB",
      "a picture that does not read cleanly",
    ],
    code: [
      [
        "SKILL.md",
        "Read the PNG at full size. `ffprobe` the GIF. *Done when* the PNG is 1920×1080, the GIF is 960 px wide, at most 6 s and at most 5 MB, and the picture reads cleanly.",
      ],
    ],
    lede: "The GIF halves everything, so the check that matters is whether the labels survive at 960 px. A reader will see the GIF, not the PNG: the PNG is for Slack, a deck or a README.",
  },
  {
    title: "hand it over",
    makes: "the two paths, and anything that could not be verified",
    refuses: ["putting it on a PR: pr-viz stops here, and that is r2-pr's job"],
    code: [
      ["SKILL.md", "Putting them on the PR is `r2-pr`'s job."],
      ["body.md:29", "r2-pr:hero ~/.agents/state/r2-pr/acme-shop/agent-fix/pr.hero.gif"],
    ],
    lede: "r2-pr runs this step with <code>--out &lt;state dir&gt;/pr</code>, uploads the GIF with github-attach-media, and <code>body.ts finalize hero=&lt;url&gt;</code> puts it right under Why. If the PR's title changes later, edit <code>hero.json</code> and run <code>hero.ts</code> again.",
  },
];

const N = {
  pin: { x: 8, y: 8, w: 164, h: 54 },
  create: { x: 206, y: 8, w: 164, h: 54 },
  json: { x: 404, y: 8, w: 164, h: 54 },
  draw: { x: 602, y: 8, w: 170, h: 54 },
  page: { x: 404, y: 112, w: 368, h: 62 },
  verify: { x: 206, y: 112, w: 164, h: 62 },
  hero: { x: 8, y: 112, w: 164, h: 62 },
  png: { x: 8, y: 226, w: 222, h: 54 },
  gif: { x: 279, y: 226, w: 222, h: 54 },
  body: { x: 550, y: 226, w: 222, h: 54 },
} satisfies Record<string, Box>;

/** `s`: the step at which it appears. `hot`: the steps that light it. */
const g = (id: string, label: string, s: number, hot: number[], body: string): string =>
  `<g class="el" data-s="${s}" data-hot="${hot.join(",")}" data-viz-id="${id}" data-label="${esc(label)}">${body}</g>`;
const node = (b: Box, title: string, sub: string, dashed = false): string =>
  `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="#0d1017" stroke="var(--border)" ${dashed ? 'stroke-dasharray="5 4"' : ""}/>${labelBox(b, `<div class="nl"><b>${title}</b><span>${sub}</span></div>`, "l")}`;
const arrow = (id: string, d: string, s: number, hot: number[], dashed = false): string =>
  g(
    id,
    `arrow ${id}`,
    s,
    hot,
    `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="1.4" ${dashed ? 'stroke-dasharray="4 4"' : ""} marker-end="url(#ah)"/>`,
  );
const elbow = (a: Box, b: Box): string => {
  const p = side(a, "bottom");
  const q = side(b, "top");
  const mid = (p.y + q.y) / 2;
  return `M ${p.x} ${p.y} V ${mid} H ${q.x} V ${q.y}`;
};

function drawPipeline(): string {
  const items = [
    arrowMarkers({ ah: "var(--muted)" }),
    g(
      "n-pin",
      "pin and read",
      0,
      [0],
      node(N.pin, "1 · pin and read", "the idea, in one sentence"),
    ),
    g(
      "n-create",
      "create from template",
      1,
      [1],
      node(N.create, "2 · viz create", '--from "$PRVIZ/template"'),
    ),
    arrow("a-pin", connect(N.pin, N.create), 1, [1]),
    g("n-json", "hero.json", 2, [2], node(N.json, "3 · hero.json", "title, subtitle, badge")),
    arrow("a-create", connect(N.create, N.json), 2, [2]),
    g("n-draw", "drawing.ts", 3, [3], node(N.draw, "4 · drawing.ts", "the picture, as draw(t)")),
    arrow("a-json", connect(N.json, N.draw), 3, [3]),
    g(
      "n-page",
      "the page: index.html, frame.ts, ramp.ts",
      1,
      [1, 4],
      node(
        N.page,
        "the page: index.html · frame.ts · ramp.ts",
        "the fixed frame, never edited; hero.json and drawing.ts fill it",
        true,
      ),
    ),
    arrow("a-json-page", elbow(N.json, N.page), 2, [2]),
    arrow("a-draw-page", elbow(N.draw, N.page), 3, [3]),
    g(
      "n-verify",
      "viz verify",
      4,
      [4],
      node(N.verify, "5 · viz verify", "0 errors, then read chapters.png"),
    ),
    arrow("a-page", connect(N.page, N.verify), 4, [4]),
    g("n-hero", "hero.ts", 5, [5], node(N.hero, "6 · hero.ts", "the still first, then the GIF")),
    arrow("a-verify", connect(N.verify, N.hero), 5, [5]),
    g("n-png", "hero.png", 5, [5, 6], node(N.png, "hero.png", "1920×1080 · the last frame")),
    g(
      "n-gif",
      "hero.gif",
      5,
      [5, 6],
      node(N.gif, "hero.gif", "4 s build + 2 s hold · 960 px · ≤ 5 MB"),
    ),
    arrow("a-png", elbow(N.hero, N.png), 5, [5, 6]),
    arrow("a-gif", elbow(N.hero, N.gif), 5, [5, 6]),
    g(
      "n-body",
      "the PR body",
      7,
      [7],
      node(N.body, "8 · r2-pr: the PR body", "the GIF, right under Why"),
    ),
    arrow("a-body", connect(N.gif, N.body), 7, [7]),
  ];
  return `<svg viewBox="0 0 780 288" role="img" aria-label="The pr-viz pipeline: hero.json and drawing.ts fill a fixed frame, viz verify checks it, hero.ts makes a still and a GIF, and r2-pr puts the GIF under Why">${items.join("")}</svg>`;
}

function initPipeline(): void {
  const fig = need("#pipefig");
  need("#pipesvg", fig).innerHTML = drawPipeline();
  const svg = need("#pipesvg", fig);
  const snip = need("#snip", fig);
  const makes = need("#makes", fig);
  const refuses = need("#refuses", fig);
  const lede = need("#pipelede", fig);
  const pos = need("#pipepos", fig);
  const render = (i: number): void => {
    const s = STEPS[i];
    if (!s) return;
    for (const el of $$<SVGGElement>(".el", svg)) {
      const at = Number(el.dataset["s"]);
      const hot = (el.dataset["hot"] ?? "").split(",").filter(Boolean).map(Number);
      el.classList.toggle("on", at <= i);
      el.classList.toggle("hot", hot.includes(i));
    }
    snip.innerHTML = s.code
      .map(([f, t]) => `<span class="ln">${esc(f)}</span>${esc(t)}`)
      .join("\n");
    makes.innerHTML = s.makes;
    refuses.innerHTML = s.refuses.map((r) => `<li>${r}</li>`).join("");
    lede.innerHTML = s.lede;
    pos.textContent = `${i + 1} / ${STEPS.length} · ${s.title}`;
  };
  const st = stepper({
    n: STEPS.length,
    onStep: render,
    autoplayMs: 5200,
    hashKey: "pipe",
    target: fig,
  });
  const play = need("#pipeplay", fig);
  const playing = { on: false };
  const label = (): void => {
    play.textContent = playing.on ? "❚❚ pause" : "▶ play";
  };
  play.addEventListener("click", () => {
    playing.on = !playing.on;
    if (playing.on) st.play();
    else st.pause();
    label();
  });
  const stop = (): void => {
    playing.on = false;
    label();
  };
  need("#pipenext", fig).addEventListener("click", () => {
    st.next();
    stop();
  });
  need("#pipeprev", fig).addEventListener("click", () => {
    st.prev();
    stop();
  });
}

initPipeline();

/* ════════════════════════════════════════════════════════════════════════════
   Figure 2 — a drawing is a function of time. The scrubber seeks a tiny draw(t)
   the way the frame does: any t, in any order, gives the same picture, and the
   page clamps t to 4 s, so the 2 s hold is the finished picture.
   ════════════════════════════════════════════════════════════════════════════ */

/** The template's `ramp`: 0 before `a`, 1 after `b`, a smooth S-curve between. */
const ramp = (t: number, a: number, b: number): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

const BUILD = 4;
const TRACK = { x0: 95, x1: 690, y: 138 };
const STOPS: { box: Box; title: string; sub: string }[] = [
  { box: { x: 10, y: 24, w: 170, h: 62 }, title: "request", sub: "what an app asks for" },
  { box: { x: 205, y: 24, w: 170, h: 62 }, title: "check", sub: "does it make sense?" },
  { box: { x: 400, y: 24, w: 170, h: 62 }, title: "filter", sub: "keep what matches" },
  { box: { x: 595, y: 24, w: 175, h: 62 }, title: "result", sub: "the answer, in order" },
];

/** The picture at t seconds: the dot's place along the track decides what is lit. */
function drawScrub(t: number): string {
  const x = TRACK.x0 + (TRACK.x1 - TRACK.x0) * ramp(t, 0.3, 3.2);
  const stops = STOPS.map((s, i) => {
    const reached = x >= s.box.x + s.box.w / 2 - (i === 0 ? 85 : 0);
    const lit = reached ? "var(--accent)" : "var(--border)";
    const op = reached ? 1 : 0.45;
    return `<g data-viz-id="stop-${s.title}" data-label="${esc(s.title)}" opacity="${op}"><rect x="${s.box.x}" y="${s.box.y}" width="${s.box.w}" height="${s.box.h}" rx="8" fill="#0d1017" stroke="${lit}" stroke-width="1.6"/>${labelBox(s.box, `<div class="nl"><b>${s.title}</b><span>${s.sub}</span></div>`, "l")}</g>`;
  }).join("");
  const ticks = STOPS.map((s) => {
    const cx = s.box.x + s.box.w / 2;
    return `<line x1="${cx}" y1="${s.box.y + s.box.h}" x2="${cx}" y2="${TRACK.y}" stroke="var(--border)" stroke-dasharray="3 4"/>`;
  }).join("");
  const done = ramp(t, 3.2, 3.9);
  return `<svg viewBox="0 0 780 176" role="img" aria-label="A tiny drawing at one moment: a dot travelling along a track lights each stop it has passed">
    ${ticks}
    <line x1="${TRACK.x0}" y1="${TRACK.y}" x2="${TRACK.x1}" y2="${TRACK.y}" stroke="var(--border)" stroke-width="2" data-viz-id="track" data-label="the track the dot travels"/>
    <line x1="${TRACK.x0}" y1="${TRACK.y}" x2="${x}" y2="${TRACK.y}" stroke="var(--accent)" stroke-width="3" data-viz-id="progress" data-label="how far the dot has travelled"/>
    <circle cx="${x}" cy="${TRACK.y}" r="9" fill="var(--hl)" data-viz-id="dot" data-label="the dot, placed by t alone"/>
    ${stops}
    <text x="772" y="${TRACK.y + 26}" text-anchor="end" fill="var(--good)" font-family="var(--mono)" font-size="13" opacity="${done}" data-viz-id="done" data-label="the finished picture">✓ finished at t = 4</text>
  </svg>`;
}

function initScrub(): void {
  const fig = need("#scrubfig");
  const slider = need<HTMLInputElement>("#scrub", fig);
  const svg = need("#scrubsvg", fig);
  const pos = need("#scrubpos", fig);
  const note = need("#scrubnote", fig);
  const render = (): void => {
    const now = Number(slider.value);
    const t = Math.min(BUILD, now);
    svg.innerHTML = drawScrub(t);
    pos.textContent = `clock ${now.toFixed(1)} s → draw(${t.toFixed(1)})`;
    note.innerHTML =
      now < BUILD
        ? "Building. <code>draw(t)</code> sets every mark from <code>t</code> alone, so dragging backwards gives exactly the picture you had the first time through."
        : "Holding. The frame passes <code>draw(4)</code> for the last 2 s of the 6, so the picture is the finished still, and the GIF's last frames are the PNG.";
  };
  slider.addEventListener("input", render);
  render();
}

initScrub();
