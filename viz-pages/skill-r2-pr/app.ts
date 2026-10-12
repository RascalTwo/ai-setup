import { arrowMarkers, connect, labelBox, side, stepper, vizAudit, $ } from "@viz/kit";

// ── Figure 1: the eight steps across the local / GitHub border ──────────────
interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
}
const W = 104,
  GAP = 21,
  Y = 48,
  H = 88;
const col = (i: number): Node => ({ x: 14 + i * (W + GAP), y: Y, w: W, h: H });
const local: [Node, string, string, string][] = [
  [col(0), "1 Pin it", "repo · branch · base · head · PR?", "n1"],
  [col(1), "2 Conventions", "template · title style · r2-sdlc notes", "n2"],
  [col(2), "3 Ready?", "claims need tests · push back · pr-split", "n3"],
  [col(3), "4 Walkthrough", "pr-viz: video · image · changes", "n4"],
  [col(4), "5 Draft", "pr.md + body.ts preview", "n5"],
  [col(5), "6 The yes", "the one gate", "n6"],
];
const n1 = col(0),
  n6 = col(5);
const publish: Node = { x: 504, y: 244, w: 239, h: 104 };
const update: Node = { x: 14, y: 244, w: 230, h: 92 };
const note: Node = { x: 262, y: 244, w: 224, h: 92 };
const ready: Node = { x: 504, y: 358, w: 239, h: 26 };
const stateLine: Node = { x: 140, y: 146, w: 604, h: 26 };

const rect = (
  n: Node,
  id: string,
  label: string,
  stroke: string,
  fill: string,
  extra = "",
): string =>
  `<g data-viz-id="${id}" data-label="${label}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.4" ${extra}/></g>`;

const nd = (b: string, s: string): string => `<b>${b}</b><small>${s}</small>`;

let svg = arrowMarkers();
// lanes
svg += `<rect x="0" y="6" width="760" height="172" rx="12" fill="color-mix(in srgb, var(--panel) 70%, transparent)" stroke="var(--border)"/>`;
svg += `<rect x="0" y="210" width="760" height="184" rx="12" fill="color-mix(in srgb, var(--accent) 6%, transparent)" stroke="color-mix(in srgb, var(--accent) 45%, transparent)"/>`;
svg += `<text class="lane-label" x="14" y="28" fill="var(--muted)">ON YOUR MACHINE · NOTHING SENT</text>`;
svg += `<text class="lane-label" x="92" y="230" fill="var(--accent)">ON GITHUB</text>`;
svg += `<text x="380" y="198" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="var(--faint)">▲ stays local · ▼ crosses the border</text>`;

// local edges (derived from the nodes, never retyped)
for (let i = 0; i < local.length - 1; i++) {
  const a = local[i]![0],
    b = local[i + 1]![0];
  const warn = i === local.length - 2;
  svg += `<path d="${connect(a, b)}" stroke="${warn ? "var(--warn)" : "var(--muted)"}" stroke-width="1.5" fill="none" marker-end="url(#${warn ? "ah-warn" : "ah"})"/>`;
}
// nodes
for (const [n, t, s, id] of local) {
  const gate = id === "n6";
  svg += rect(
    n,
    `step-${id}`,
    t,
    gate ? "var(--warn)" : id === "n5" ? "var(--own)" : "var(--border)",
    gate ? "color-mix(in srgb, var(--warn) 14%, transparent)" : "var(--panel)",
  );
  svg += labelBox(n, nd(t, s), gate ? "nd gate" : "nd");
}
svg += labelBox(
  stateLine,
  `<small>state: ~/.agents/state/r2-pr/&lt;owner&gt;-&lt;repo&gt;/&lt;branch&gt;/ — pr.md, pr.html</small>`,
  "nd",
);

// the yes crosses the border
const p6 = side(n6, "bottom");
svg += `<path d="M ${p6.x} ${p6.y} L ${p6.x} ${publish.y}" stroke="var(--warn)" stroke-width="1.8" fill="none" marker-end="url(#ah-warn)" data-viz-id="edge-yes" data-label="the yes crosses to GitHub"/>`;
// the other entrance: a PR already exists
const p1 = side(n1, "bottom");
svg += `<path d="M ${p1.x} ${p1.y} L ${p1.x} ${update.y}" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4" fill="none" marker-end="url(#ah-accent)" data-viz-id="edge-exists" data-label="PR already exists: go to update"/>`;
svg += `<text x="76" y="206" font-family="var(--mono)" font-size="10.5" fill="var(--accent)">PR exists</text>`;

svg += rect(update, "step-n8", "8 Update", "var(--accent)", "var(--panel)");
svg += labelBox(
  update,
  nd(
    "8 Update",
    "same patch? re-pin only<br/>else rebuild, upload, then<br/>body.ts sync (marked sections)",
  ),
  "nd",
);
svg += rect(publish, "step-n7", "7 Publish", "var(--accent)", "var(--panel)");
svg += labelBox(
  publish,
  nd(
    "7 Publish",
    "plain push · attach video + image<br/>body.ts finalize → final.md<br/>gh pr create --draft",
  ),
  "nd",
);
svg += labelBox(
  note,
  `<small>A force-push asks, every time. If it only rewrites history, <b style="color:var(--warn)">^{tree}</b> of origin and HEAD must match, or it stops until you've seen what moved.</small>`,
  "nd",
);
svg += rect(
  ready,
  "step-ready",
  "you mark it ready",
  "var(--border)",
  "transparent",
  `stroke-dasharray="4 3"`,
);
svg += labelBox(ready, `<small>then you mark it ready</small>`, "nd");

const pipe = $("#pipe")!;
pipe.innerHTML = svg;
vizAudit(document);

