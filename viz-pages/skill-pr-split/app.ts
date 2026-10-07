import { stepper, arrowMarkers, connect, labelBox, $, $$, esc } from "@viz/kit";

/* ════════════════════════════════════════════════════════════════════════════
   Figure 1 — what `split.ts cut` does, line by line (stepper over a diagram)
   Left column: the six stages. Right: the git objects each stage brings into
   being. Everything on the right is derived from one node table.
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
  code: [number, string][];
  lede: string;
}

const STEPS: Step[] = [
  {
    title: "hunks",
    makes: "every changed file, every hunk, each with an id: <code>path#n</code>",
    refuses: ["a diff header it cannot read a path from (throws, l.38)"],
    code: [
      [
        45,
        'const diffOf = (repo, from, to) => git(repo, [… "diff", "--binary", "--no-color", "-U3", from, to]);',
      ],
      [36, "const [head, ...hunks] = chunk.split(/^(?=@@ )/m);"],
      [
        66,
        "const ids = (f) => (f.hunks.length ? f.hunks.map((_, i) => `${f.path}#${i + 1}`) : [`${f.path}#0`]);",
      ],
    ],
    lede: "<code>hunks</code> and <code>cut</code> start the same way: a diff from the <b>merge-base</b>, so whatever the base did since you branched is not in the picture. <code>--binary</code> so a binary file survives <code>git apply</code> later. A file with no hunks (binary, rename, mode change) counts as one, id <code>path#0</code>.",
  },
  {
    title: "gate",
    makes: "an owner for every hunk: <code>owner: Map&lt;hunkId, branch&gt;</code>",
    refuses: [
      "<code>&lt;id&gt; is in both &lt;a&gt; and &lt;b&gt;</code>",
      "<code>&lt;id&gt; is in no piece</code>",
      "<code>&lt;branch&gt; has no hunks</code>",
      "a branch that already exists, a name used twice, an <code>after</code> that names no piece",
    ],
    code: [
      [
        71,
        "if (owner.has(id)) problems.push(`${id} is in both ${owner.get(id)} and ${p.branch}`);",
      ],
      [
        85,
        "if (![...owner.values()].includes(p.branch)) problems.push(`${p.branch} has no hunks`);",
      ],
      [
        88,
        "for (const id of files.flatMap(ids)) if (!owner.has(id)) problems.push(`${id} is in no piece`);",
      ],
      [
        89,
        "if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }",
      ],
    ],
    lede: "A piece names whole files by path prefix (<code>files</code>) and single hunks by id (<code>hunks</code>). Every problem is collected and printed together, so you fix the cut once instead of once per error. Nothing has touched git yet.",
  },
  {
    title: "order",
    makes: "<code>order: Piece[]</code>, parents before children",
    refuses: [
      "a stack loop: throws <code>pieces stack in a loop: a → b → a</code> (a stack trace, not a ✗ line)",
    ],
    code: [
      [
        102,
        'if (seen.includes(p.branch)) throw new Error(`pieces stack in a loop: ${[...seen, p.branch].join(" → ")}`);',
      ],
      [103, "if (p.after) visit(pieces.find((q) => q.branch === p.after)!, [...seen, p.branch]);"],
      [104, "order.push(p);"],
    ],
    lede: "<code>pieces</code> may be listed in any order. <code>visit()</code> walks <code>after</code> first, so a parent is always built before its child. The same order drives the sum-back and the final summary.",
  },
  {
    title: "build",
    makes: "one detached commit per piece: <code>sha: Map&lt;branch, commit&gt;</code>",
    refuses: [
      "a patch that does not apply: <code>git apply --index</code> throws (l.116) and no branch exists yet",
    ],
    code: [
      [114, 'git(repo, ["worktree", "add", "--detach", "--quiet", wt, from]);'],
      [116, 'if (patch) git(wt, ["apply", "--index", "--whitespace=nowarn", "-"], patch);'],
      [
        122,
        "for (const p of order) sha.set(p.branch, commit(p.after ? sha.get(p.after)! : start, patchOf(p), p.title));",
      ],
    ],
    lede: "Each piece is a throwaway worktree under the OS temp dir, on its parent's commit if it stacks, else on the merge-base. Its patch is each file's header plus <b>only the hunks it owns</b> (<code>patchOf</code>, l.92). The <code>finally</code> removes the worktree even when the apply throws.",
  },
  {
    title: "sum-back",
    makes: "<code>at</code>: the merge-base with every piece replayed onto it, in order",
    refuses: [
      "<code>the pieces don't sum back to &lt;head&gt;; no branch was created</code>, then <code>git diff --stat</code> of what differs (l.129)",
    ],
    code: [
      [
        125,
        "for (const p of order) at = commit(at, diffOf(repo, p.after ? sha.get(p.after)! : start, sha.get(p.branch)!), `sum-back: ${p.branch}`);",
      ],
      [
        126,
        'const want = git(repo, ["rev-parse", `${plan.head}^{tree}`]).trim(), got = git(repo, ["rev-parse", `${at}^{tree}`]).trim();',
      ],
      [127, 'if (want !== got) mismatch = git(repo, ["diff", "--stat", at, plan.head]);'],
    ],
    lede: "It replays each piece's <i>own</i> diff (its commit against its parent) onto the merge-base, one after another, and compares <b>trees</b>, not commits. History may differ; contents may not. Note what this proves: nothing was lost and nothing was doubled. It says nothing about whether any piece builds.",
  },
  {
    title: "branch",
    makes:
      "<code>git branch &lt;name&gt; &lt;commit&gt;</code> per piece, then one summary line each",
    refuses: ["nothing is pushed; your checkout and the original branch never moved"],
    code: [
      [
        129,
        "if (mismatch) { console.error(`✗ the pieces don't sum back to ${plan.head}; no branch was created. …`); process.exit(1); }",
      ],
      [131, 'for (const p of order) git(repo, ["branch", p.branch, sha.get(p.branch)!]);'],
      [132, "console.log(`✓ the ${order.length} pieces sum back to ${plan.head} exactly`);"],
    ],
    lede: "Branches come into existence in one loop, after every check. Until line 131 the only trace of the run is a few commits no ref points to and a temp directory that is already gone.",
  },
];

const N = {
  head: { x: 352, y: 26, w: 150, h: 30 },
  base: { x: 352, y: 106, w: 110, h: 30 },
  tidy: { x: 512, y: 64, w: 118, h: 30 },
  core: { x: 512, y: 128, w: 118, h: 30 },
  sync: { x: 660, y: 96, w: 110, h: 30 },
  docs: { x: 660, y: 160, w: 110, h: 30 },
  c0: { x: 352, y: 252, w: 66, h: 30 },
  c1: { x: 432, y: 252, w: 66, h: 30 },
  c2: { x: 512, y: 252, w: 66, h: 30 },
  c3: { x: 592, y: 252, w: 66, h: 30 },
  c4: { x: 672, y: 252, w: 66, h: 30 },
  want: { x: 352, y: 322, w: 186, h: 36 },
  got: { x: 584, y: 322, w: 186, h: 36 },
} satisfies Record<string, Box>;

const stageBox = (i: number): Box => ({ x: 10, y: 14 + i * 62, w: 316, h: 50 });
const STAGE_TXT = [
  ["1 · hunks", "git diff --binary -U3 → files, hunks, ids"],
  ["2 · gate", "every hunk in exactly one piece"],
  ["3 · order", "parents before children"],
  ["4 · build", "one detached worktree per piece"],
  ["5 · sum-back", "replay in order, compare trees"],
  ["6 · branch", "only now do branches exist"],
] as const;

const PIECES = ["tidy", "core", "sync", "docs"] as const;
type PieceId = (typeof PIECES)[number];
const PIECE_COLOR: Record<PieceId, string> = {
  tidy: "var(--p1)",
  core: "var(--p2)",
  sync: "var(--p3)",
  docs: "var(--p4)",
};

/** min step at which a thing appears, and which steps light it up */
const g = (id: string, label: string, s: number, hot: number[], body: string, cls = "") =>
  `<g class="el ${cls}" data-s="${s}" data-hot="${hot.join(",")}" data-viz-id="${id}" data-label="${esc(label)}">${body}</g>`;
