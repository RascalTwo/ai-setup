import { describe, it, expect } from "bun:test";
import {
  agentId,
  agentName,
  callExcerpt,
  endsFinal,
  cleanLabel,
  completeLines,
  brushRange,
  clampRange,
  helperTree,
  idleSpan,
  summariseRound,
  panBy,
  timeScale,
  zoomAround,
  describe as say,
  laneOf,
  asksLane,
  shellSteps,
  needsLabel,
  parseLines,
  redact,
  renderMarkdown,
  stripMarkdown,
  splitReplies,
  waitingSpans,
} from "../model.ts";

const line = (o: object): string => JSON.stringify(o);
const T = "2026-10-12T01:00:00.000Z";
const T2 = "2026-10-12T01:00:05.000Z";

describe("sorting actions into lanes", () => {
  it("should put read-only shell commands in Look and mutating ones in Change", async () => {
    const cmds = await viz.given("three shell commands", () => [
      "cd /repo && grep -rn foo .",
      "sed -i s/a/b/ f",
      "npm install",
    ]);
    const lanes = await viz.when("each is classified", () =>
      cmds.map((command) => laneOf("Bash", { command })),
    );
    await viz.then("they land in Look, Change and Run", () => {
      expect(lanes).toEqual(["look", "change", "run"]);
    });
  });

  it("should give a chain the lane of its strongest step, whatever comes first", async () => {
    const cmds = await viz.given("chains, pipes, quotes, loops and redirects", () => ({
      "curl -s x | jq .": "run",
      "git status && git commit -m 'a; b'": "change",
      "grep -E 'a|b; c' f": "look",
      "uv run pytest -q": "verify",
      "docker build -t x .": "verify",
      "cd ~ && bun ~/.claude/skills/viz/viz.ts verify x > log 2>&1; echo exit=$?": "verify",
      "echo hi > notes.txt": "change",
      "echo hi > /dev/null; ls": "look",
      "for i in 1 2; do ls; sleep 1; done": "look",
      "FOO=1 sudo make test": "verify",
      "cd /tmp": "look",
    }));
    const lanes = await viz.when("each is classified", () =>
      Object.keys(cmds).map((command) => laneOf("Bash", { command })),
    );
    await viz.then("each lands where its strongest step belongs", () => {
      expect(lanes.join()).toBe(Object.values(cmds).join());
    });
  });

  it("should ask the model about a script only when the rules cannot already tell", async () => {
    const cmds = await viz.given(
      "scripts alone, beside an edit, and in a heredoc that pipes",
      () => [
        "python3 -I - <<'EOF'\nimport os; os.remove('x') | y\nEOF",
        "sed -i x f && python3 s.py",
        "bash deploy.sh && pytest",
        "ls",
      ],
    );
    const out = await viz.when("each is classified", () =>
      cmds.map((command) => [laneOf("Bash", { command }), asksLane("Bash", { command })]),
    );
    await viz.then("a script is Run (or stronger) until asked, and an edit needs no asking", () => {
      expect(out).toEqual([
        ["run", true],
        ["change", false],
        ["verify", true],
        ["look", false],
      ]);
      expect(shellSteps("python3 - <<'EOF'\na; b | c\nEOF")).toEqual(["python3 - <<HEREDOC"]);
    });
  });

  it("should treat MCP tools as Outside and unknown tools as Plan", async () => {
    const tools = await viz.given("an MCP tool and a skill", () => [
      "mcp__atlassian__getJiraIssue",
      "Skill",
    ]);
    const lanes = await viz.when("each is classified", () => tools.map((t) => laneOf(t, {})));
    await viz.then("they are Outside and Plan", () => {
      expect(lanes).toEqual(["outside", "plan"]);
    });
  });
});

describe("plain-English labels", () => {
  it("should prefer the command's own description over the raw command", async () => {
    const input = await viz.given("a Bash call with a description", () => ({
      command: "docker build -t x .",
      description: "Build the image",
    }));
    const d = await viz.when("it is labelled", () => say("Bash", input));
    await viz.then("the label is the description and the detail is the command", () => {
      expect(d.label).toBe("Build the image");
      expect(d.detail).toBe("docker build -t x .");
    });
  });

  it("should name the file being edited", async () => {
    const input = await viz.given("an Edit of a source file", () => ({
      file_path: "/r/src/server.ts",
    }));
    const d = await viz.when("it is labelled", () => say("Edit", input));
    await viz.then("it says which file", () => {
      expect(d.label).toBe("Editing server.ts");
      expect(d.file).toBe("/r/src/server.ts");
    });
  });
});

