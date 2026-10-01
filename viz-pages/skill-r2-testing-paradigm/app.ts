  import { stepper, arrowMarkers, side, labelBox, $, $$, saveHash, loadHash } from "/_kit/viz.js";
  import type { Box, Point } from "/_kit/viz.js";

  type Node = Box & { rx?: number };
  type Hash = { fan: string; cell: string; loop: number; suite: string };

  // ── shared helpers ──────────────────────────────────────────────────────────
  const K = { real: "var(--k-real)", emu: "var(--k-emu)", fake: "var(--k-fake)", mock: "var(--k-mock)" };
  const mix = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
  // a node is {x,y,w,h}; every rect, label and edge below is derived from one
  const rect = (n: Node, style = "", attrs = "") =>
    `<rect class="box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.rx ?? 8}" style="${style}" ${attrs}/>`;
  const curve = (a: Point, b: Point) => {                       // horizontal S-curve between two points
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  };
  const inset = (n: Box, d: number): Box => ({ x: n.x + d, y: n.y + d, w: n.w - 2 * d, h: n.h - 2 * d });

  // ── WHY: truth table ────────────────────────────────────────────────────────
  {
    const C0 = 200, CW = 272, R0 = 40, RH = 92, G = 8;
    const col = (i: number) => C0 + i * (CW + G), row = (j: number) => R0 + j * (RH + G);
    const cells: [number, number, string, number, string, string][] = [
      [0, 0, "var(--good)", 14, "✓ doing its job", "…if you've ever seen it go red"],
      [1, 0, "var(--danger)", 34, "✗ THEATRE", "green and lying — the mock returns what the test expects"],
      [0, 1, "var(--warn)", 14, "✗ flaky, or a wrong test", "a bug either way — find the root cause"],
      [1, 1, "var(--good)", 30, "✓ caught it", "the only reason the test exists"],
    ];
    let s = "";
    ["the code works", "the code is broken"].forEach((t, i) =>
      s += labelBox({ x: col(i), y: 4, w: CW, h: 30 }, `<span class="n">${t}</span>`, "cap2"));
    ([["test passes", "var(--good)"], ["test fails", "var(--danger)"]] as [string, string][]).forEach(([t, c], j) =>
      s += `<g>${rect({ x: 0, y: row(j), w: 188, h: RH }, `fill:${mix(c, 8)};stroke:${mix(c, 45)}`)}` +
           labelBox({ x: 8, y: row(j), w: 176, h: RH }, `<span class="n" style="color:${c}">${t}</span>`, "l") + `</g>`);
    for (const [i, j, c, p, h, d] of cells) {
      const n = { x: col(i), y: row(j), w: CW, h: RH };
      s += `<g data-viz-id="tt-${i}${j}" data-label="${h}">${rect(n, `fill:${mix(c, p)};stroke:${mix(c, 60)};stroke-width:${i === 1 && j === 0 ? 2.5 : 1}`)}` +
           labelBox(inset(n, 8), `<span class="n" style="font-size:14px;color:${c}">${h}</span><span class="d" style="font-size:12px">${d}</span>`, "col") + `</g>`;
    }
    $("#why-svg")!.innerHTML = s;
  }

  // ── USING: SKILL.md → reference fan-out ─────────────────────────────────────
  {
    type Tr = Box & { id: string; t: string; d: string; reads: string[]; via?: string };
    type Rf = Box & { id: string; t: string; d: string; when: string };
    const TR = [
      { id: "you", t: "you", d: "about to write, fix or review a test", reads: [] },
      { id: "sdlc", t: "r2-sdlc", d: "Implement phase, then review", reads: ["writing"] },
      { id: "rev", t: "test-reviewer", d: "no Skill tool — reads by path", reads: ["reviewing"] },
      { id: "gaunt", t: "r2-gauntlet", d: "via test-reviewer", reads: ["reviewing"], via: "rev" },
    ] as Tr[];
    const RF = [
      { id: "writing", t: "writing.md", d: "loop · slices · GWT · titles · judges", when: "writing a test: the loop, vertical slices, GWT in code, titles, where expected values come from" },
      { id: "scope", t: "scope-and-stand-ins.md", d: "why · environments · auth · fan-out", when: "choosing scope or a stand-in; shared environments; auth in tests; fan-out. The four-rung stand-in order itself lives in SKILL.md — this file holds why it ranks that way" },
      { id: "flaky", t: "flaky-and-slow.md", d: "a flaky or slow test", when: "facing a flaky or slow test, or a failure you can't diagnose" },
      { id: "cov", t: "coverage-and-mutation.md", d: "gates, exclusions, mutants", when: "setting or defending coverage; excluding code; mutation testing" },
      { id: "visual", t: "visual.md", d: "screenshots, baselines", when: "comparing screenshots or approving a baseline" },
      { id: "reviewing", t: "reviewing.md", d: "the reviewer's rubric", when: "reviewing tests — the test-reviewer agent's rubric" },
      { id: "enf", t: "enforcement.md", d: "gates · hatches · blind spots", when: "adding a gate, lint rule, escape hatch or new kind of test, or choosing test tooling (enforcement and tooling)" },
    ] as Rf[];
    const SK = { x: 262, y: 64, w: 196, h: 244 };
    TR.forEach((n, i) => Object.assign(n, { x: 0, y: 26 + i * 84, w: 178, h: 56 }));
    RF.forEach((n, i) => Object.assign(n, { x: 540, y: 2 + i * 52, w: 220, h: 48 }));
    const sk = (y: number) => Math.max(SK.y + 20, Math.min(SK.y + SK.h - 20, y));

    const draw = (sel: { kind: string | undefined; id: string | undefined }) => {
      const on = new Set<string | undefined>(["skill"]);
      if (sel.kind === "tr") { on.add(sel.id); const t = TR.find(n => n.id === sel.id)!; if (t.via) on.add(t.via); t.reads.forEach(r => on.add(r)); if (!t.reads.length) RF.forEach(r => on.add(r.id)); }
      else { on.add(sel.id); TR.forEach(t => { if (t.reads.includes(sel.id!) || !t.reads.length) on.add(t.id); }); }
      const cls = (id: string) => on.has(id) ? "" : "dim";
      let s = arrowMarkers();
      for (const t of TR) {
        const a = side(t, "right");
        if (t.via) {
          const v = TR.find(n => n.id === t.via)!;
          s += `<path class="${cls(t.id)}" d="M ${a.x - 89} ${t.y} L ${a.x - 89} ${v.y + v.h}" stroke="var(--muted)" stroke-width="1.5" fill="none" marker-end="url(#ah)"/>`;
          continue;
        }
        s += `<path class="${cls(t.id)}" d="${curve(a, { x: SK.x, y: sk(a.y) })}" stroke="${on.has(t.id) ? "var(--accent)" : "var(--muted)"}" stroke-width="1.5" fill="none" marker-end="url(#ah${on.has(t.id) ? "-accent" : ""})"/>`;
      }
      const o = side(SK, "right");
      for (const r of RF) {
        const b = side(r, "left");
        s += `<path class="${cls(r.id)}" d="${curve({ x: o.x, y: sk(b.y) }, b)}" stroke="${on.has(r.id) ? "var(--accent)" : "var(--muted)"}" stroke-width="1.5" fill="none" marker-end="url(#ah${on.has(r.id) ? "-accent" : ""})"/>`;
      }
      for (const t of TR)
        s += `<g class="hit ${cls(t.id)}" data-kind="tr" data-id="${t.id}" data-viz-id="reader-${t.id}" data-label="${t.t}">${rect(t, `fill:var(--panel);stroke:${sel.id === t.id ? "var(--accent)" : "var(--border)"}`)}` +
             labelBox(inset(t, 4), `<span class="n">${t.t}</span><span class="d">${t.d}</span>`, "col l") + `</g>`;
      s += `<g data-viz-id="skill-md" data-label="SKILL.md">${rect(SK, "fill:color-mix(in srgb, var(--accent) 10%, var(--panel));stroke:var(--accent)")}` +
           labelBox(inset(SK, 10),
             `<span class="n" style="font-size:14px;color:#fff">SKILL.md</span><span class="d" style="margin-bottom:6px">what every test task needs</span>` +
             ["Black box · test hardest where silent", "Two axes · real → emulated → fake → mock", "A test must be able to fail", "Given / When / Then", "Where to go next →"]
               .map((x, i) => `<span class="d" style="font-size:11.5px;color:${i === 4 ? "var(--accent)" : "var(--text)"};padding:4px 0;border-top:1px solid var(--border);width:100%">${x}</span>`).join(""),
             "col l") + `</g>`;
      for (const r of RF)
        s += `<g class="hit ${cls(r.id)}" data-kind="rf" data-id="${r.id}" data-viz-id="ref-${r.id}" data-label="reference/${r.t}">${rect(r, `fill:var(--panel);stroke:${sel.id === r.id ? "var(--accent)" : "var(--border)"}`)}` +
             labelBox(inset(r, 3), `<span class="n">${r.t}</span><span class="d">${r.d}</span>`, "col l") + `</g>`;
      const svg = $("#fan-svg")!;
      svg.innerHTML = s;
      $$("#fan-svg .hit").forEach(g => g.onclick = () => { saveHash({ ...loadHash(), fan: g.dataset["kind"] + ":" + g.dataset["id"] }); draw({ kind: g.dataset["kind"], id: g.dataset["id"] }); });
      const lede = $("#fan-lede")!;
      if (sel.kind === "rf") { const r = RF.find(n => n.id === sel.id)!; lede.innerHTML = `<b>reference/${r.t}</b> — opened when you are ${r.when}. Nobody reads it otherwise; it stays out of context until the task reaches for it.`; }
      else lede.innerHTML = {
        you: "<b>You</b> read <code>SKILL.md</code> for any test task; its routing table sends you to whichever reference file the task reaches for — only that one.",
        sdlc: "<b>r2-sdlc</b> invokes it before writing any test in Implement, and runs the loop from <code>reference/writing.md</code> one behaviour at a time; its test plan tags each behaviour with a scope.",
        rev: "<b>test-reviewer</b> has no <code>Skill</code> tool, so it opens <code>SKILL.md</code> by path, then <code>reference/reviewing.md</code> as its rubric — and any file a rule points to when it needs the detail.",
        gaunt: "<b>r2-gauntlet</b> doesn't load it directly: it runs <code>test-reviewer</code>, which reads <code>SKILL.md</code> and <code>reviewing.md</code>.",
      }[sel.id as "you" | "sdlc" | "rev" | "gaunt"];
    };
    const [k, id] = (loadHash<Hash>().fan ?? "tr:rev").split(":");
    draw({ kind: k, id });
  }

  // ── HOW 1: the scope × stand-in grid ────────────────────────────────────────
  {
    const COLS = [
      { id: "real", t: "REAL", d: "the actual thing", k: K.real, p: 48 },
      { id: "emu", t: "EMULATED", d: "provided or generated", k: K.emu, p: 32 },
      { id: "fake", t: "FAKE", d: "hand-written, working", k: K.fake, p: 20 },
      { id: "mock", t: "MOCK", d: "call-and-return stub", k: K.mock, p: 6 },
    ];
    const ROWS: { id: string; t: string; u: string; tag?: string }[] = [
      { id: "journey", t: "JOURNEY", u: "user: a person clicking, a shell running a CLI", tag: "default" },
      { id: "service", t: "SERVICE / COMPONENT", u: "user: a consumer of one API, one UI component" },
      { id: "function", t: "FUNCTION", u: "user: a caller · many-input logic only" },
    ];
    const CELL: Record<string, [string, string]> = {
      "journey.real": ["real env · Testcontainers", "The default, top-left of both axes. The whole workflow against the real services — a real database in a container, ideally an <b>ephemeral environment per run or PR</b>, because a shared, changing environment makes tests fail for reasons unrelated to the change."],
      "journey.emu": ["LocalStack · Prism", "Still the whole workflow, but a cloud dependency is <b>emulated</b> — provided or generated for you: LocalStack, an SQS emulator, Microcks or Prism serving an OpenAPI spec. It rejects what the real thing would reject."],
      "journey.fake": ["MSW handlers", "A third party you can't run gets a hand-written <b>fake</b> with working logic that honours its contract — MSW handlers, a fake client. You still assert on the <b>effect</b>."],
      "journey.mock": ["cy.intercept canned", "A \"journey\" whose dependencies return canned bodies passes whatever the code sends. The file shape leaves no in-between folder for a half-mocked journey to hide in; if a mock is truly needed, it carries a written reason."],
      "service.real": ["real DB in a container", "One deployable called the way its consumer calls it, or one UI component driven the way a user drives it, against the real database in a container."],
      "service.emu": ["SQS emulator", "One service with its queue or cloud API <b>emulated</b> — nothing you wrote, so it can't share your misunderstanding of the contract."],
      "service.fake": ["in-memory repo", "An <b>in-memory repository</b> or fake client: working logic, so the test asserts what was stored, not that <code>save</code> was called."],
      "service.mock": ["jest.fn()", "<code>jest.fn()</code> for the repository, then <code>toHaveBeenCalledWith(…)</code>: asserts a call happened, not what it did. When most of a test is mock setup, the assertion is usually about the mocks. Last resort."],
      "function.real": ["inputs → outputs", "Date math, parsers, pricing, state machines: <b>call the real function</b> with inputs and check outputs, exhaustively. This is where unit tests live — a scope, not a rung."],
      "function.emu": ["rarely needed", "Pure logic rarely has a dependency worth standing in for. When it does, the same order applies: the most real one you can get."],
      "function.fake": ["rarely needed", "Pure logic rarely has a dependency worth standing in for. When it does, a working fake beats a stub."],
      "function.mock": ["vi.mock collaborators", "Mocking a function's collaborators turns a logic test into a test of call shape. Last resort."],
    };
    const BAD = ["400 · rejected ✓", "400 · spec says qty ≥ 1 ✓", "400 · honours contract ✓", "{ ok: true } · passes anyway ✗"];
    const X0 = 190, CW = 136, GX = 6, Y0 = 60, RH = 80, GY = 6;
    const cx = (i: number) => X0 + i * (CW + GX), ry = (j: number) => Y0 + j * (RH + GY);

    const draw = (sel: string) => {
      let s = arrowMarkers();
      COLS.forEach((c, i) => {
        const n = { x: cx(i), y: 0, w: CW, h: 50 };
        s += `<g>${rect(n, `fill:${mix(c.k, 10)};stroke:${c.k}`)}` +
             labelBox(n, `<span class="n" style="color:${c.k};letter-spacing:.08em">${c.t}</span><span class="d">${c.d}</span>`, "col") + `</g>`;
      });
      ROWS.forEach((r, j) => {
        const n = { x: 0, y: ry(j), w: X0 - 12, h: RH };
        s += `<g>${rect(n, "fill:var(--panel);stroke:var(--border)")}` +
             labelBox(inset(n, 6), `<span class="n" style="color:${r.tag ? "var(--c5)" : "var(--text)"}">${r.t}${r.tag ? ` <span class="d" style="color:var(--c5)">· ${r.tag}</span>` : ""}</span><span class="d">${r.u}</span>`, "col l") + `</g>`;
        COLS.forEach((c, i) => {
          const key = `${r.id}.${c.id}`, n = { x: cx(i), y: ry(j), w: CW, h: RH };
          const rare = r.id === "function" && (c.id === "emu" || c.id === "fake");
          const on = sel === key;
          s += `<g class="hit" data-key="${key}" data-viz-id="cell-${r.id}-${c.id}" data-label="${r.t.toLowerCase()} × ${c.t.toLowerCase()}">` +
               rect(n, `fill:${mix(c.k, rare ? c.p / 3 : c.p)};stroke:${on ? "var(--accent)" : mix(c.k, 60)};stroke-width:${on ? 2.5 : 1};${c.id === "mock" ? "stroke-dasharray:5 4" : ""}`) +
               labelBox(inset(n, 6), (key === "journey.real" ? `<span class="n" style="font-size:10px;letter-spacing:.1em;color:#0b0f16;background:var(--c5);border-radius:99px;padding:1px 8px;font-weight:700">START</span>` : "") +
                 `<span class="d" style="color:${rare ? "var(--faint)" : "var(--text)"};font-family:var(--mono)">${CELL[key]![0]}</span>`, "col") + `</g>`;
        });
      });
      // axis arrows
      const ay = ry(3) + 4;
      s += `<path d="M ${cx(0)} ${ay} L ${cx(3) + CW} ${ay}" stroke="var(--faint)" stroke-width="1.5" marker-end="url(#ah)"/>` +
           labelBox({ x: cx(0), y: ay + 2, w: CW * 4, h: 22 }, `less real → take the leftmost you can get at this scope`, "cap2 l") +
           `<path d="M ${X0 - 6} ${Y0} L ${X0 - 6} ${ry(2) + RH}" stroke="var(--faint)" stroke-width="1.5" marker-end="url(#ah)"/>`;
      // the contract strip: one wrong request, four answers
      const sy = ay + 36;
      s += `<g>${rect({ x: 0, y: sy, w: X0 - 12, h: 64 }, "fill:none;stroke:var(--border);stroke-dasharray:3 3")}` +
           labelBox({ x: 6, y: sy, w: X0 - 24, h: 64 }, `<span class="d">the same wrong request</span><span class="n" style="font-size:11px">POST /orders {qty: 0}</span>`, "col l") + `</g>`;
      COLS.forEach((c, i) => {
        const n = { x: cx(i), y: sy, w: CW, h: 64 }, ok = i < 3;
        s += `<path d="M ${cx(i) + CW / 2} ${sy - 12} L ${cx(i) + CW / 2} ${sy}" stroke="${c.k}" stroke-width="1.2"/>` +
             `<g data-viz-id="contract-${c.id}" data-label="${c.t.toLowerCase()} answer to a bad request">${rect(n, `fill:${mix(ok ? "var(--good)" : "var(--danger)", 10)};stroke:${mix(ok ? "var(--good)" : "var(--danger)", 50)}`)}` +
             labelBox(inset(n, 5), `<span class="n" style="font-size:11px;color:${ok ? "var(--good)" : "var(--danger)"}">${BAD[i]}</span><span class="d">${ok ? "the test sees the bug" : "the test can't see it"}</span>`, "col") + `</g>`;
      });
      $("#axes-svg")!.innerHTML = s;
      $$("#axes-svg .hit").forEach(g => g.onclick = () => { saveHash({ ...loadHash(), cell: g.dataset["key"] }); draw(g.dataset["key"]!); });
      const [r, c] = sel.split(".");
      $("#axes-lede")!.innerHTML = `<b>${ROWS.find(x => x.id === r)!.t.toLowerCase()} × ${COLS.find(x => x.id === c)!.t.toLowerCase()}</b> — ${CELL[sel]![1]}`;
    };
    draw(CELL[loadHash<Hash>().cell!] ? loadHash<Hash>().cell! : "service.mock");
  }

  // ── HOW 2: the loop, then the sweep (stepper) ───────────────────────────────
  {
    const O = { x: 190, y: 158 }, RAD = 108, NW = 116, NH = 38;
    const NODES = [
      { t: "RED", c: "var(--danger)" }, { t: "GREEN", c: "var(--good)" }, { t: "REFACTOR", c: "var(--accent)" },
      { t: "BREAK IT", c: "var(--warn)" }, { t: "GREEN", c: "var(--good)" },
    ] as (Node & { t: string; c: string })[];
    const ANG = [162, 234, 306, 18, 90];             // clockwise from the left; the last sits at the bottom
    const pt = (a: number) => ({ x: O.x + RAD * Math.cos(a * Math.PI / 180), y: O.y + RAD * Math.sin(a * Math.PI / 180) });
    NODES.forEach((n, i) => { const p = pt(ANG[i]!); Object.assign(n, { x: p.x - NW / 2, y: p.y - NH / 2, w: NW, h: NH }); });
    const SW = { x: 20, y: 340, w: 440, h: 92 }, RP = { x: 500, y: 340, w: 256, h: 92 };
    const CODE = { x: 400, y: 26, w: 356, h: 58 }, TEST = { x: 400, y: 118, w: 356, h: 58 };
    const LAD = [0, 1, 2].map(i => ({ x: 400 + i * 122, y: 220, w: 112, h: 90 }));

    const S: { code: string; test: string; why: string; lede: string; broken?: boolean; sweep?: number }[] = [
      { code: "// not written yet", test: "red", why: "fails for the expected reason",
        lede: "<b>Red.</b> Write one test and watch it fail <em>for the reason you expect</em>. A test that fails on a typo or a missing import hasn't been red yet." },
      { code: "if (order.qty > 0) return place(order)", test: "green", why: "",
        lede: "<b>Green.</b> Write only enough code to pass it." },
      { code: "if (isValid(order)) return place(order)", test: "green", why: "",
        lede: "<b>Refactor.</b> Tidy the code and the test while green." },
      { code: "if (!isValid(order)) return place(order)", test: "red", why: "caught the flipped condition", broken: true,
        lede: "<b>Break it.</b> Flip the condition, drop a line, return early — and watch the test go red. <b>If it stays green, it's checking something else</b>: fix the test. This is the step that proves it can fail." },
      { code: "if (isValid(order)) return place(order)", test: "green", why: "",
        lede: "<b>Green.</b> Restore the code. Then the <b>next test</b> — vertical slices, one test and its implementation at a time, never a batch of tests of imagined behaviour." },
      { code: "…every line the change touched", test: "green", why: "", sweep: 1,
        lede: "<b>Mutation sweep</b>, once the change looks done. A mutant is the change broken on purpose; <b>every mutant must turn at least one test red</b>. Who makes them, first that applies: the repo's tool, the language's standard tool, or 10–20 agent-written mutants applied, tested and reverted one at a time." },
      { code: "…every line the change touched", test: "green", why: "", sweep: 2,
        lede: "<b>The report.</b> Each survivor gets a verdict: killed by a new or sharper test, or explained as equivalent — no observable behaviour changed. <b>Reviewers read the report</b>; they don't run the sweep." },
    ];

    const render = (i: number) => {
      const st = S[i]!, cur = Math.min(i, 4), sweep = st.sweep ?? 0;
      let s = arrowMarkers();
      // arcs between consecutive nodes, along the circle
      for (let k = 0; k < 5; k++) {
        const a = ANG[k]! + 20, b = ANG[k]! + 52, p = pt(a), q = pt(b);
        const active = !sweep && k === (cur + 4) % 5 && i > 0;
        s += `<path d="M ${p.x} ${p.y} A ${RAD} ${RAD} 0 0 1 ${q.x} ${q.y}" stroke="${active ? "var(--accent)" : "var(--faint)"}" stroke-width="${active ? 2.5 : 1.5}" fill="none" marker-end="url(#ah${active ? "-accent" : ""})"/>`;
      }
      s += labelBox({ x: O.x - 70, y: O.y - 30, w: 140, h: 60 }, `<span class="d">one test at a time</span><span class="d" style="color:var(--faint)">↺ next test after the last green</span>`, "col");
      NODES.forEach((n, k) => {
        const on = !sweep && k === cur;
        s += `<g data-viz-id="loop-${k}" data-label="loop step ${n.t.toLowerCase()}" class="${sweep ? "dim" : ""}">` +
             rect(n, `fill:${mix(n.c, on ? 34 : 10)};stroke:${n.c};stroke-width:${on ? 2.5 : 1}`) +
             labelBox(n, `<span class="n" style="color:${on ? "#fff" : n.c};letter-spacing:.08em">${k + 1} · ${n.t}</span>`) + `</g>`;
      });
      // exit to the sweep
      const b4 = side(NODES[4]!, "bottom");
      s += `<path d="M ${b4.x} ${b4.y} L ${b4.x} ${SW.y}" stroke="${sweep ? "var(--accent)" : "var(--faint)"}" stroke-width="${sweep ? 2.5 : 1.5}" marker-end="url(#ah${sweep ? "-accent" : ""})"/>` +
           labelBox({ x: b4.x + 8, y: b4.y + 4, w: 190, h: 38 }, `when the whole change looks done`, "cap2 l");
      // the code and test panels
      const tc = st.test === "red" ? "var(--danger)" : "var(--good)";
      s += labelBox({ x: CODE.x, y: CODE.y - 22, w: 200, h: 20 }, "THE CODE", "cap2 l") +
           `<g data-viz-id="code-panel" data-label="the code at this step">${rect(CODE, `fill:var(--panel);stroke:${st.broken ? "var(--warn)" : "var(--border)"};stroke-width:${st.broken ? 2 : 1}`)}` +
           labelBox(inset(CODE, 8), `<span style="color:${st.broken ? "var(--warn)" : "var(--text)"}">${st.code}</span>`, "code") + `</g>` +
           labelBox({ x: TEST.x, y: TEST.y - 22, w: 200, h: 20 }, "THE TEST", "cap2 l") +
           `<g data-viz-id="test-panel" data-label="the test result at this step">${rect(TEST, `fill:${mix(tc, 12)};stroke:${tc}`)}` +
           `<circle cx="${TEST.x + 22}" cy="${TEST.y + TEST.h / 2}" r="9" fill="${tc}"/>` +
           labelBox({ x: TEST.x + 40, y: TEST.y + 4, w: TEST.w - 48, h: TEST.h - 8 },
             `<span class="n" style="font-size:11.5px">THEN an order of 0 is rejected</span><span class="d" style="color:${tc}">${st.test.toUpperCase()}${st.why ? " — " + st.why : ""}</span>`, "col l") + `</g>`;
      // who makes the mutants
      s += labelBox({ x: 400, y: LAD[0]!.y - 22, w: 356, h: 20 }, "WHO MAKES THE MUTANTS · FIRST THAT APPLIES", "cap2 l");
      [["1 · the repo's", "mutation tool, if it has one"], ["2 · the language's", "Stryker · mutmut · PIT · cargo-mutants"], ["3 · agent-written", "10–20 aimed at the touched lines"]]
        .forEach(([a, b], k) => {
          const n = LAD[k]!;
          s += `<g class="${sweep === 1 ? "" : "dim"}" data-viz-id="mutant-source-${k + 1}" data-label="${a}">${rect(n, `fill:var(--panel);stroke:${sweep === 1 && k === 0 ? "var(--accent)" : "var(--border)"}`)}` +
               labelBox(inset(n, 5), `<span class="n" style="font-size:11px">${a}</span><span class="d">${b}</span>`, "col") + `</g>`;
          if (k < 2) s += `<path class="${sweep === 1 ? "" : "dim"}" d="M ${n.x + n.w} ${n.y + n.h / 2} L ${LAD[k + 1]!.x} ${n.y + n.h / 2}" stroke="var(--faint)" marker-end="url(#ah)"/>`;
        });
      // the sweep: 16 mutants
      s += `<g class="${sweep ? "" : "dim"}" data-viz-id="sweep" data-label="mutation sweep">${rect(SW, `fill:var(--panel);stroke:${sweep === 1 ? "var(--accent)" : "var(--border)"}`)}` +
           labelBox({ x: SW.x + 10, y: SW.y + 4, w: 260, h: 26 }, "MUTATION SWEEP · 16 MUTANTS", "cap2 l");
      for (let m = 0; m < 16; m++) {
        const x = SW.x + 22 + m * 26, y = SW.y + 48;
        const survivor = m === 6 || m === 12;
        const state = !survivor ? "killed" : sweep === 2 ? (m === 6 ? "sharpened" : "equivalent") : "survived";
        const f = { killed: "var(--good)", sharpened: "var(--good)", survived: "none", equivalent: "var(--muted)" }[state];
        const st2 = { killed: "var(--good)", sharpened: "var(--accent)", survived: "var(--danger)", equivalent: "var(--muted)" }[state];
        s += `<circle cx="${x}" cy="${y}" r="9" fill="${f}" stroke="${st2}" stroke-width="${state === "killed" ? 1 : 2.5}" data-viz-id="mutant-${m + 1}" data-label="mutant ${m + 1}: ${state}"/>`;
      }
      s += labelBox({ x: SW.x + 10, y: SW.y + 62, w: SW.w - 20, h: 26 },
             sweep === 2 ? `<span style="color:var(--good)">●</span> killed · <span style="color:var(--accent)">◉</span> sharper test · <span style="color:var(--muted)">●</span> equivalent`
                         : `<span style="color:var(--good)">●</span> 14 killed · <span style="color:var(--danger)">○</span> 2 survived — no test catches them`, "cap2 l") + `</g>`;
      s += `<path class="${sweep ? "" : "dim"}" d="M ${SW.x + SW.w} ${SW.y + SW.h / 2} L ${RP.x} ${RP.y + RP.h / 2}" stroke="${sweep === 2 ? "var(--accent)" : "var(--faint)"}" stroke-width="1.5" marker-end="url(#ah${sweep === 2 ? "-accent" : ""})"/>` +
           `<g class="${sweep === 2 ? "" : "dim"}" data-viz-id="mutation-report" data-label="mutation report">${rect(RP, `fill:var(--panel);stroke:${sweep === 2 ? "var(--accent)" : "var(--border)"}`)}` +
           labelBox(inset(RP, 10), `<span class="n">MUTATION REPORT</span><span class="d">every survivor: killed or explained</span><span class="d" style="color:var(--text)">→ the reviewer reads it</span>`, "col l") + `</g>`;
      $("#loop-svg")!.innerHTML = s;
      $("#loop-lede")!.innerHTML = st.lede;
      $("#pos")!.textContent = `${i + 1} / ${S.length}`;
    };
    const st = stepper({ n: S.length, onStep: render, autoplayMs: 3200, hashKey: "loop" });
    render(Math.min(Math.max(loadHash<Hash>().loop ?? 0, 0), S.length - 1));
    $("#next")!.onclick = () => st.next();
    $("#prev")!.onclick = () => st.prev();
    const play = $("#play")!;
    let on = false;
    play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
    for (const el of [$("#next")!, $("#prev")!]) el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });
  }

  // ── HOW 3: three coverage instruments ───────────────────────────────────────
  {
    const J = ["sign up", "log in", "check out", "refund an order", "export a report"];
    const SUITES: Record<"A" | "B", { j: number[]; line: number; floor: number; prev: number | null; killed: number; eq: number; lede: string }> = {
      A: { j: [1, 0, 0, 0, 0], line: 100, floor: 95, prev: null, killed: 3, eq: 0,
           lede: "<b>Suite A</b> runs every line — the gate is happy at <b>100%</b> — yet it covers one journey and kills 3 of 16 mutants. <b>Covered ≠ tested</b>: only the other two instruments can see it." },
      B: { j: [1, 1, 1, 1, 1], line: 97, floor: 97, prev: 95, killed: 15, eq: 1,
           lede: "<b>Suite B</b> has lower line coverage than A, and it's the suite that protects something: every workflow has a journey test, 15 mutants die, the last is an explained equivalent. Its 97% lifts the floor from 95 — the floor only rises." },
    };
    const P = [0, 1, 2].map(i => ({ x: i * 258, y: 0, w: 244, h: 318 }));
    const HEAD: [string, string, string, string][] = [
      ["JOURNEY COVERAGE", "Does every user workflow have a test?", "QUALITY SIGNAL", "var(--c5)"],
      ["LINE + BRANCH", "Is there code no test runs?", "A GATE", "var(--warn)"],
      ["BREAK-IT / MUTATION", "Would the tests notice if the code were wrong?", "PROOF IT CAN FAIL", "var(--c4)"],
    ];
    const draw = (key: "A" | "B") => {
      const S = SUITES[key];
      let s = arrowMarkers();
      P.forEach((p, i) => {
        const [t, q, role, c] = HEAD[i]!;
        s += `<g data-viz-id="instrument-${i + 1}" data-label="${t.toLowerCase()}">${rect(p, `fill:var(--panel);stroke:var(--border)`)}` +
             labelBox({ x: p.x + 10, y: p.y + 8, w: p.w - 20, h: 48 }, `<span class="n" style="color:${c};letter-spacing:.06em">${t}</span><span class="d">${q}</span>`, "col l") +
             rect({ x: p.x + 10, y: p.y + p.h - 34, w: p.w - 20, h: 24, rx: 12 }, `fill:${mix(c, 14)};stroke:${mix(c, 50)}`) +
             labelBox({ x: p.x + 10, y: p.y + p.h - 34, w: p.w - 20, h: 24 }, `<span class="n" style="font-size:10.5px;color:${c};letter-spacing:.1em">${role}</span>`) + `</g>`;
      });
      // 1 · journeys
      J.forEach((name, k) => {
        const y = 70 + k * 38, ok = S.j[k];
        s += `<g data-viz-id="journey-${k + 1}" data-label="journey ${name}: ${ok ? "tested" : "no test"}">` +
             rect({ x: 16, y, w: 22, h: 22, rx: 5 }, `fill:${ok ? "var(--good)" : "none"};stroke:${ok ? "var(--good)" : "var(--faint)"}`) +
             labelBox({ x: 16, y, w: 22, h: 22 }, ok ? `<span style="color:#0b0f16;font-weight:700">✓</span>` : "") +
             labelBox({ x: 44, y: y - 2, w: 190, h: 26 }, `<span style="color:${ok ? "var(--text)" : "var(--faint)"}">${name}</span>`, "l") + `</g>`;
      });
      s += labelBox({ x: 10, y: 256, w: 224, h: 26 }, `<span class="n">${S.j.reduce((a: number, b: number) => a + b)} / 5 workflows</span>`, "l");
      // 2 · the gate bar (0–100%)
      const B = { x: 258 + 40, y: 70, w: 50, h: 196 }, yv = (v: number) => B.y + B.h * (1 - v / 100);
      s += `<g data-viz-id="line-bar" data-label="line and branch coverage ${S.line}%">` +
           rect(B, "fill:#0b0f16;stroke:var(--border)", "") +
           rect({ x: B.x, y: yv(S.line), w: B.w, h: B.h * S.line / 100, rx: 4 }, `fill:${mix("var(--warn)", 55)}`) + `</g>` +
           `<path d="M ${B.x - 8} ${yv(100)} L ${B.x + B.w + 8} ${yv(100)}" stroke="var(--muted)" stroke-dasharray="3 3"/>` +
           labelBox({ x: B.x + B.w + 12, y: yv(100) - 16, w: 130, h: 18 }, "aim 100%", "cap2 l") +
           `<path d="M ${B.x - 8} ${yv(S.floor)} L ${B.x + B.w + 8} ${yv(S.floor)}" stroke="var(--danger)" stroke-width="2.5" data-viz-id="floor" data-label="coverage floor ${S.floor}%"/>` +
           labelBox({ x: B.x + B.w + 12, y: yv(S.floor) - 1, w: 130, h: 44 }, `<span style="color:var(--danger)">floor ${S.floor}%</span>${S.prev ? `<span class="d">↑ raised from ${S.prev}</span>` : `<span class="d">below it, the build fails</span>`}`, "cap2 col l") +
           labelBox({ x: B.x + B.w + 12, y: 150, w: 130, h: 40 }, `<span class="big">${S.line}%</span>`, "l");
      // 3 · mutants
      for (let m = 0; m < 16; m++) {
        const x = 516 + 40 + (m % 4) * 46, y = 88 + Math.floor(m / 4) * 42;
        const st = m < S.killed ? "killed" : m < S.killed + S.eq ? "equivalent" : "survived";
        const f = { killed: "var(--good)", equivalent: "var(--muted)", survived: "none" }[st];
        s += `<circle cx="${x}" cy="${y}" r="12" fill="${f}" stroke="${st === "survived" ? "var(--danger)" : f}" stroke-width="2" data-viz-id="cov-mutant-${m + 1}" data-label="mutant ${m + 1}: ${st}"/>`;
      }
      s += labelBox({ x: 526, y: 256, w: 224, h: 26 }, `<span class="n">${S.killed} / 16 killed${S.eq ? " · 1 explained" : ""}</span>`, "l");
      $("#cov-svg")!.innerHTML = s;
      $("#cov-lede")!.innerHTML = S.lede;
      $("#suiteA")!.setAttribute("aria-pressed", String(key === "A"));
      $("#suiteB")!.setAttribute("aria-pressed", String(key === "B"));
    };
    $("#suiteA")!.onclick = () => { saveHash({ ...loadHash(), suite: "A" }); draw("A"); };
    $("#suiteB")!.onclick = () => { saveHash({ ...loadHash(), suite: "B" }); draw("B"); };
    draw(loadHash<Hash>().suite === "B" ? "B" : "A");
  }

  // ── HOW 4: sleep vs signal; the 1-in-25 hang ────────────────────────────────
  {
    const T0 = 210, PX = 175;                       // x of t=0, px per second (0–3 s)
    const tx = (t: number) => T0 + t * PX;
    const ROWS: [string, string, number, number, string][] = [
      ["sleep(2000)", "fast run", 0.8, 2.0, "wasted"],
      ["sleep(2000)", "loaded CI run", 2.4, 2.0, "flaky"],
      ["wait for data-state=\"done\"", "fast run", 0.8, 0.8, "ok"],
      ["wait for data-state=\"done\"", "loaded CI run", 2.4, 2.4, "ok"],
    ];
    let s = arrowMarkers();
    ROWS.forEach(([how, run, done, asserted, kind], j) => {
      const y = 8 + j * 46, h = 26;
      s += labelBox({ x: 0, y: y - 4, w: T0 - 12, h: 34 }, `<span class="n" style="font-size:11px;color:${kind === "ok" ? "var(--c5)" : "var(--text)"}">${how}</span><span class="d">${run}</span>`, "col l") +
           `<g data-viz-id="wait-${j + 1}" data-label="${how}, ${run}: ${kind}">` +
           rect({ x: tx(0), y, w: done * PX, h, rx: 4 }, `fill:${mix("var(--c5)", 40)};stroke:var(--c5)`) +
           (kind === "wasted" ? rect({ x: tx(done), y, w: (asserted - done) * PX, h, rx: 4 }, `fill:${mix("var(--warn)", 18)};stroke:var(--warn);stroke-dasharray:4 3`) +
             labelBox({ x: tx(done), y, w: (asserted - done) * PX, h }, `<span class="d" style="color:var(--warn)">1.2 s wasted, every run</span>`) : "") +
           `<path d="M ${tx(asserted)} ${y - 5} L ${tx(asserted)} ${y + h + 5}" stroke="${kind === "flaky" ? "var(--danger)" : "var(--good)"}" stroke-width="3"/>` +
           labelBox({ x: tx(Math.max(asserted, done)) + 6, y, w: 170, h }, `<span class="d" style="color:${kind === "flaky" ? "var(--danger)" : "var(--good)"}">${kind === "flaky" ? "✗ asserted before done" : "✓ assert"}</span>`, "l") + `</g>`;
    });
    const ay = 196;
    s += `<path d="M ${tx(0)} ${ay} L ${tx(3)} ${ay}" stroke="var(--faint)"/>`;
    for (let t = 0; t <= 3; t++) s += `<path d="M ${tx(t)} ${ay} L ${tx(t)} ${ay + 5}" stroke="var(--faint)"/>` + labelBox({ x: tx(t) - 20, y: ay + 6, w: 40, h: 18 }, `${t} s`, "cap2");
    s += labelBox({ x: 0, y: ay - 6, w: T0 - 12, h: 32 }, `<span style="color:var(--c5)">■</span>&nbsp;the work under test`, "cap2 l");
    $("#wait-svg")!.innerHTML = s;

    const STRIPS: [string, string, (k: number) => string][] = [
      ["as found", "hangs about 1 run in 25", (k: number) => k === 17 ? "bad" : "ok"],
      ["force onload to fail", "onload with no onerror · 25 / 25 hang", () => "bad"],
      ["handle the error", "25 / 25 pass — fixed, not retried", () => "ok"],
    ];
    let f = "";
    STRIPS.forEach(([t, d, fn], j) => {
      const y = 6 + j * 42;
      f += labelBox({ x: 0, y: y - 2, w: 200, h: 40 }, `<span class="n" style="font-size:11px">${t}</span><span class="d">${d}</span>`, "col l");
      for (let k = 0; k < 25; k++) {
        const bad = fn(k) === "bad";
        f += `<circle cx="${218 + k * 21.5}" cy="${y + 17}" r="8" fill="${bad ? "var(--danger)" : mix("var(--good)", 70)}" data-viz-id="run-${j + 1}-${k + 1}" data-label="${t}, run ${k + 1}: ${bad ? "hang" : "pass"}"/>`;
      }
    });
    $("#flake-svg")!.innerHTML = f;
  }

  // ── HOW 5: visual baselines ─────────────────────────────────────────────────
  {
    const shot = (n: Box, label: string, changed: boolean) => {
      let s = rect(n, "fill:var(--panel);stroke:var(--border)") +
        labelBox({ x: n.x, y: n.y - 22, w: n.w, h: 20 }, label, "cap2 l") +
        rect({ x: n.x + 10, y: n.y + 12, w: 70, h: 10, rx: 3 }, `fill:${mix("var(--text)", 30)}`) +
        rect({ x: n.x + 10, y: n.y + 34, w: n.w - 20, h: 34, rx: 4 }, `fill:${mix(changed ? "var(--c4)" : "var(--accent)", 28)}`) +
        rect({ x: n.x + 10, y: n.y + 76, w: n.w - 60, h: 8, rx: 3 }, `fill:${mix("var(--text)", 18)}`) +
        rect({ x: n.x + 10, y: n.y + 90, w: n.w - 80, h: 8, rx: 3 }, `fill:${mix("var(--text)", 18)}`);
      const m = { x: n.x + n.w - 62, y: n.y + 8, w: 52, h: 18, rx: 3 };
      return s + `<g data-viz-id="mask-${label.split(" ")[0]}" data-label="mask over the clock">${rect(m, "fill:#000;stroke:var(--warn)")}` +
        labelBox(m, `<span class="d" style="color:var(--warn);font-family:var(--mono)">mask</span>`) + `</g>`;
    };
    const BL = { x: 0, y: 30, w: 160, h: 110 }, NW2 = { x: 186, y: 30, w: 160, h: 110 };
    const DF = { x: 384, y: 60, w: 110, h: 50 }, PR = { x: 530, y: 42, w: 230, h: 86 };
    let s = arrowMarkers();
    s += `<g data-viz-id="baseline" data-label="approved baseline">${shot(BL, "BASELINE (approved)", false)}</g>` +
         `<g data-viz-id="new-shot" data-label="new picture">${shot(NW2, "NEW PICTURE", true)}</g>`;
    s += `<path d="${curve(side(NW2, "right"), side(DF, "left"))}" stroke="var(--muted)" fill="none" marker-end="url(#ah)"/>` +
         `<g data-viz-id="diff" data-label="diff">${rect(DF, "fill:var(--panel);stroke:var(--border)")}${labelBox(DF, `<span class="n">diff</span><span class="d">masked regions ignored</span>`, "col")}</g>` +
         `<path d="${curve(side(DF, "right"), side(PR, "left"))}" stroke="var(--accent)" fill="none" marker-end="url(#ah-accent)"/>` +
         `<g data-viz-id="person" data-label="a person decides">${rect(PR, "fill:color-mix(in srgb, var(--accent) 12%, var(--panel));stroke:var(--accent)")}` +
         labelBox(inset(PR, 8), `<span class="n" style="color:#fff">a person looks</span><span class="d">is the change a bug, or the point?</span>`, "col l") + `</g>`;
    const out1 = side(PR, "bottom"), by = 196;
    s += `<path d="M ${out1.x - 50} ${out1.y} L ${out1.x - 50} ${by} L ${BL.x + BL.w / 2} ${by} L ${BL.x + BL.w / 2} ${BL.y + BL.h + 4}" stroke="var(--good)" stroke-width="1.8" fill="none" marker-end="url(#ah-good)"/>` +
         labelBox({ x: 180, y: by - 26, w: 320, h: 26 }, `<span style="color:var(--good)">the point → approved, becomes the baseline</span>`, "cap2 l") +
         `<path d="M ${out1.x + 50} ${out1.y} L ${out1.x + 50} ${by - 10}" stroke="var(--danger)" stroke-width="1.8" fill="none" marker-end="url(#ah-danger)"/>` +
         labelBox({ x: out1.x - 20, y: by - 8, w: 160, h: 26 }, `<span style="color:var(--danger)">a bug → fix the code</span>`, "cap2");
    $("#vis-svg")!.innerHTML = s;
  }

  // ── HOW 6: enforcement shapes ───────────────────────────────────────────────
  {
    let s = arrowMarkers();
    s += labelBox({ x: 0, y: 0, w: 340, h: 20 }, "FILE SHAPE ENFORCES THE TIER", "cap2 l");
    const F: [string, string, string, boolean][] = [
      ["tests/journey/", "the journey suffix · one folder per scope", "var(--c5)", true],
      ["tests/half-mocked-journey/", "no such folder — nowhere to hide", "var(--danger)", false],
      ["tests/service/", "one API · one component", "var(--c5)", true],
      ["tests/function/", "many-input logic", "var(--c5)", true],
    ];
    F.forEach(([p, d, _c, ok], k) => {
      const n = { x: 0, y: 30 + k * 50, w: 340, h: 40 };
      s += `<g data-viz-id="folder-${k + 1}" data-label="${p}">${rect(n, `fill:${ok ? "var(--panel)" : mix("var(--danger)", 8)};stroke:${ok ? "var(--border)" : "var(--danger)"};${ok ? "" : "stroke-dasharray:5 4"}`)}` +
           labelBox(inset(n, 4), `<span class="n" style="color:${ok ? "var(--text)" : "var(--danger)"};${ok ? "" : "text-decoration:line-through"}">${ok ? "▸" : "✗"} ${p}</span><span class="d">${d}</span>`, "col l") + `</g>`;
    });
    s += labelBox({ x: 400, y: 0, w: 360, h: 20 }, "ONE ARTIFACT, SEVERAL JOBS", "cap2 l");
    const ST = { x: 400, y: 100, w: 130, h: 50 };
    s += `<g data-viz-id="story" data-label="one Storybook story">${rect(ST, "fill:color-mix(in srgb, var(--c4) 16%, var(--panel));stroke:var(--c4)")}${labelBox(ST, `<span class="n">one story</span><span class="d">written once</span>`, "col")}</g>`;
    ["component catalogue", "interaction test", "screenshot baseline"].forEach((t, k) => {
      const n = { x: 590, y: 36 + k * 64, w: 170, h: 46 };
      s += `<path d="${curve(side(ST, "right"), side(n, "left"))}" stroke="var(--c4)" fill="none" marker-end="url(#ah)"/>` +
           `<g data-viz-id="job-${k + 1}" data-label="${t}">${rect(n, "fill:var(--panel);stroke:var(--border)")}${labelBox(n, `<span class="n" style="font-size:11.5px">${t}</span>`)}</g>`;
    });
    $("#enf-svg")!.innerHTML = s;
  }

  // ── HOW 7: the review matrix ────────────────────────────────────────────────
  {
    const SRC = ["SKILL.md", "scope-and-stand-ins", "writing", "flaky-and-slow", "coverage-and-mutation", "visual", "enforce&shy;ment"];
    const CHK: [string, number][] = [
      ["Black box", 0], ["Scope fits", 0], ["Most real stand-in", 0], ["Asserts effects, not calls", 0],
      ["Can fail", 0], ["Mutation report", 4], ["GWT", 0], ["Titles: it / test", 2],
      ["Vertical slices", 2], ["No sleeps, no order", 3], ["No retries or quarantine", 3], ["Coverage floor, exclusions", 4],
      ["Baselines approved, masked", 5], ["Strictness follows control", 1], ["Escape hatches carry reasons", 6], ["Setup-to-assertion ratio", 0],
      ["Independent judges", 2], ["Silent failures covered hardest", 0], ["Journeys covered", 4], ["Fan-out proven", 1], ["Auth through code", 1],
    ];
    const LX = 270, CWm = 70, HY = 64, RHm = 22;
    const COLC = ["var(--accent)", "var(--c5)", "var(--good)", "var(--warn)", "var(--c4)", "var(--c8)", "var(--danger)"];
    let s = "";
    SRC.forEach((t, i) => s += labelBox({ x: LX + i * CWm, y: 0, w: CWm, h: HY - 6 }, `<span class="d" style="color:${COLC[i]};font-family:var(--mono);font-size:10px;word-break:break-word">${t.replace(/-/g, "-<wbr>")}</span>`, "col"));
    CHK.forEach(([t, src], j) => {
      const y = HY + j * RHm;
      s += `<g class="row-hl" data-viz-id="check-${j + 1}" data-label="check ${j + 1}: ${t} → ${SRC[src]!.replace("&shy;", "")}">` +
           `<rect class="band" x="0" y="${y}" width="${LX + SRC.length * CWm}" height="${RHm}" fill="${j % 2 ? "transparent" : mix("var(--text)", 3)}"/>` +
           labelBox({ x: 0, y, w: LX - 8, h: RHm }, `<span class="d" style="color:var(--text);font-size:11.5px"><span style="color:var(--faint);font-family:var(--mono)">${String(j + 1).padStart(2, " ")}</span>&nbsp; ${t}</span>`, "l");
      SRC.forEach((_, i) => s += `<circle cx="${LX + i * CWm + CWm / 2}" cy="${y + RHm / 2}" r="${i === src ? 6 : 1.5}" fill="${i === src ? COLC[i] : "var(--border)"}"/>`);
      s += `</g>`;
    });
    $("#rev-svg")!.innerHTML = s;
  }
