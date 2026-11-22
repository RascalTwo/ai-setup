import { stepper, need, esc } from "@viz/kit";

type Row = [string, string, "ok" | "bad" | "warn"];
interface Step {
  /** the box in the lane diagram */
  box: string;
  lane: number;
  /** the heading over the rows */
  t: string;
  rows: Row[];
  lede: string;
}

const LANES = [
  "git",
  "lib/review.ts",
  "the page + api.ts",
  ".viz-data/state.json",
  "the agent, review.ts CLI",
];

// One hunk's life. Every name below is a real function, file or route.
const S: Step[] = [
  {
    box: "git show",
    lane: 0,
    t: "READ THE COMMITS",
    rows: [
      ["rev-list --reverse --no-merges base..head", "oldest first", "ok"],
      ["git show -M -U3 <sha>", "one diff per commit", "ok"],
      ["range base...head", "read as base..head", "ok"],
      ["a bad range", "error on that repo's line", "bad"],
    ],
    lede: "<code>readCommits</code> follows a <b>branch name</b>, not a SHA, so a rewrite stays in the same review. A range that git cannot read is shown as an error on that repo and the rest of the review still builds.",
  },
  {
    box: "parseDiff",
    lane: 1,
    t: "CUT THE DIFF INTO HUNKS",
    rows: [
      ["diff --git a/… b/…", "a file", "ok"],
      ["@@ -12,6 +12,8 @@", "a hunk", "ok"],
      ["lines starting ␠ + − \\", "the hunk's lines, prefix kept", "ok"],
      ["rename from / to, Binary files", "oldPath, binary: no hunks", "ok"],
    ],
    lede: "<code>parseDiff</code> is plain text parsing with no git call. The path is cleaned of <code>a/</code>, <code>b/</code> and the tab git adds after a path with a space in it.",
  },
  {
    box: "fp → ID",
    lane: 1,
    t: "FINGERPRINT, THEN NAME",
    rows: [
      ["sha256(repo ␀ path ␀ the + and − lines)", "29b33e08c7…", "ok"],
      ["@@ header, context lines, commit SHA", "left out", "warn"],
      ["words(fp): 126 adjectives × 120 nouns", "dainty ocean", "ok"],
      ["two fps, one pair, in one review", "second gets a third word", "warn"],
    ],
    lede: "<code>hunkFp</code> hashes only what the hunk adds and removes, in this file. <code>words</code> turns the first eight hex digits into two words, so <b>dainty ocean</b> is the same name for as long as those lines are the same.",
  },
  {
    box: "render",
    lane: 2,
    t: "ORDER AND DRAW",
    rows: [
      ["GET /review", "api.ts → buildReview(dir)", "ok"],
      ["order.json: commit by subject or SHA prefix", "the agent's reading order", "ok"],
      [
        "files: listed first, then prod, test, docs, binary, lock",
        "lock and binary start folded",
        "ok",
      ],
      ["unlisted commits", "follow in git order", "ok"],
    ],
    lede: "<code>buildReview</code> runs steps 1 to 3 on every call, sorts by <code>order.json</code>, and hands the page a view with each hunk's <b>fp</b> and <b>ID</b>. Nothing is cached; git is read fresh each time.",
  },
  {
    box: "press a",
    lane: 2,
    t: "THE REVIEWER MARKS IT",
    rows: [
      ["a", "✓ approve, then on to the next hunk", "ok"],
      ["c / q", "✎ change this / ? question, cursor in the note", "ok"],
      ["the same key again", "clears the mark", "ok"],
      ["✓ all on a file", "one mark per hunk, one at a time", "ok"],
    ],
    lede: "The page sends <code>{fp, kind: &quot;hunk&quot;, mark: &quot;ok&quot;}</code>. It never sends the lines; the server looks them up.",
  },
  {
    box: "POST /mark",
    lane: 3,
    t: "THE MARK IS WRITTEN DOWN",
    rows: [
      ["setMark: look fp up in a fresh buildReview", "finds the hunk", "ok"],
      ["marks[fp] = mark, repo, path, id, lines, note, at", "its content is saved too", "ok"],
      ["state.json.tmp → rename", "never half a file", "ok"],
      ["an fp nothing in the review has", "refused", "bad"],
    ],
    lede: "The mark is keyed by <b>fingerprint</b> and carries a copy of the hunk's lines, so that after a rewrite the page still knows what you looked at.",
  },
  {
    box: "refresh",
    lane: 4,
    t: "THE AGENT REWRITES",
    rows: [
      ["amend, rebase, force-push", "same branch name, new SHAs", "ok"],
      ["review.ts reply <name> <id> <text>", "the answer, on the hunk", "ok"],
      ["review.ts refresh <name>", "writes refreshed.txt, nothing else", "ok"],
      ["↻ Refresh on the page", "re-reads without a reload", "ok"],
    ],
    lede: "<code>refresh</code> reads no git. Writing a file beside the page makes viz reload it, and the page keeps its place from the URL hash (commit subject and hunk). The read happens when the page asks <code>/review</code> again.",
  },
  {
    box: "applyMarks",
    lane: 1,
    t: "THE MARK FINDS ITS HUNK",
    rows: [
      ["fp still in the review", "kept", "ok"],
      ["fp gone, was ✓", "changed since you approved", "warn"],
      ["fp gone, was ✎ or ?", "addressed: re-review", "warn"],
      ["fp gone, no unmarked hunk in that file", "orphan, shown by status", "bad"],
    ],
    lede: "A gone mark moves to the <b>most similar unmarked hunk at the same repo and path</b> that shares at least one changed line. Flags and questions are placed before approvals, so if two marks want one hunk the reviewer's note wins. On the example: <b>dainty ocean</b> is now <b>sugary owl</b>, 1 shared line of 3 (0.33), so it comes back as changed since you approved.",
  },
];