describe("keeping secrets off the shared screen", () => {
  it("should mask tokens in commands", async () => {
    const cmd = await viz.given(
      "a command carrying a bearer token and a GitHub token",
      () => "curl -H 'Authorization: Bearer abcdefghijklmnop' ghp_0123456789abcdefghijABCDEFGHIJ",
    );
    const out = await viz.when("it is redacted", () => redact(cmd));
    await viz.then("neither secret survives", () => {
      expect(out).not.toContain("abcdefghijklmnop");
      expect(out).not.toContain("ghp_0123");
    });
  });
});

describe("parsing a transcript", () => {
  it("should pair a tool call with its result, keep typed prompts, and skip subagent lines", async () => {
    const text = await viz.given(
      "a transcript with a prompt, a call, its result, a reply and a sidechain line",
      () =>
        [
          line({ type: "user", timestamp: T, message: { content: "fix the build" } }),
          line({
            type: "user",
            timestamp: T,
            message: { content: "<command-name>/clear</command-name>" },
          }),
          line({
            type: "assistant",
            timestamp: T,
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "Write",
                  input: { file_path: "/a/b.txt", content: "1\n2\n3" },
                },
              ],
            },
          }),
          line({
            type: "user",
            timestamp: T2,
            message: {
              content: [
                { type: "tool_result", tool_use_id: "t1", is_error: true, content: "nope" },
              ],
            },
          }),
          line({
            type: "assistant",
            timestamp: T2,
            message: { content: [{ type: "text", text: "Done." }] },
          }),
          line({
            type: "assistant",
            isSidechain: true,
            timestamp: T2,
            message: { content: [{ type: "text", text: "subagent chatter" }] },
          }),
          "{not json",
        ].join("\n"),
    );
    const out = await viz.when("it is parsed", () => parseLines(text));
    await viz.then(
      "there is one prompt, one call with its size, one failed result and one reply",
      () => {
        expect(out.prompts.map((p) => p.text)).toEqual(["fix the build"]);
        expect(out.calls[0]).toMatchObject({
          id: "t1",
          lane: "change",
          label: "Writing b.txt",
          plus: 3,
          minus: 0,
          start: Date.parse(T),
        });
        expect(out.results[0]).toMatchObject({ id: "t1", error: true, end: Date.parse(T2) });
        expect(out.says.map((s) => s.text)).toEqual(["Done."]);
      },
    );
  });

  it("should hold back a half-written last line until it is complete", async () => {
    const buf = await viz.given("a buffer that ends mid-line", () => '{"a":1}\n{"b":');
    const r = await viz.when("it is split into complete lines", () => completeLines(buf));
    await viz.then("only the full line is handed on", () => {
      expect(r).toEqual({ done: '{"a":1}\n', rest: 5 });
    });
  });
});

describe("reading a subagent's transcript", () => {
  const sub = [
    line({
      type: "user",
      isSidechain: true,
      timestamp: T,
      message: { content: "You are a helper. Fix the lint." },
    }),
    line({
      type: "assistant",
      isSidechain: true,
      timestamp: T,
      message: {
        content: [
          { type: "text", text: "On it." },
          { type: "tool_use", id: "s1", name: "Bash", input: { command: "viz verify" } },
        ],
      },
    }),
    line({
      type: "user",
      isSidechain: true,
      timestamp: T2,
      message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "ok" }] },
    }),
  ].join("\n");

  it("should tag a helper's calls with its id and description and keep its results", async () => {
    const tag = await viz.given("a helper's id and description", () => "a1 Clear viz lint gate");
    const out = await viz.when("its own transcript is parsed", () => parseLines(sub, tag));
    await viz.then("its call carries the tag and its result is kept", () => {
      expect(out.calls.map((c) => c.agent)).toEqual([tag]);
      expect(out.results.map((r) => r.id)).toEqual(["s1"]);
    });
    await viz.then("its task prompt and chatter stay out of the room's view", () => {
      expect(out.prompts).toEqual([]);
      expect(out.says).toEqual([]);
    });
  });

  it("should keep sidechain lines out of the main transcript and tag its calls main", async () => {
    await viz.given("a helper's sidechain lines");
    const out = await viz.when("a helper's lines are parsed as the main transcript", () =>
      parseLines(sub),
    );
    await viz.then("nothing is drawn from them", () => {
      expect(out).toEqual({ calls: [], results: [], prompts: [], says: [] });
    });
    const main = await viz.when("a normal call is parsed", () =>
      parseLines(
        line({
          type: "assistant",
          timestamp: T,
          message: { content: [{ type: "tool_use", id: "m", name: "Read", input: {} }] },
        }),
      ),
    );
    await viz.then("it is tagged main", () => {
      expect(main.calls[0]?.agent).toBe("main");
    });
  });

  it("should split an agent tag into its id and its description", async () => {
    const tag = await viz.given("a tag with a spaced description", () => "a1 Clear viz lint gate");
    const parts = await viz.when("it is split", () => [agentId(tag), agentName(tag)]);
    await viz.then("the id and the description come back", () => {
      expect(parts).toEqual(["a1", "Clear viz lint gate"]);
    });
  });
});