// ── Figure 2: body.ts sync, step by step ────────────────────────────────────
type Cls = "plain" | "owned" | "swapped" | "kept" | "missing";
interface Blk {
  name: string;
  c: Cls;
  tag: string;
}
interface Step {
  t: string;
  blocks: Blk[];
  code: string;
  lede: string;
}

const base = (c: Partial<Record<string, [Cls, string]>> = {}): Blk[] => {
  const d: [string, Cls, string][] = [
    ["Why", "plain", "tightened by a person"],
    ["&lt;!-- r2-pr:look --&gt; Where to look", "owned", "marked"],
    ["Proven", "plain", "written"],
    ["&lt;!-- r2-pr:walkthrough --&gt; Walkthrough", "owned", "marked"],
    ["How", "plain", "written"],
    ["Evidence", "plain", "added at a reviewer's ask"],
  ];
  const keys = ["why", "look", "proven", "walk", "how", "evidence"];
  return d.map(([name, cls, tag], i) => {
    const o = c[keys[i]!];
    return { name, c: o ? o[0] : cls, tag: o ? o[1] : tag };
  });
};
const ln = (n: number): string => `<span class="ln">${String(n).padStart(3, " ")}</span> `;

const S: Step[] = [
  {
    t: "THE LIVE BODY",
    blocks: base(),
    code: `${ln(91)}live = JSON.parse(\n     gh(["pr","view",n,"-R",repo,\n     "--json","body"])).body\n\n<span class="ok">two marked sections,</span>\n<span class="ok">four that people own</span>`,
    lede: "A PR that has been up for a day. r2-pr put the two teal sections there; a person tightened the Why, and a reviewer asked for the Evidence. <b>sync</b> starts by fetching exactly what GitHub holds now.",
  },
  {
    t: "THE FRESH SECTIONS",
    blocks: base({ look: ["owned", "fresh copy ready"], walk: ["owned", "fresh copy ready"] }),
    code: `${ln(90)}fresh = new Map(\n     matchAll(SECTION).map(m =&gt;\n       [m[1], m[0]]))\n\n<span class="o">look</span>         → new block\n<span class="o">walkthrough</span>  → new block\n<span class="ln">everything outside a marker\nin final.md is ignored</span>`,
    lede: "Run the same regex over the <b>new</b> <code>final.md</code>. The result is a map from section name to its replacement, and nothing else: whatever else the new file says is never looked at.",
  },
  {
    t: "REPLACE BY NAME",
    blocks: base({
      why: ["kept", "untouched"],
      look: ["swapped", "↻ replaced"],
      proven: ["kept", "untouched"],
      walk: ["swapped", "↻ replaced"],
      how: ["kept", "untouched"],
      evidence: ["kept", "untouched"],
    }),
    code: `${ln(93)}body = live.replace(SECTION,\n     (whole, name) =&gt;\n       fresh.has(name)\n         ? fresh.get(name)\n         : <span class="ok">whole</span>)`,
    lede: "Walk the <b>live</b> body's markers. A name present in the map gets its fresh block; anything else returns <code>whole</code>, itself. Unmarked text is never in the pattern, so it cannot be overwritten, by design rather than by care.",
  },
  {
    t: "BRANCH: A MARKER IS MISSING",
    blocks: base({ look: ["missing", "no r2-pr:look here"] }),
    code: `${ln(94)}missing = [...fresh.keys()]\n     .filter(n =&gt; !found.has(n))\n${ln(95)}<span class="bad">throw "the PR body has no\n r2-pr:look section; add the\n markers once by hand, then sync"</span>`,
    lede: "An older PR, opened before the Where-to-look section existed. A name in the map that matched nothing live is an error, not a skipped section, and <b>nothing is written</b>. The fix is a person adding the markers once, with a yes.",
  },
  {
    t: "BRANCH: NOTHING CHANGED",
    blocks: base({ look: ["owned", "= same"], walk: ["owned", "= same"] }),
    code: `${ln(96)}if (body === live) {\n       console.log(<span class="ok">"unchanged"</span>)\n       process.exit(0)\n     }`,
    lede: "If the regenerated sections come out byte-identical, the script exits before any write. No edit call means no pointless write to a PR that other people are reading.",
  },
  {
    t: "WRITE IT BACK",
    blocks: base({
      look: ["swapped", "↻ replaced"],
      walk: ["swapped", "↻ replaced"],
      why: ["kept", "untouched"],
      proven: ["kept", "untouched"],
      how: ["kept", "untouched"],
      evidence: ["kept", "untouched"],
    }),
    code: `${ln(97)}tmp = $TMPDIR/r2-pr-&lt;n&gt;.md\n${ln(99)}gh pr edit &lt;n&gt; -R &lt;repo&gt;\n       --body-file tmp\n${ln(100)}<span class="ok">synced look, walkthrough\n on &lt;repo&gt;#&lt;n&gt;</span>`,
    lede: "The merged body goes to a temp file and back through <code>gh pr edit --body-file</code>. The Why a person tightened and the Evidence a reviewer asked for come through byte for byte.",
  },
];

const stage = $("#stage")!,
  lede = $("#lede")!,
  pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  const blocks = s.blocks
    .map(
      (b, k) =>
        `<div class="sb ${b.c}" data-viz-id="sync-blk-${k}" data-label="${b.name.replaceAll(/&lt;|&gt;/gu, "")}"><span>${b.name}</span><i>${b.tag}</i></div>`,
    )
    .join("");
  stage.innerHTML = `<div><div class="hdr">${i + 1} · ${s.t}</div>${blocks}</div><div class="code">${s.code}</div>`;
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "sync" });
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