const box = (b: Box, html: string, stroke = "var(--border)", extra = "") =>
  `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="7" fill="#0e131b" stroke="${stroke}" ${extra}/>${labelBox(b, html, "mono")}`;
const edge = (id: string, a: Box, b: Box, s: number, hot: number[], dash = false) =>
  g(
    id,
    `edge ${id}`,
    s,
    hot,
    `<path d="${connect(a, b)}" fill="none" stroke="var(--muted)" stroke-width="1.4" ${dash ? 'stroke-dasharray="4 4"' : ""} marker-end="url(#ah)"/>`,
  );
const cap = (x: number, y: number, s: number, t: string) =>
  `<g class="el" data-s="${s}" data-hot=""><text x="${x}" y="${y}" font-size="10" letter-spacing="1.2" fill="var(--muted)" font-family="var(--mono)">${t}</text></g>`;

function drawCut(): string {
  const stages = STAGE_TXT.flatMap(([t, d], i) => {
    const stage = g(
      `stage-${i + 1}`,
      `stage ${t}`,
      0,
      [i],
      box(stageBox(i), `<div class="nl"><b>${t}</b><span>${d}</span></div>`),
      "stage",
    );
    return i ? [stage, edge(`stage-edge-${i}`, stageBox(i - 1), stageBox(i), 0, [i])] : [stage];
  });
  const pieces = PIECES.map((k) =>
    g(`n-${k}`, `piece commit ${k}`, 3, [3, 5], box(N[k], k, PIECE_COLOR[k]), `piece piece-${k}`),
  );
  const chain: [string, string, Box][] = [
    ["c0", "base", N.c0],
    ["c1", "+ tidy", N.c1],
    ["c2", "+ core", N.c2],
    ["c3", "+ sync", N.c3],
    ["c4", "+ docs", N.c4],
  ];
  const replay = chain.flatMap(([id, t, b], i) => {
    const node = g(`n-${id}`, `sum-back step ${t}`, 4, [4], box(b, t), "git");
    return i ? [node, edge(`e-${id}`, chain[i - 1]![2], b, 4, [4])] : [node];
  });
  return `<svg viewBox="0 0 780 396" role="img" aria-label="The six stages of split.ts cut and the git objects each one creates">${[
    arrowMarkers({ ah: "var(--muted)" }),
    ...stages,
    cap(352, 14, 0, "THE RANGE · MERGE-BASE → HEAD"),
    g("n-head", "head branch", 0, [0], box(N.head, "<b>retry-backoff</b> · head"), "git"),
    g("n-base", "merge-base", 0, [0], box(N.base, "merge-base"), "git"),
    edge("e-head", N.base, N.head, 0, [0], true),
    cap(512, 50, 3, "PIECE COMMITS · DETACHED, ONE EACH"),
    ...pieces,
    edge("e-tidy", N.base, N.tidy, 3, [3]),
    edge("e-core", N.base, N.core, 3, [3]),
    edge("e-sync", N.core, N.sync, 3, [3]),
    edge("e-docs", N.core, N.docs, 3, [3]),
    cap(352, 238, 4, "SUM-BACK · REPLAY EACH PIECE'S OWN DIFF, IN ORDER"),
    ...replay,
    g("n-want", "want: head tree", 4, [4], box(N.want, "want = head^{tree}"), "git"),
    g("n-got", "got: replayed tree", 4, [4], box(N.got, "got = at^{tree}"), "git"),
    edge("e-got", N.c4, N.got, 4, [4]),
    `<g class="el" data-s="4" data-hot="4"><text x="561" y="345" text-anchor="middle" font-size="18" fill="var(--good)" font-family="var(--mono)">=</text></g>`,
    `<g class="el" data-s="5" data-hot="5"><text x="352" y="382" font-size="12" fill="var(--good)" font-family="var(--mono)">✓ equal → git branch × 4, nothing pushed</text></g>`,
  ].join("")}</svg>`;
}

