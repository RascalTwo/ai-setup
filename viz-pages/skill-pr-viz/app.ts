import { stepper, arrowMarkers, connect, side, labelBox, $, $$, esc } from "@viz/kit";

/* ════════════════════════════════════════════════════════════════════════════
   Figure 1 — one PR, end to end: the eight steps of SKILL.md, walked over the
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
    title: "pin the change",
    makes: "base and head SHAs, and a local checkout at the head",
    refuses: [
      "moving on before <code>git diff &lt;base&gt;...&lt;head&gt; --stat</code> matches the PR's file count",
    ],
    code: [
      [
        "SKILL.md",
        "*Done when* `git -C <checkout> diff <base>...<head> --stat` matches the PR's file count.",
      ],
    ],
    lede: "The surrounding code is part of the review, not just the diff, so the skill wants a checkout at the head. Everything after this is about exactly those two SHAs, whether they came from a PR or a local range like <code>main...branch</code>.",
  },
  {
    title: "research",
    makes:
      "an answer, with a source you read, to six questions: why, for whom, how each hunk works, what proves each behaviour, what could break, how it ships",
    refuses: [
      "a caveat that would not change the reviewer's mind: 'not run yet' lists, process trivia",
      "citing a tool the audience cannot check",
    ],
    code: [
      [
        "research.md",
        "PR description, every comment, every review thread — resolved ones too; they hold the decisions.",
      ],
      [
        "research.md",
        "Every hunk, with the code around it — read the whole function and its callers, not just the lines in the diff.",
      ],
      [
        "research.md",
        "A test that asserts less than its name claims is a finding (a `partial` behavior).",
      ],
    ],
    lede: "The first instruction is to research like the reviewer who has to defend the change. That means linked issues followed as far as they go (the why usually lives there, not in the PR), each test read for what it actually asserts, and the repo's own docs and CI. A branch with no PR is the same minus the network: the commit messages are the description.",
  },
  {
    title: "create from the template",
    makes:
      "a viz folder holding <code>pr-viz.ts</code>, <code>pr-viz.css</code> and an <code>index.html</code> you never edit",
    refuses: [
      "editing <code>index.html</code>: everything on it is rendered from <code>plan.json</code>",
      "going public by accident: the template's posture is <code>local</code> and <code>unlisted</code>",
    ],
    code: [
      ["SKILL.md", 'viz create pr-<n>-<slug> --from "$PRVIZ/template"'],
      ["index.html:8", '<meta name="viz:posture" content="local">'],
    ],
    lede: "Template files are copied per viz, so an existing viz does not pick up later template fixes by itself: to update one, copy the two files over again. Anything only this PR needs is a <code>custom</code> scene; a kind several PRs would need belongs in the template.",
  },
  {
    title: "write plan.json",
    makes:
      "acceptance criteria and <code>lookHere</code> first, then scenes in order, a <code>hero</code>, and say lines as the script",
    refuses: [
      "a scene of text in boxes when a form would carry the meaning (it is called 'the last resort')",
      "anything under about 16px at 1080p: split a crowded scene instead of shrinking it",
    ],
    code: [
      ["plan.json", '{ "section": "how", "kind": "tour", "entries": ['],
      ["plan.json", '  { "hunk": "src/jobs/sync.ts#1",'],
      ["plan.json", '    "say": "The sync job now wraps its fetch in [retrying](L2)." } ] }'],
    ],
    lede: "Every <code>say</code> line is one beat, and a beat lasts as long as its spoken clip plus a breath, so timing is never typed: rewrite the line, or split it. <code>[words](L40-41)</code> is spoken as just <i>words</i> and lights up those code lines while they are said. This is the one file a person writes.",
  },
  {
    title: "build",
    makes:
      "<code>hunks.json</code> and <code>narration.json</code> (rewritten only when changed), plus add-on data",
    refuses: [
      "<code>the diff tour misses N production hunk(s)</code>, with each missing hunk's first changed lines, exit 1",
    ],
    code: [
      ["build.ts:89", "const missing = prodHunks.filter((h) => !toured.has(h.id));"],
      ["build.ts:94", "if (missing.length || problems.length) {"],
      [
        "build.ts:124",
        "console.log(`✓ ${cues.length} beats · … · diff tour covers ${toured.size}/${prodHunks.length} production hunks`);",
      ],
    ],
    lede: "The film's claim, 'every changed line of production code was shown', is only worth something if it is enforced, so the build refuses until every production hunk id appears in a tour entry. 'Production' is decided by path (<code>classify.ts</code>): tests, lockfiles, docs and binaries are not required. A <code>package.json</code> bump is production.",
  },
  {
    title: "verify, twice",
    makes:
      "<code>.tts/manifest.json</code> (word timestamps for every line) and a <code>chapter-NN.png</code> frame per scene",
    refuses: [
      "a pointer target that matches nothing: a console error, so verify fails (pr-viz.ts:738)",
      "a bare slug: <code>&lt;viz-id&gt;</code> is the id <code>viz search</code> prints, a bare slug 404s",
    ],
    code: [
      [
        "pr-viz.ts:719",
        'const manifest = window.__vizTts ?? (await fetch(".tts/manifest.json").then(…));',
      ],
      [
        "SKILL.md",
        "`viz verify <viz-id>` twice — the first compiles the narration, the second times every beat to its real clip.",
      ],
    ],
    lede: "The first run has the voice speak every line; the second times each beat to its real clip, which is what makes a highlight start on the exact word. Then every <code>chapter-NN.png</code> is read at full size, because a highlight that skips a space or a clipped glyph is invisible in the tiled sheet. Review mode is verified too, from its full URL, and 'film timeline never registered' is the expected error there.",
  },
  {
    title: "render",
    makes:
      "<code>pr-N.mp4</code>, <code>pr-N.short.mp4</code> with its <code>.vtt</code>, <code>.chapters.txt</code>, a hero, a poster, the walkthrough markdown",
    refuses: [
      "a short cut whose words alone do not answer why, what, and where to look: re-mark the scenes and start it again",
    ],
    code: [
      [
        "SKILL.md",
        'viz render start \'http://127.0.0.1:5180/<viz-id>/#{"cut":"short"}\' --out ~/Desktop/pr-<n>.short.mp4',
      ],
      ["SKILL.md", 'bun "$PRVIZ/scripts/stills.ts" <viz-dir>'],
      ["SKILL.md", 'bun "$PRVIZ/scripts/review-order.ts" <viz-dir>'],
    ],
    lede: "Both renders start as background jobs. The short cut is a fifth of the length, so it finishes first and gets read first, as a stranger would. A render re-times the viz's live narration to the film it shot, so verify runs once more afterwards to put the live page back on the full film.",
  },
  {
    title: "hand it over",
    makes:
      "the films, vtt, hero, poster, walkthrough markdown, the live URL (film, and review through 'Review this ↗'), and whatever could not be verified",
    refuses: ["putting any of it on a PR: pr-viz stops here, and that is r2-pr's job"],
    code: [["SKILL.md", "pr-viz stops here. Putting these on a PR is `r2-pr`'s job."]],
    lede: "r2-pr takes the mp4 (its first frame is the hero), the poster image and the markdown walkthrough, and the plan's four <code>lookHere</code> lines become the PR body's Where to look, word for word.",
  },
];

const N = {
  pin: { x: 8, y: 8, w: 164, h: 54 },
  research: { x: 206, y: 8, w: 164, h: 54 },
  create: { x: 404, y: 8, w: 164, h: 54 },
  plan: { x: 602, y: 8, w: 170, h: 54 },
  build: { x: 602, y: 112, w: 170, h: 62 },
  derived: { x: 404, y: 112, w: 164, h: 62 },
  viz: { x: 206, y: 112, w: 164, h: 62 },
  film: { x: 8, y: 226, w: 222, h: 44 },
  review: { x: 279, y: 226, w: 222, h: 44 },
  poster: { x: 550, y: 226, w: 222, h: 44 },
  tfilm: { x: 8, y: 300, w: 222, h: 78 },
  treview: { x: 279, y: 300, w: 222, h: 78 },
  tposter: { x: 550, y: 300, w: 222, h: 78 },
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
    g("n-pin", "pin the change", 0, [0], node(N.pin, "1 · pin", "PR or range, checkout at head")),
    g("n-research", "research", 1, [1], node(N.research, "2 · research", "reference/research.md")),
    arrow("a-pin", connect(N.pin, N.research), 1, [1]),
    g(
      "n-create",
      "create from template",
      2,
      [2],
      node(N.create, "3 · viz create", '--from "$PRVIZ/template"'),
    ),
    arrow("a-research", connect(N.research, N.create), 2, [2]),
    g("n-plan", "plan.json", 3, [3], node(N.plan, "4 · plan.json", "the one file a person writes")),
    arrow("a-create", connect(N.create, N.plan), 3, [3]),
    g(
      "n-viz",
      "the page: pr-viz.ts",
      2,
      [2, 5],
      node(N.viz, "pr-viz.ts", "mode comes from the #hash", true),
    ),
    arrow("a-tmpl", elbow(N.create, N.viz), 2, [2], true),
    g(
      "n-build",
      "build.ts",
      4,
      [4],
      node(N.build, "5 · build.ts", "refuses until every production hunk is toured"),
    ),
    arrow("a-plan", connect(N.plan, N.build), 4, [4]),
    g(
      "n-derived",
      "derived files",
      4,
      [4],
      node(N.derived, "hunks.json · narration.json", "derived: never edited", true),
    ),
    arrow("a-build", connect(N.build, N.derived), 4, [4]),
    arrow("a-derived", connect(N.derived, N.viz), 4, [4]),
    g(
      "n-film",
      "film mode",
      5,
      [5],
      node(N.film, "film", "the default · #{&quot;cut&quot;:&quot;short&quot;}"),
    ),
    g(
      "n-review",
      "review mode",
      5,
      [5],
      node(N.review, "review", "#{&quot;mode&quot;:&quot;review&quot;}"),
    ),
    g(
      "n-poster",
      "poster mode",
      5,
      [5],
      node(N.poster, "poster", "#{&quot;mode&quot;:&quot;poster&quot;}"),
    ),
    arrow("a-film", elbow(N.viz, N.film), 5, [5]),
    arrow("a-review", elbow(N.viz, N.review), 5, [5]),
    arrow("a-poster", elbow(N.viz, N.poster), 5, [5]),
    g(
      "n-tfilm",
      "film tools",
      6,
      [5, 6, 7],
      node(
        N.tfilm,
        "6 · viz verify ×2 → 7 · render",
        "pr-N.mp4 · .short.mp4 · .vtt · .chapters.txt",
      ),
    ),
    g(
      "n-treview",
      "review tools",
      6,
      [6, 7],
      node(N.treview, "review-order.ts", "walkthrough markdown; reviewed-ticks in localStorage"),
    ),
    g(
      "n-tposter",
      "poster tools",
      6,
      [6, 7],
      node(N.tposter, "stills.ts", "hero.png · poster.png · hero painted on mp4 frame 0"),
    ),
    arrow("a-tfilm", connect(N.film, N.tfilm), 6, [6]),
    arrow("a-treview", connect(N.review, N.treview), 6, [6]),
    arrow("a-tposter", connect(N.poster, N.tposter), 6, [6]),
  ];
  return `<svg viewBox="0 0 780 392" role="img" aria-label="The pr-viz pipeline: research feeds plan.json, build.ts derives hunks.json and narration.json, and pr-viz.ts renders them as film, review page or poster">${items.join("")}</svg>`;
}

function initPipeline(): void {
  const fig = $("#pipefig")!;
  $("#pipesvg", fig)!.innerHTML = drawPipeline();
  const svg = $("#pipesvg", fig)!;
  const snip = $("#snip", fig)!;
  const makes = $("#makes", fig)!;
  const refuses = $("#refuses", fig)!;
  const lede = $("#pipelede", fig)!;
  const pos = $("#pipepos", fig)!;
  const render = (i: number): void => {
    const s = STEPS[i]!;
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
  const play = $("#pipeplay", fig)!;
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
  $("#pipenext", fig)!.addEventListener("click", () => {
    st.next();
    stop();
  });
  $("#pipeprev", fig)!.addEventListener("click", () => {
    st.prev();
    stop();
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   Figure 2 — the reviewed-tick. pr-viz.ts l.870-877, run for real: a SHA-1 of
   each file's changed lines (sign + text, per hunk; no line numbers, no
   context), stored with the tick. Push things at it and watch which ticks hold.
   ════════════════════════════════════════════════════════════════════════════ */