describe("deciding which calls need a model-written label", () => {
  it("should flag MCP tools, unknown tools and Bash with no description only", async () => {
    const cases = await viz.given(
      "a spread of tool calls",
      () =>
        [
          ["mcp__atlassian__getJiraIssue", {}],
          ["EnterWorktree", {}],
          ["Bash", { command: "ls" }],
          ["Bash", { command: "ls", description: "List files" }],
          ["Read", { file_path: "/a" }],
          ["Agent", { description: "x" }],
        ] as const,
    );
    const flags = await viz.when("each is checked", () =>
      cases.map(([tool, input]) => needsLabel(tool, input)),
    );
    await viz.then("only the first three need one", () => {
      expect(flags).toEqual([true, true, true, false, false, false]);
    });
  });

  it("should carry a redacted summary of the input on calls that need a label", async () => {
    const text = await viz.given("an MCP call carrying a token, and a Read", () =>
      [
        {
          type: "tool_use",
          id: "c1",
          name: "mcp__x__send",
          input: { auth: "Bearer abcdefghijklmnop" },
        },
        { type: "tool_use", id: "c2", name: "Read", input: { file_path: "/a" } },
      ]
        .map((c) =>
          line({
            type: "assistant",
            timestamp: T,
            message: { content: [c] },
          }),
        )
        .join("\n"),
    );
    const out = await viz.when("it is parsed", () => parseLines(text));
    await viz.then("the first is flagged with a summary that hides the token", () => {
      expect(out.calls[0]?.needsLabel).toBe(true);
      expect(out.calls[0]?.summary).toContain("auth");
      expect(out.calls[0]?.summary).not.toContain("abcdefghijklmnop");
    });
    await viz.then("the Read is not flagged and has no summary", () => {
      expect(out.calls[1]).toMatchObject({ needsLabel: false, summary: "" });
    });
  });
});

describe("tidying a model's label", () => {
  it("should strip quotes and the full stop and keep every word, on one line", async () => {
    const raws = await viz.given("a quoted label, a rambling one and a blank one", () => [
      '"Looking up Jira issue HYD-42."',
      "one two three four five six seven eight nine ten\nsecond line",
      "  \n ",
    ]);
    const out = await viz.when("each is cleaned", () => raws.map((r) => cleanLabel(r)));
    await viz.then("they come back tidy and whole, or null", () => {
      expect(out).toEqual([
        "Looking up Jira issue HYD-42",
        "one two three four five six seven eight nine ten second line",
        null,
      ]);
    });
  });
});

describe("laying out helpers", () => {
  it("should list helpers depth-first, nested under the helper that launched them", async () => {
    const calls = await viz.given(
      "helpers h1 and h3 from main, h2 from h1, and h9 with no launcher",
      () => [
        { id: "p", agent: "main", start: 0 },
        { id: "s2", agent: "h1 Lint", start: 20 },
        { id: "s1", agent: "h1 Lint", start: 10 },
        { id: "n1", agent: "h2 Nested", start: 30 },
        { id: "f1", agent: "h3 Later", start: 40 },
        { id: "g1", agent: "h9 Ghost", start: 5 },
      ],
    );
    const nodes = await viz.when("the tree is built", () =>
      helperTree(
        [
          { id: "h1", toolUseId: "p" },
          { id: "h2", toolUseId: "s2" },
          { id: "h3", toolUseId: "p" },
          { id: "h2", toolUseId: "n1" },
        ],
        calls,
      ),
    );
    await viz.then("rows run in start order with children right after their parent", () => {
      expect(nodes.map((n) => [n.id, n.depth, n.parent, n.start])).toEqual([
        ["h9", 1, null, 5],
        ["h1", 1, null, 10],
        ["h2", 2, "h1", 30],
        ["h3", 1, null, 40],
      ]);
      expect(nodes[1]?.name).toBe("Lint");
    });
  });
});