function initCut(): void {
  const fig = $("#cutfig")!;
  const svg = $("#cutsvg", fig)!;
  svg.innerHTML = drawCut();
  const snip = $("#snip", fig)!;
  const makes = $("#makes", fig)!;
  const refuses = $("#refuses", fig)!;
  const lede = $("#cutlede", fig)!;
  const pos = $("#cutpos", fig)!;
  const render = (i: number): void => {
    const s = STEPS[i]!;
    for (const el of $$<SVGGElement>(".el", svg)) {
      const at = Number(el.dataset["s"]);
      const hot = (el.dataset["hot"] ?? "").split(",").filter(Boolean).map(Number);
      el.classList.toggle("on", at <= i);
      el.classList.toggle("hot", hot.includes(i));
    }
    snip.innerHTML = s.code.map(([n, t]) => `<span class="ln">${n}</span>${esc(t)}`).join("\n");
    makes.innerHTML = s.makes;
    refuses.innerHTML = s.refuses.map((r) => `<li>${r}</li>`).join("");
    lede.innerHTML = s.lede;
    pos.textContent = `${i + 1} / ${STEPS.length} · ${s.title}`;
  };
  const st = stepper({
    n: STEPS.length,
    onStep: render,
    autoplayMs: 4200,
    hashKey: "cut",
    target: fig,
  });
  $("#cutnext", fig)!.addEventListener("click", () => st.next());
  $("#cutprev", fig)!.addEventListener("click", () => st.prev());
  const play = $("#cutplay", fig)!;
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
  $("#cutnext", fig)!.addEventListener("click", stopPlay);
  $("#cutprev", fig)!.addEventListener("click", stopPlay);
}