type Sign = "+" | "-" | " ";
type Row = [Sign, number | null, number | null, string];
interface FileDiff {
  path: string;
  hunks: Row[][];
}

const baseFiles = (): FileDiff[] => [
  {
    path: "src/net/client.ts",
    hunks: [
      [
        [" ", 1, 1, 'import { sleep } from "../util.ts";'],
        ["+", null, 2, 'import { backoff } from "./backoff.ts";'],
        [" ", 2, 3, ""],
        [" ", 3, 4, "export async function req(url: string, init?: RequestInit) {"],
      ],
      [
        [" ", 13, 14, "// How long one request may take before we give up."],
        ["-", 14, null, "export function timeoutMs() {"],
        ["+", null, 15, "export function requestTimeoutMs() {"],
        [" ", 15, 16, "  return 5000;"],
      ],
    ],
  },
  {
    path: "src/jobs/sync.ts",
    hunks: [
      [
        ["-", 1, null, 'import { getJson } from "../net/client.ts";'],
        ["+", null, 1, 'import { getJson, retrying } from "../net/client.ts";'],
        [" ", 2, 2, ""],
        [" ", 3, 3, "export async function sync() {"],
        ["-", 4, null, '  const items = await getJson("/items");'],
        ["+", null, 4, '  const items = await retrying(() => getJson("/items"), 6);'],
        [" ", 5, 5, "  return items.length;"],
      ],
    ],
  },
  {
    path: "src/net/backoff.ts",
    hunks: [
      [
        ["+", null, 1, "// exponential backoff with full jitter"],
        ["+", null, 2, "export function backoff(attempt: number, base = 200, cap = 5000) {"],
        ["+", null, 3, "  const ceiling = Math.min(cap, base * 2 ** attempt);"],
        ["+", null, 4, "  return Math.random() * ceiling;"],
        ["+", null, 5, "}"],
      ],
    ],
  },
];