describe("summarising a finished round", () => {
  it("should split the round's time by lane and name the slowest action", async () => {
    const calls = await viz.given(
      "a long build, a short read, a running call and one before the round",
      () => [
        { lane: "run" as const, label: "Build", start: 1000, end: 7000 },
        { lane: "look" as const, label: "Read", start: 1000, end: 3000 },
        { lane: "run" as const, label: "Test", start: 8000, end: null },
        { lane: "plan" as const, label: "Old", start: 0, end: 500 },
      ],
    );
    const s = await viz.when("the round from 1000 to 10000 is summarised", () =>
      summariseRound(calls, 1000, 10000),
    );
    await viz.then("run holds 8s of 10s, look 2s, and Build is the slowest", () => {
      expect(s.totalMs).toBe(9000);
      expect(s.lanes).toEqual([
        { lane: "run", ms: 8000, pct: 80 },
        { lane: "look", ms: 2000, pct: 20 },
      ]);
      expect(s.slowest).toEqual({ label: "Build", ms: 6000 });
    });
  });

  it("should have no lanes and no slowest action when nothing ran", async () => {
    await viz.given("a round with no calls");
    const s = await viz.when("it is summarised", () => summariseRound([], 0, 5000));
    await viz.then("only the total is set", () => {
      expect(s).toEqual({ totalMs: 5000, lanes: [], slowest: null });
    });
  });
});

describe("folding idle gaps", () => {
  const MIN = 60_000;
  const busy: [number, number][] = [
    [0, 10 * MIN],
    [120 * MIN, 180 * MIN],
  ];

  it("should give the busy parts the width and a fixed box to the gap", async () => {
    await viz.given("busy spans 0-10m and 120-180m with a 110m gap, over 1000px with 30px breaks");
    const s = await viz.when("the scale is built with 5m folded", () =>
      timeScale(0, 180 * MIN, 1000, busy, 5 * MIN, 30),
    );
    await viz.then("there is one break between the spans and 970px for the 70 busy minutes", () => {
      const per = 970 / (70 * MIN);
      expect(s.activeMs).toBe(70 * MIN);
      expect(s.breaks).toHaveLength(1);
      expect(s.breaks[0]?.x0).toBeCloseTo(10 * MIN * per, 6);
      expect(s.breaks[0]?.x1).toBeCloseTo(10 * MIN * per + 30, 6);
      expect(s.x(0)).toBe(0);
      expect(s.x(10 * MIN)).toBeCloseTo(10 * MIN * per, 6);
      expect(s.x(120 * MIN)).toBeCloseTo(10 * MIN * per + 30, 6);
      expect(s.x(180 * MIN)).toBeCloseTo(1000, 6);
    });
    await viz.then(
      "a time inside the gap lands inside the break, and later times keep their spacing",
      () => {
        const inside = s.x(65 * MIN);
        expect(inside).toBeGreaterThan(s.breaks[0]?.x0 ?? 0);
        expect(inside).toBeLessThan(s.breaks[0]?.x1 ?? 0);
        expect(s.x(150 * MIN) - s.x(120 * MIN)).toBeCloseTo(30 * MIN * (970 / (70 * MIN)), 6);
      },
    );
  });

  it("should stay linear when no gap is folded", async () => {
    await viz.given("the same spans with folding off");
    const s = await viz.when("the scale is built with an infinite minimum gap", () =>
      timeScale(0, 180 * MIN, 900, busy, Infinity, 30),
    );
    await viz.then("time maps straight to pixels", () => {
      expect(s.breaks).toEqual([]);
      expect(s.x(90 * MIN)).toBeCloseTo(450, 6);
    });
  });

  it("should fold a trailing gap and ignore overlapping spans", async () => {
    await viz.given("overlapping spans then 52 quiet minutes");
    const s = await viz.when("the scale is built", () =>
      timeScale(
        0,
        60 * MIN,
        500,
        [
          [0, 6 * MIN],
          [3 * MIN, 8 * MIN],
          [4 * MIN, 5 * MIN],
        ],
        5 * MIN,
        20,
      ),
    );
    await viz.then("the one break starts where the last span ends", () => {
      expect(s.breaks.map((b) => [b.from, b.to])).toEqual([[8 * MIN, 60 * MIN]]);
      expect(s.x(8 * MIN)).toBeCloseTo(480, 6);
    });
  });

  it("should word a gap's length briefly", async () => {
    const spans = await viz.given("42 minutes and two hours five minutes", () => [
      42 * MIN,
      125 * MIN,
    ]);
    const words = await viz.when("they are worded", () => spans.map(idleSpan));
    await viz.then("they read 42m and 2h 05m", () => {
      expect(words).toEqual(["42m", "2h 05m"]);
    });
  });
});