/* ════════════════════════════════════════════════════════════════════════════
   Figure 2 — break a cut. The same checks as split.ts lines 63-106, run on a
   real branch's nine hunks; then the check split.ts does NOT make (step 5).
   ════════════════════════════════════════════════════════════════════════════ */

interface Hunk {
  id: string;
  short: string;
  plus: number;
  minus: number;
  file: string;
  needs: [string, string][];
}
const hunk = (
  id: string,
  short: string,
  [plus, minus]: [number, number],
  needs: [string, string][] = [],
): Hunk => ({ id, short, plus, minus, file: id.slice(0, id.lastIndexOf("#")), needs });

const CLIENT3 = "src/net/client.ts#3";
const H: Hunk[] = [
  hunk(
    "bun.lock#1",
    "bun.lock#1",
    [2, 0],
    [["package.json#1", "lists p-retry, which package.json#1 adds"]],
  ),
  hunk("docs/net.md#1", "net.md#1", [2, 0], [[CLIENT3, "documents retries that client.ts#3 adds"]]),
  hunk("package.json#1", "package.json#1", [1, 1]),
  hunk(
    "src/jobs/sync.ts#1",
    "sync.ts#1",
    [2, 2],
    [[CLIENT3, "calls retrying(), which client.ts#3 adds"]],
  ),
  hunk("src/net/backoff.ts#1", "backoff.ts#1", [5, 0]),
  hunk(
    "src/net/client.test.ts#1",
    "client.test.ts#1",
    [8, 0],
    [[CLIENT3, "tests retrying(), which client.ts#3 adds"]],
  ),
  hunk(
    "src/net/client.ts#1",
    "client.ts#1",
    [1, 0],
    [["src/net/backoff.ts#1", "imports ./backoff.ts, which backoff.ts#1 creates"]],
  ),
  hunk("src/net/client.ts#2", "client.ts#2", [1, 1]),
  hunk(
    CLIENT3,
    "client.ts#3",
    [12, 1],
    [
      ["src/net/client.ts#1", "uses backoff, which client.ts#1 imports"],
      ["src/net/backoff.ts#1", "calls backoff(), which backoff.ts#1 defines"],
    ],
  ),
];
const isPiece = (s: string | undefined): s is PieceId => PIECES.some((p) => p === s);
const br = (p: string): string => `retry-backoff-${p}`;

/** A cut as cut.json would say it: who owns each hunk, who claims one twice, which pieces exist, what stacks on what. */
interface Cut {
  owner: Map<string, PieceId>;
  extra: Map<string, PieceId>;
  on: Set<PieceId>;
  after: Map<PieceId, PieceId>;
}