const newFile = (): FileDiff => ({
  path: "docs/net.md",
  hunks: [
    [
      [" ", 1, 1, "# demo"],
      ["+", null, 2, ""],
      ["+", null, 3, "Requests retry with jittered backoff."],
    ],
  ],
});

/** pr-viz.ts l.872: sha1(JSON.stringify(hunks.map(h => h.lines.filter(l => l[0] !== " ").map(l => l[0] + l[3])))) */
async function fingerprint(f: FileDiff): Promise<string> {
  const changed = f.hunks.map((h) => h.filter((l) => l[0] !== " ").map((l) => l[0] + l[3]));
  const bytes = new TextEncoder().encode(JSON.stringify(changed));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const count = (f: FileDiff, sign: Sign): number =>
  f.hunks.flat().filter((l) => l[0] === sign).length;

const rowHTML = (l: Row): string => {
  const num = l[0] === "-" ? "" : (l[2] ?? "");
  const cls = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "";
  return `<span class="l ${cls}"><em>${num}</em><i>${l[0]}</i>${esc(l[3])}</span>`;
};

function initTicks(): void {
  const root = $("#ticks")!;
  const list = $("#tick-list", root)!;
  const tally = $("#tick-tally", root)!;
  const note = $("#tick-note", root)!;
  const keep = { files: baseFiles(), reviewed: new Map<string, string>(), say: "" };

  const draw = async (): Promise<void> => {
    const fps = new Map<string, string>(
      await Promise.all(keep.files.map(async (f) => [f.path, await fingerprint(f)] as const)),
    );
    const ticked = (p: string): boolean => keep.reviewed.get(p) === fps.get(p);
    const stale = (p: string): boolean => keep.reviewed.has(p) && fps.has(p) && !ticked(p);
    list.innerHTML = keep.files
      .map((f, i) => {
        const was = keep.reviewed.get(f.path);
        return `<details class="file"${i === 0 ? " open" : ""} data-viz-id="file-${esc(f.path)}" data-label="file ${esc(f.path)}"><summary><label><input type="checkbox" data-path="${esc(f.path)}"${ticked(f.path) ? " checked" : ""}> reviewed</label>${stale(f.path) ? ' <span class="stale">changed since you looked</span>' : ""} <code>${esc(f.path)}</code> <span class="mut">+${count(f, "+")} −${count(f, "-")}</span><span class="fp">now <b>${(fps.get(f.path) ?? "").slice(0, 7)}</b>${was ? ` · ticked at <b>${was.slice(0, 7)}</b>` : ""}</span></summary>${f.hunks.map((h) => `<pre>${h.map(rowHTML).join("")}</pre>`).join("")}</details>`;
      })
      .join("");
    const n = keep.files.filter((f) => ticked(f.path)).length;
    tally.textContent = `${n} / ${keep.files.length} files reviewed`;
    note.textContent = keep.say;
  };

  list.addEventListener("change", (e) => {
    const box = e.target instanceof HTMLInputElement ? e.target : null;
    const path = box?.dataset["path"];
    if (!box || !path) return;
    if (!box.checked) keep.reviewed.delete(path);
    const file = keep.files.find((f) => f.path === path);
    const stamp = box.checked && file ? fingerprint(file) : Promise.resolve("");
    stamp
      .then(async (fp) => {
        if (fp) keep.reviewed.set(path, fp);
        await draw();
      })
      .catch(reportError);
  });

  const pushes: Record<string, () => void> = {
    rebase: () => {
      // someone else's change landed above ours: every line number moves, a neighbouring context line changes
      keep.files = keep.files.map((f) => ({
        path: f.path,
        hunks: f.hunks.map((h) =>
          h.map((l): Row => [
            l[0],
            l[1] === null ? null : l[1] + 37,
            l[2] === null ? null : l[2] + 37,
            l[3] === 'import { sleep } from "../util.ts";'
              ? 'import { sleep, now } from "../util.ts";'
              : l[3],
          ]),
        ),
      }));
      keep.say =
        "Rebased onto a newer main. Every line number moved and a context line changed; no added or removed line did. Ticks hold.";
    },
    edit: () => {
      keep.files = keep.files.map((f) => ({
        path: f.path,
        hunks: f.hunks.map((h) =>
          h.map((l): Row =>
            l[3].includes('getJson("/items"), 6)')
              ? [l[0], l[1], l[2], l[3].replace("), 6)", "), 3)")]
              : l,
          ),
        ),
      }));
      keep.say =
        "A new commit changed one added line in sync.ts (6 tries became 3). Only sync.ts loses its tick, and says why.";
    },
    add: () => {
      if (!keep.files.some((f) => f.path === "docs/net.md"))
        keep.files = [...keep.files, newFile()];
      keep.say = "A file joined the PR. It starts unticked; the others are untouched.";
    },
    reset: () => {
      keep.files = baseFiles();
      keep.reviewed.clear();
      keep.say = "";
    },
  };
  for (const b of $$("button[data-push]", root)) {
    b.addEventListener("click", () => {
      pushes[b.dataset["push"] ?? ""]?.();
      draw().catch(reportError);
    });
  }
  draw().catch(reportError);
}

initPipeline();
initTicks();