// ── the lane diagram ────────────────────────────────────────────────────────
const W = 800;
const PAD = 6;
const PITCH = (W - PAD * 2) / S.length;
const BOX_W = 84;
const BOX_H = 26;
const BAND = 54;
const H = LANES.length * BAND + 8;
const bx = (i: number): number => PAD + i * PITCH + (PITCH - BOX_W) / 2;
const cy = (lane: number): number => 4 + lane * BAND + 25 + BOX_H / 2;

function laneSvg(at: number): string {
  const bands = LANES.map(
    (name, l) =>
      `<rect x="0" y="${4 + l * BAND}" width="${W}" height="${BAND}" fill="${l % 2 ? "transparent" : "#ffffff08"}"/>` +
      `<line x1="0" x2="${W}" y1="${4 + l * BAND}" y2="${4 + l * BAND}" stroke="var(--border)"/>` +
      `<text x="6" y="${4 + l * BAND + 13}" font-size="10.5" fill="var(--muted)" font-family="var(--mono)" letter-spacing="0.06em">${esc(name)}</text>`,
  ).join("");
  const arrows = S.slice(1)
    .map((s, k) => {
      const i = k + 1;
      const prev = S[k];
      if (!prev) return "";
      const x1 = bx(k) + BOX_W;
      const x2 = bx(i);
      const xm = (x1 + x2) / 2;
      const done = i <= at;
      return `<path d="M${x1} ${cy(prev.lane)} H${xm} V${cy(s.lane)} H${x2 - 1}" fill="none" stroke="${done ? "var(--c5)" : "var(--faint)"}" stroke-width="1.5" marker-end="url(#ah${done ? "on" : "off"})"/>`;
    })
    .join("");
  const boxes = S.map((s, i) => {
    const on = i === at;
    const past = i < at;
    const stroke = on ? "var(--c5)" : past ? "var(--c4)" : "var(--border)";
    const fill = on ? "color-mix(in srgb, var(--c5) 24%, #0b0f16)" : "#11161f";
    return `<g class="node" data-step="${i}" data-viz-id="node-${i + 1}" data-label="step ${i + 1}: ${esc(s.box)} in lane ${esc(LANES[s.lane] ?? "")}" style="cursor:pointer" opacity="${i > at ? 0.55 : 1}">
      <rect x="${bx(i)}" y="${cy(s.lane) - BOX_H / 2}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${on ? 2 : 1}"/>
      <text x="${bx(i) + BOX_W / 2}" y="${cy(s.lane) + 4}" text-anchor="middle" font-size="11.5" font-family="var(--mono)" fill="${on ? "#fff" : "var(--text)"}">${esc(s.box)}</text>
      <text x="${bx(i) + BOX_W - 3}" y="${cy(s.lane) - BOX_H / 2 - 3}" text-anchor="end" font-size="9.5" font-family="var(--mono)" fill="${on ? "var(--c5)" : "var(--faint)"}">${i + 1}</text>
    </g>`;
  }).join("");
  const marker = (id: string, c: string): string =>
    `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${c}"/></marker>`;
  return `<svg class="lane-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Eight steps of one hunk's life across five lanes: git, lib/review.ts, the page, state.json and the agent">
    <defs>${marker("ahon", "var(--c5)")}${marker("ahoff", "var(--faint)")}</defs>
    ${bands}${arrows}${boxes}</svg>`;
}

const COLOUR = { ok: "var(--good)", warn: "var(--warn)", bad: "var(--danger)" } as const;
const MARK = { ok: "✓", warn: "●", bad: "✗" } as const;

const stage = need("#stage"),
  lede = need("#lede"),
  pos = need("#pos");

const render = (i: number): void => {
  const s = S[i];
  if (!s) return; // the stepper only asks for 0 … n-1
  stage.innerHTML =
    laneSvg(i) +
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:8px">${i + 1} · ${s.t}</div>` +
    s.rows
      .map(
        ([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:12.5px;
                  padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${esc(k)}</span>
        <span style="color:${COLOUR[st]};text-align:right">${MARK[st]} ${esc(v)}</span>
      </div>`,
      )
      .join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 3600, hashKey: "hunk" });
need("#next").addEventListener("click", () => st.next());
need("#prev").addEventListener("click", () => st.prev());
stage.addEventListener("click", (e) => {
  const hit = e.target instanceof Element ? e.target.closest<SVGElement>("[data-step]") : null;
  if (hit) st.go(Number(hit.dataset["step"] ?? 0));
});
const play = need("#play");
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
for (const el of [need("#next"), need("#prev"), stage]) el.addEventListener("click", stopPlay);