const finest = (): Cut => ({
  owner: new Map<string, PieceId>([
    ["bun.lock#1", "core"],
    ["docs/net.md#1", "docs"],
    ["package.json#1", "core"],
    ["src/jobs/sync.ts#1", "sync"],
    ["src/net/backoff.ts#1", "core"],
    ["src/net/client.test.ts#1", "core"],
    ["src/net/client.ts#1", "core"],
    ["src/net/client.ts#2", "tidy"],
    [CLIENT3, "core"],
  ]),
  extra: new Map<string, PieceId>(),
  on: new Set<PieceId>(PIECES),
  after: new Map<PieceId, PieceId>([
    ["sync", "core"],
    ["docs", "core"],
  ]),
});

const balanced = (): Cut => {
  const c = finest();
  c.on.delete("sync");
  c.on.delete("docs");
  c.after.clear();
  c.owner.set("src/jobs/sync.ts#1", "core");
  c.owner.set("docs/net.md#1", "core");
  return c;
};
const forgot = (): Cut => {
  const c = finest();
  c.owner.delete(CLIENT3);
  return c;
};
const twice = (): Cut => {
  const c = finest();
  c.extra.set(CLIENT3, "tidy");
  return c;
};
const loop = (): Cut => {
  const c = finest();
  c.after.set("core", "sync");
  return c;
};
const unstacked = (): Cut => {
  const c = finest();
  c.after.clear();
  return c;
};

const PRESETS: { key: string; label: string; make: () => Cut; blurb: string }[] = [
  {
    key: "finest",
    label: "finest cut",
    make: finest,
    blurb: "One piece per atom. The default, and what step 3 offers first.",
  },
  {
    key: "balanced",
    label: "balanced cut",
    make: balanced,
    blurb: "The two footnotes merged into the piece they footnote. Two PRs instead of four.",
  },
  {
    key: "forgot",
    label: "forget a hunk",
    make: forgot,
    blurb: "client.ts#3, the retry loop itself, assigned to nobody.",
  },
  {
    key: "twice",
    label: "claim a hunk twice",
    make: twice,
    blurb: "tidy lists client.ts#3 as well as core.",
  },
  {
    key: "loop",
    label: "stack in a loop",
    make: loop,
    blurb: "core stacks on sync, which stacks on core.",
  },
  {
    key: "unstacked",
    label: "forget to stack",
    make: unstacked,
    blurb: "sync and docs both need core's code, but nothing says so.",
  },
];

interface Line {
  cls: "ok" | "bad" | "dim" | "plain" | "hd";
  text: string;
}
const bad = (text: string): Line => ({ cls: "bad", text });
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

/** split.ts l.63-89: who owns what, every problem collected. */
function gate(c: Cut): { claims: Map<string, PieceId>; problems: string[] } {
  const claims = new Map<string, PieceId>();
  const problems: string[] = [];
  const claimedBy = (p: PieceId): Hunk[] =>
    H.filter((h) => c.owner.get(h.id) === p || c.extra.get(h.id) === p);
  for (const p of PIECES.filter((q) => c.on.has(q))) {
    for (const h of claimedBy(p)) {
      const prev = claims.get(h.id);
      if (prev) problems.push(`${h.id} is in both ${br(prev)} and ${br(p)}`);
      else claims.set(h.id, p);
    }
    const a = c.after.get(p);
    if (a && !c.on.has(a)) problems.push(`${br(p)}: after "${br(a)}", which is no piece`);
    if (![...claims.values()].includes(p)) problems.push(`${br(p)} has no hunks`);
  }
  for (const h of H) if (!claims.has(h.id)) problems.push(`${h.id} is in no piece`);
  return { claims, problems };
}

/** split.ts l.98-106: parents before children; a loop is a thrown error, not a ✗ line. */
function stackOrder(c: Cut): { sorted: PieceId[]; loop: string } {
  const sorted: PieceId[] = [];
  const state = { loop: "" };
  const visit = (p: PieceId, seen: PieceId[]): void => {
    if (state.loop || sorted.includes(p)) return;
    if (seen.includes(p)) {
      state.loop = [...seen, p].map(br).join(" → ");
      return;
    }
    const a = c.after.get(p);
    if (a) visit(a, [...seen, p]);
    if (!state.loop) sorted.push(p);
  };
  for (const p of PIECES.filter((q) => c.on.has(q))) visit(p, []);
  return { sorted, loop: state.loop };
}