describe("reading what was said", () => {
  it("should keep typed prompts and replies whole, strip paste wrappers, and count queued messages", async () => {
    const long = `${"word ".repeat(1000)}\nsecond line`;
    const text = await viz.given(
      "a pasted prompt, a long prompt, a long reply, a queued message, a task notification and another attachment",
      () =>
        [
          line({
            type: "user",
            timestamp: T,
            message: {
              content: 'see this <pasted_content id="cc7f">\nthe pasted body\n</pasted_content>',
            },
          }),
          line({ type: "user", timestamp: T, message: { content: long } }),
          line({
            type: "assistant",
            timestamp: T,
            message: { content: [{ type: "text", text: `${"reply ".repeat(100)}\nline two` }] },
          }),
          line({
            type: "attachment",
            timestamp: T2,
            attachment: {
              type: "queued_command",
              prompt: "And yeah, one more thing",
              commandMode: "prompt",
            },
          }),
          line({
            type: "attachment",
            timestamp: T2,
            attachment: {
              type: "queued_command",
              prompt: "<task-notification>done</task-notification>",
            },
          }),
          line({ type: "attachment", timestamp: T2, attachment: { type: "hook_success" } }),
        ].join("\n"),
    );
    const out = await viz.when("it is parsed", () => parseLines(text));
    await viz.then(
      "the paste wrapper is gone but its text stays, and the queued message is a prompt",
      () => {
        expect(out.prompts.map((p) => p.text.slice(0, 29))).toEqual([
          "see this \nthe pasted body",
          "word word word word word word",
          "And yeah, one more thing",
        ]);
        expect(out.prompts.map((p) => p.at)).toEqual([
          Date.parse(T),
          Date.parse(T),
          Date.parse(T2),
        ]);
      },
    );
    await viz.then(
      "long text is cut at 4000 characters with its line breaks, and replies are whole",
      () => {
        const p = out.prompts[1]?.text ?? "";
        expect(p.length).toBe(4000);
        expect(p.endsWith("…")).toBe(true);
        expect(out.says[0]?.text.length).toBeGreaterThan(240);
        expect(out.says[0]?.text).toContain("\nline two");
      },
    );
  });

  it("should record where each call's line starts, in bytes, from a given origin", async () => {
    const text = await viz.given("two calls on lines with a multi-byte character before them", () =>
      [
        line({ type: "user", timestamp: T, message: { content: "café time" } }),
        line({
          type: "assistant",
          timestamp: T,
          message: { content: [{ type: "tool_use", id: "a", name: "Read", input: {} }] },
        }),
        line({
          type: "assistant",
          timestamp: T,
          message: { content: [{ type: "tool_use", id: "b", name: "Read", input: {} }] },
        }),
      ].join("\n"),
    );
    const out = await viz.when("it is parsed as if it began at byte 100", () =>
      parseLines(text, "main", 100),
    );
    await viz.then("the offsets match the real byte positions", () => {
      const enc = new TextEncoder();
      const [l0, l1] = text.split("\n");
      const first = 100 + enc.encode(l0 ?? "").length + 1;
      expect(out.calls.map((c) => c.pos)).toEqual([first, first + enc.encode(l1 ?? "").length + 1]);
    });
  });
});