/** split.ts l.133-136: one shortstat per piece, against its parent. */
function shortstat(c: Cut, p: PieceId, claims: Map<string, PieceId>): Line {
  const mine = H.filter((h) => claims.get(h.id) === p);
  const files = new Set(mine.map((h) => h.file)).size;
  const plus = mine.reduce((s, h) => s + h.plus, 0);
  const minus = mine.reduce((s, h) => s + h.minus, 0);
  const parts = [`${plural(files, "file")} changed`, `${plural(plus, "insertion")}(+)`];
  if (minus) parts.push(`${plural(minus, "deletion")}(-)`);
  const a = c.after.get(p);
  return { cls: "plain", text: `  ${br(p)}${a ? ` (on ${br(a)})` : ""}: ${parts.join(", ")}` };
}

/** What a piece can see when its tests run: itself and everything it stacks on. */
function visible(c: Cut, p: PieceId): Set<PieceId> {
  const seen = new Set<PieceId>([p]);
  for (let a = c.after.get(p); a && !seen.has(a); a = c.after.get(a)) seen.add(a);
  return seen;
}

/** SKILL.md step 5: not a script. Each piece alone, against a hand-written table of what needs what. */
function standalone(c: Cut, p: PieceId, claims: Map<string, PieceId>): Line[] {
  const have = visible(c, p);
  const misses = H.filter((h) => claims.get(h.id) === p)
    .flatMap((h) => h.needs.map(([dep, why]) => ({ h, why, owner: claims.get(dep) })))
    .filter((m) => m.owner !== undefined && !have.has(m.owner))
    .map((m) =>
      bad(
        `    ${m.h.short} ${m.why}; that is in ${br(m.owner ?? "")}, which this piece does not stack on`,
      ),
    );
  return misses.length > 0
    ? [bad(`✗ ${br(p)} fails on its own`), ...misses]
    : [{ cls: "ok", text: `✓ ${br(p)} passes on its own` }];
}

/** What split.ts would print, then what step 5 would find. */
function run(c: Cut): Line[] {
  const head: Line = { cls: "hd", text: "$ bun split.ts cut cut.json" };
  const { claims, problems } = gate(c);
  if (problems.length > 0) {
    return [
      head,
      ...problems.map((p) => bad(`✗ ${p}`)),
      { cls: "dim", text: "exit 1. No worktree made, no branch created." },
    ];
  }
  const { sorted, loop: cycle } = stackOrder(c);
  if (cycle) {
    return [
      head,
      bad(`error: pieces stack in a loop: ${cycle}`),
      { cls: "dim", text: "uncaught: a stack trace, exit 1. No branch created." },
    ];
  }
  // Once every hunk has exactly one owner, the build and the sum-back agree: a set of patches that
  // partitions the diff sums to it. What this cannot say is whether any piece builds.
  const failed = sorted.flatMap((p) => standalone(c, p, claims));
  return [
    head,
    { cls: "ok", text: `✓ the ${sorted.length} pieces sum back to retry-backoff exactly` },
    ...sorted.map((p) => shortstat(c, p, claims)),
    { cls: "dim", text: "" },
    {
      cls: "hd",
      text: "# step 5 (the agent, not the script): each piece's tests, in its own worktree",
    },
    ...failed,
    ...(failed.some((l) => l.cls === "bad")
      ? [
          {
            cls: "dim",
            text: "fix the cut (stack the piece, or move the hunk), git branch -D the branches it made, cut again.",
          } satisfies Line,
        ]
      : []),
  ];
}

const chipHTML = (c: Cut, h: Hunk, owner: PieceId | null): string => {
  const second = c.extra.get(h.id);
  const dup = second
    ? `<em title="also claimed by ${second}" style="--pc:${PIECE_COLOR[second]}"></em>`
    : "";
  const own = owner ?? "";
  return `<button class="chip" data-hunk="${esc(h.id)}" data-owner="${own}" data-viz-id="hunk-${esc(h.id)}" data-label="hunk ${esc(h.id)}" title="${esc(h.id)}: click to move it to the next piece"><span>${esc(h.short)}</span><small>+${h.plus} −${h.minus}</small>${dup}</button>`;
};

const colHTML = (title: string, color: string, id: string, chips: string, head = ""): string =>
  `<div class="col" data-col="${id}" style="--pc:${color}" data-viz-id="col-${id || "unassigned"}" data-label="piece ${esc(title)}"><div class="colh"><b>${esc(title)}</b>${head}</div><div class="chips">${chips}</div></div>`;