describe("re-reading a call from its transcript", () => {
  const use = line({
    type: "assistant",
    timestamp: T,
    message: {
      content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "uv run pytest" } }],
    },
  });
  const done = (extra: object): string =>
    line({
      type: "user",
      timestamp: T2,
      message: { content: [{ type: "tool_result", tool_use_id: "t1", ...extra }] },
    });

  it("should find the call's tool, input and result, with the error flag, redacted", async () => {
    const text = await viz.given(
      "a call, noise, and an error result in parts with a token in it",
      () =>
        [
          use,
          "not json",
          line({ type: "user", timestamp: T, message: { content: "chatter" } }),
          done({
            is_error: true,
            content: [
              { type: "text", text: "1 failed" },
              { type: "text", text: "Bearer abcdefghijklmnop" },
            ],
          }),
        ].join("\n"),
    );
    const found = await viz.when("it is looked up", () => callExcerpt(text, "t1"));
    await viz.then(
      "tool, input and result come back, the token hidden, flagged as an error",
      () => {
        expect(found?.tool).toBe("Bash");
        expect(found?.input).toContain("uv run pytest");
        expect(found?.error).toBe(true);
        expect(found?.result).toContain("1 failed");
        expect(found?.result).not.toContain("abcdefghijklmnop");
      },
    );
  });

  it("should give a string result, no result yet, or nothing for an unknown call", async () => {
    const ok = await viz.given("a call with a plain-text result", () =>
      [use, done({ content: "all passed" })].join("\n"),
    );
    const results = await viz.when(
      "it, a call with no result, and an unknown id are looked up",
      () => [
        callExcerpt(ok, "t1")?.result,
        callExcerpt(use, "t1")?.result,
        callExcerpt(use, "nope"),
      ],
    );
    await viz.then("they are the text, null, and null", () => {
      expect(results).toEqual(["all passed", null, null]);
    });
  });
});