function pieceHead(c: Cut, p: PieceId): string {
  if (!c.on.has(p)) return `<button class="x add" data-toggle="${p}">+ add piece</button>`;
  const options = PIECES.filter((q) => q !== p)
    .map((q) => `<option value="${q}"${c.after.get(p) === q ? " selected" : ""}>${br(q)}</option>`)
    .join("");
  return `<label>on <select data-after="${p}"><option value="">the merge-base</option>${options}</select></label><button class="x" data-toggle="${p}" title="drop this piece">×</button>`;
}

function boardHTML(c: Cut): string {
  const loose = H.filter((h) => !c.owner.has(h.id));
  const first = colHTML(
    "unassigned",
    "var(--faint)",
    "",
    loose.map((h) => chipHTML(c, h, null)).join(""),
  );
  const rest = PIECES.map((p) => {
    const chips = c.on.has(p)
      ? H.filter((h) => c.owner.get(h.id) === p)
          .map((h) => chipHTML(c, h, p))
          .join("")
      : "";
    return colHTML(br(p), PIECE_COLOR[p], p, chips, pieceHead(c, p));
  });
  return [first, ...rest].join("");
}

/** The next owner for a clicked hunk: unassigned, then each live piece in turn. */
function nextOwner(c: Cut, id: string): PieceId | null {
  const ring = [null, ...PIECES.filter((p) => c.on.has(p))];
  const now = c.owner.get(id) ?? null;
  return ring[(ring.indexOf(now) + 1) % ring.length] ?? null;
}

function togglePiece(c: Cut, p: PieceId): void {
  if (c.on.has(p)) {
    c.on.delete(p);
    for (const h of H) {
      if (c.owner.get(h.id) === p) c.owner.delete(h.id);
      if (c.extra.get(h.id) === p) c.extra.delete(h.id);
    }
  } else c.on.add(p);
}

function initBreak(): void {
  const root = $("#breaker")!;
  const board = $("#board", root)!;
  const term = $("#term", root)!;
  const blurb = $("#blurb", root)!;
  const presets = $("#presets", root)!;
  const now = { cut: finest(), key: "finest" };

  const draw = (): void => {
    board.innerHTML = boardHTML(now.cut);
    for (const el of $$(".col", board))
      el.classList.toggle("off", isPiece(el.dataset["col"]) && !now.cut.on.has(el.dataset["col"]));
    term.innerHTML = run(now.cut)
      .map((l) => `<span class="${l.cls}">${esc(l.text)}</span>`)
      .join("\n");
    for (const b of $$("button", presets)) b.classList.toggle("sel", b.dataset["key"] === now.key);
    blurb.textContent =
      PRESETS.find((p) => p.key === now.key)?.blurb ??
      "Your own cut: click hunks to move them, change a stack, drop a piece.";
  };
  const edited = (): void => {
    now.key = "";
    draw();
  };
  presets.innerHTML = PRESETS.map((p) => `<button data-key="${p.key}">${p.label}</button>`).join(
    "",
  );
  presets.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-key]") : null;
    const preset = PRESETS.find((p) => p.key === t?.dataset["key"]);
    if (!preset) return;
    now.key = preset.key;
    now.cut = preset.make();
    draw();
  });
  board.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const id = t?.closest<HTMLElement>(".chip")?.dataset["hunk"];
    const piece = t?.closest<HTMLElement>("[data-toggle]")?.dataset["toggle"];
    if (id) {
      const to = nextOwner(now.cut, id);
      if (to) now.cut.owner.set(id, to);
      else now.cut.owner.delete(id);
      now.cut.extra.delete(id);
      edited();
    } else if (isPiece(piece)) {
      togglePiece(now.cut, piece);
      edited();
    }
  });
  board.addEventListener("change", (e) => {
    const s = e.target instanceof HTMLSelectElement ? e.target : null;
    const p = s?.dataset["after"];
    if (!s || !isPiece(p)) return;
    if (isPiece(s.value)) now.cut.after.set(p, s.value);
    else now.cut.after.delete(p);
    edited();
  });
  draw();
}

initCut();
initBreak();