describe("rendering a reply as Markdown", () => {
  it("should render bold, code, lists, links and fenced code, and escape everything else", async () => {
    const src = await viz.given(
      "a reply using each feature plus raw HTML and a javascript link",
      () =>
        [
          "Hello **world** with `a<b>` and [docs](https://example.com/a?x=1&y=2).",
          "<script>alert(1)</script> [bad](javascript:alert(1))",
          "",
          "- one",
          "- two **bold**",
          "1. first",
          "```",
          "raw <b> & code",
          "```",
          "last line",
        ].join("\n"),
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("each feature becomes its tag", () => {
      expect(html).toContain("<strong>world</strong>");
      expect(html).toContain("<code>a&lt;b&gt;</code>");
      expect(html).toContain(
        '<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener">docs</a>',
      );
      expect(html).toContain("<ul><li>one</li><li>two <strong>bold</strong></li></ul>");
      expect(html).toContain("<ol><li>first</li></ol>");
      expect(html).toContain("<pre><code>raw &lt;b&gt; &amp; code</code></pre>");
      expect(html).toContain("<p>last line</p>");
    });
    await viz.then("raw HTML is escaped and a javascript link is not a link", () => {
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain('href="javascript');
    });
  });

  it("should close an unfinished code fence and a list before a paragraph", async () => {
    const src = await viz.given("a list then text, then a fence that never closes", () =>
      ["* a", "text after", "```", "open"].join("\n"),
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("the list and paragraph are closed and the code is kept", () => {
      expect(html).toBe("<ul><li>a</li></ul><p>text after</p><pre><code>open</code></pre>");
    });
  });
});

describe("zooming and panning the range", () => {
  const r = { t0: 1000, t1: 2000 };

  it("should keep the anchor in place when zooming, and not move it when panning", async () => {
    await viz.given("a range 1000 to 2000 and an anchor a quarter of the way in");
    const zoomed = await viz.when(
      "it is zoomed in to half and out to double around the anchor",
      () => [zoomAround(r, 1250, 0.5), zoomAround(r, 1250, 2), panBy(r, 300)],
    );
    await viz.then("the anchor keeps its fraction and the span scales", () => {
      expect(zoomed[0]).toEqual({ t0: 1125, t1: 1625 });
      expect(zoomed[1]).toEqual({ t0: 750, t1: 2750 });
      expect(zoomed[2]).toEqual({ t0: 1300, t1: 2300 });
    });
  });

  it("should brush in either order, with a minimum length", async () => {
    await viz.given("two times given the wrong way round, and two almost equal");
    const out = await viz.when("they are brushed", () => [
      brushRange(5000, 2000),
      brushRange(2000, 2001),
    ]);
    await viz.then("both are ordered and at least 5s long", () => {
      expect(out).toEqual([
        { t0: 2000, t1: 7000 },
        { t0: 2000, t1: 7000 },
      ]);
    });
  });

  it("should keep a range inside the bounds and between 5s and the bounds' length", async () => {
    await viz.given("bounds of 0 to 100000");
    const bounds = { t0: 0, t1: 100_000 };
    const out = await viz.when(
      "ranges that run off either end, are too short, or too long are clamped",
      () => [
        clampRange({ t0: -500, t1: 9500 }, bounds),
        clampRange({ t0: 95_000, t1: 105_000 }, bounds),
        clampRange({ t0: 10, t1: 20 }, bounds),
        clampRange({ t0: -1e6, t1: 1e6 }, bounds),
        clampRange({ t0: 5, t1: 10 }, { t0: 0, t1: 1000 }),
      ],
    );
    await viz.then("each lands inside, at its fixed length where it can", () => {
      expect(out).toEqual([
        { t0: 0, t1: 10_000 },
        { t0: 90_000, t1: 100_000 },
        { t0: 10, t1: 5010 },
        { t0: 0, t1: 100_000 },
        { t0: 0, t1: 5000 },
      ]);
    });
  });

  it("should turn pixels back into times across folded gaps, and ignore spans outside the view", async () => {
    const MIN = 60_000;
    await viz.given("busy spans with a 110m gap, one more span far outside the view");
    const s = await viz.when("the scale is built over 0 to 180m", () =>
      timeScale(
        0,
        180 * MIN,
        1000,
        [
          [0, 10 * MIN],
          [120 * MIN, 180 * MIN],
          [400 * MIN, 500 * MIN],
        ],
        5 * MIN,
        30,
      ),
    );
    await viz.then("t undoes x before, inside and after the break", () => {
      for (const t of [0, 4 * MIN, 9 * MIN, 60 * MIN, 125 * MIN, 179 * MIN]) {
        expect(s.t(s.x(t))).toBeCloseTo(t, 3);
      }
      expect(s.breaks).toHaveLength(1);
    });
  });
});

describe("rendering tables, headings and quotes", () => {
  it("should render a table with escaped cells, inline formatting and an escaped pipe", async () => {
    const src = await viz.given(
      "a table with code, bold, raw HTML and an escaped pipe in its cells",
      () =>
        [
          "Before",
          "| Name | Note |",
          "|:---|---:|",
          "| `a<b>` | **bold** |",
          "| x \\| y | <i>raw</i> |",
          "After",
        ].join("\n"),
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("it is a header row, body rows, and text around it", () => {
      expect(html).toBe(
        "<p>Before</p><table><thead><tr><th>Name</th><th>Note</th></tr></thead><tbody>" +
          "<tr><td><code>a&lt;b&gt;</code></td><td><strong>bold</strong></td></tr>" +
          "<tr><td>x | y</td><td>&lt;i&gt;raw&lt;/i&gt;</td></tr></tbody></table><p>After</p>",
      );
    });
  });

  it("should not take a line with a pipe for a table without a separator, and allow a table with no body", async () => {
    await viz.given("a piped line, and a header plus separator only");
    const html = await viz.when("they are rendered", () => [
      renderMarkdown("a | b\nc"),
      renderMarkdown("| h |\n|---|"),
    ]);
    await viz.then("the first stays a paragraph and the second is an empty table", () => {
      expect(html[0]).toBe("<p>a | b<br>c</p>");
      expect(html[1]).toBe("<table><thead><tr><th>h</th></tr></thead><tbody></tbody></table>");
    });
  });

  it("should render headings of every level and keep inline formatting in them", async () => {
    const src = await viz.given("a heading of level 1, 3 and 6, and a hash with no space", () =>
      ["# One", "### Three `x`", "###### Six", "#nospace"].join("\n"),
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("the levels become h1, h3 and h6, and the last is plain text", () => {
      expect(html).toBe("<h1>One</h1><h3>Three <code>x</code></h3><h6>Six</h6><p>#nospace</p>");
    });
  });

  it("should render a multi-line blockquote with formatting, and end it at the next block", async () => {
    const src = await viz.given("a two-line quote with bold, then a paragraph and a list", () =>
      ["> one **two**", ">three", "after", "- item"].join("\n"),
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("the quote is one blockquote and the rest follow it", () => {
      expect(html).toBe(
        "<blockquote>one <strong>two</strong><br>three</blockquote><p>after</p><ul><li>item</li></ul>",
      );
    });
  });
});

describe("lists, emphasis and quotes of Markdown", () => {
  it("should keep an ordered list's numbers across nested bullets", async () => {
    const src = await viz.given(
      "items 3 and 4 with bullets between them, and a list starting at 1",
      () =>
        ["3. **Zoom and pan:**", "- bullets", "4. **Backfill:**", "", "1. one", "2. two"].join(
          "\n",
        ),
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("each numbered run starts at its own number", () => {
      expect(html).toBe(
        '<ol start="3"><li><strong>Zoom and pan:</strong></li></ol><ul><li>bullets</li></ul>' +
          '<ol start="4"><li><strong>Backfill:</strong></li></ol><ol><li>one</li><li>two</li></ol>',
      );
    });
  });

  it("should read code inside bold and italic, and leave code spans alone", async () => {
    const src = await viz.given(
      "bold and italic around code, and bold marks inside a code span",
      () => "**Raw `| pipes |` here.** *and `x` too* `**not bold**` 2 * 3 * 4",
    );
    const html = await viz.when("it is rendered", () => renderMarkdown(src));
    await viz.then("code nests in bold and italic and the span's own markers stay literal", () => {
      expect(html).toBe(
        "<p><strong>Raw <code>| pipes |</code> here.</strong> <em>and <code>x</code> too</em> " +
          "<code>**not bold**</code> 2 * 3 * 4</p>",
      );
    });
  });

  it("should reduce Markdown to plain words for a one-line quote", async () => {
    const src = await viz.given(
      "a reply with bold, code, a link, a heading, a quote, a list and a table",
      () =>
        [
          "### Plan",
          "> **Note** `x`",
          "- see [docs](https://e.com/a)",
          "| a | b |",
          "|---|---|",
          "| 1 | 2 |",
        ].join("\n"),
    );
    const out = await viz.when("it is stripped", () => stripMarkdown(src));
    await viz.then("no markers are left, and the table reads as runs", () => {
      expect(out.replaceAll(/\s+/gu, " ").trim()).toBe("Plan Note x see docs · a · b · · 1 · 2 ·");
    });
  });
});

describe("telling whether a helper has finished", () => {
  const asst = (content: object[]): string =>
    line({ type: "assistant", timestamp: T, message: { content } });

  it("should call a helper final only when its last line is a reply with no call after it", async () => {
    await viz.given(
      "transcripts ending on a reply, a call, a result, nothing, and a half-written line",
    );
    const out = await viz.when("their tails are checked", () => [
      endsFinal(
        asst([{ type: "tool_use", id: "a", name: "Read", input: {} }]) +
          "\n" +
          asst([{ type: "text", text: "Done." }]) +
          "\n",
      ),
      endsFinal(
        asst([{ type: "text", text: "Looking." }]) +
          "\n" +
          asst([{ type: "tool_use", id: "a", name: "Read", input: {} }]) +
          "\n",
      ),
      endsFinal(
        line({
          type: "user",
          timestamp: T,
          message: { content: [{ type: "tool_result", tool_use_id: "a", content: "x" }] },
        }) + "\n",
      ),
      endsFinal(""),
      endsFinal(asst([{ type: "text", text: "Done." }]) + '\n{"half":'),
    ]);
    await viz.then("only the first and the last (whose half line is ignored) are final", () => {
      expect(out).toEqual([true, false, false, false, true]);
    });
  });
});

describe("telling replies from notes", () => {
  it("should keep only Claude's last words before each prompt, and its latest, as replies", async () => {
    const prompts = await viz.given("prompts at 0 and 100", () => [
      { at: 0, text: "go" },
      { at: 100, text: "more" },
    ]);
    const out = await viz.when("three things said in the first round and two in the second", () =>
      splitReplies(prompts, [
        { at: 120, text: "e" },
        { at: 10, text: "a" },
        { at: 50, text: "b" },
        { at: 90, text: "c" },
        { at: 110, text: "d" },
      ]),
    );
    await viz.then("the last of each round is a reply and the rest are notes", () => {
      expect(out.replies.map((s) => s.text)).toEqual(["c", "e"]);
      expect(out.notes.map((s) => s.text)).toEqual(["a", "b", "d"]);
    });
  });
});

describe("finding when Claude waited on a person", () => {
  it("should span from a final reply to the next prompt only while nothing ran", async () => {
    const prompts = await viz.given("prompts at 0, 100 and 200", () =>
      [0, 100, 200].map((at) => ({ at, text: "p" })),
    );
    const says = [
      { at: 50, text: "done one" },
      { at: 150, text: "done two" },
      { at: 250, text: "done three" },
    ];
    const run = { start: 160, end: 180 };
    const spans = await viz.when("the second wait was filled by a background call", () => ({
      open: waitingSpans(prompts, says, [run], 300),
      shut: waitingSpans(prompts, says, [run], null),
      running: waitingSpans(prompts, says, [{ start: 260, end: null }], 300),
    }));
    await viz.then(
      "the first wait counts, the busy one does not, and the last stays open to now",
      () => {
        expect(spans.open).toEqual([
          [50, 100],
          [250, 300],
        ]);
        expect(spans.shut).toEqual([[50, 100]]);
        expect(spans.running).toEqual([
          [50, 100],
          [150, 200],
        ]);
      },
    );
  });
});
