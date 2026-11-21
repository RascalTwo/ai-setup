import { describe, it, expect, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const root = mkdtempSync(path.join(tmpdir(), "csl-"));
process.env["CLAUDE_PROJECTS_DIR"] = root;
process.env["RINGSIDE_LABEL_CACHE"] = path.join(root, "labels.json");
process.env["RINGSIDE_OUTCOME_CACHE"] = path.join(root, "outcomes.json");
process.env["RINGSIDE_BEAT_CACHE"] = path.join(root, "beats.json");
process.env["RINGSIDE_LANE_CACHE"] = path.join(root, "lanes.json");
process.env["RINGSIDE_STORY_CACHE"] = path.join(root, "stories.json");
const api = (await import("../api.ts")).default;

const T = "2026-10-12T01:00:00.000Z";
const row = (o: object): string => JSON.stringify(o) + "\n";
const asJson = async (r: unknown): Promise<unknown> => {
  return r instanceof Response ? await r.json() : r;
};
const httpStatus = (r: unknown): number => (r instanceof Response ? r.status : 200);
/** Replaces fetch with a stand-in for Ollama; the returned spy restores the real one. */
const stubFetch = (impl: () => Response): ReturnType<typeof spyOn<typeof globalThis, "fetch">> =>
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        await Promise.resolve(); // like the real fetch, answer on a later tick
        return impl();
      },
      { preconnect: fetch.preconnect },
    ),
  );

// <root>/-proj/<session>.jsonl with one Agent call, and a helper under <session>/subagents/.
const proj = path.join(root, "-proj");
mkdirSync(path.join(proj, SESSION, "subagents"), { recursive: true });
writeFileSync(
  path.join(proj, `${SESSION}.jsonl`),
  row({ type: "user", timestamp: T, cwd: "/work/repo", message: { content: "fix it" } }) +
    row({
      type: "assistant",
      timestamp: T,
      message: { content: [{ type: "tool_use", id: "toolu_1", name: "Agent", input: {} }] },
    }) +
    '{"half":',
);
writeFileSync(
  path.join(proj, SESSION, "subagents", "agent-h1.jsonl"),
  row({
    type: "assistant",
    isSidechain: true,
    timestamp: T,
    message: { content: [{ type: "tool_use", id: "s1", name: "Bash", input: { command: "ls" } }] },
  }),
);
writeFileSync(
  path.join(proj, SESSION, "subagents", "agent-h1.meta.json"),
  JSON.stringify({ description: "Clear lint", toolUseId: "toolu_1" }),
);
writeFileSync(path.join(proj, SESSION, "subagents", "agent-h2.jsonl"), "");
// h3 has finished: its transcript ends on a plain assistant reply.
writeFileSync(
  path.join(proj, SESSION, "subagents", "agent-h3.jsonl"),
  row({
    type: "assistant",
    isSidechain: true,
    timestamp: T,
    message: { content: [{ type: "text", text: "All done." }] },
  }),
);
writeFileSync(path.join(proj, SESSION, "subagents", "notes.txt"), "not a transcript");

// A second session with a failing Bash call (and its result) and a helper's call with a result,
// so /outcome can re-read them. `pos` is the byte offset of the call's line.
const SESSION2 = "bbbbbbbb-1111-2222-3333-444444444444";
const use = (id: string, name: string, input: object): string =>
  row({
    type: "assistant",
    timestamp: T,
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
const result = (id: string, content: string, is_error = false): string =>
  row({
    type: "user",
    timestamp: T,
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] },
  });
const head2 = row({ type: "user", timestamp: T, message: { content: "run the tests" } });
const bash = use("t1", "Bash", { command: "uv run pytest" });
const posBash = Buffer.byteLength(head2);
const beforeT3 =
  head2 + bash + result("t1", "1 failed: test_refund_rounding", true) + use("t2", "Read", {});
const posT3 = Buffer.byteLength(beforeT3);
writeFileSync(
  path.join(proj, `${SESSION2}.jsonl`),
  beforeT3 + use("t3", "Bash", { command: "ls" }) + result("t3", "ok"),
);
mkdirSync(path.join(proj, SESSION2, "subagents"), { recursive: true });
const subUse = use("s9", "Grep", { pattern: "uv" });
writeFileSync(
  path.join(proj, SESSION2, "subagents", "agent-hx.jsonl"),
  subUse + result("s9", "3 matches"),
);
/** The JSON body of the first request a fetch stand-in received. */
const sentBody = (spy: ReturnType<typeof stubFetch>): string => {
  const body = spy.mock.calls[0]?.[1]?.body;
  return typeof body === "string" ? body : "";
};
const outcomeAsk = {
  session: SESSION2,
  id: "t1",
  agent: "main",
  pos: posBash,
  intent: "Run the tests",
};
const outcome = async (body: object, headers: Record<string, string> = {}): Promise<unknown> =>
  api["/outcome"](
    new Request("http://x/api/outcome", { method: "POST", headers, body: JSON.stringify(body) }),
  );

const events = async (query: string): Promise<{ r: unknown; body: unknown }> => {
  const r = await api["/events"](new Request(`http://x/api/events?${query}`));
  return { r, body: r instanceof Response && !r.ok ? null : await asJson(r) };
};
const label = async (body: object, headers: Record<string, string> = {}): Promise<unknown> =>
  api["/label"](
    new Request("http://x/api/label", { method: "POST", headers, body: JSON.stringify(body) }),
  );
const ask = { id: "c1", tool: "mcp__x__y", input: '{"q":"AI ZAP"}' };

describe("reading sessions from disk", () => {
  it("should list the session with its project and first prompt", async () => {
    await viz.given("a session on disk with a prompt and a working folder");
    const r = await viz.when("the sessions are listed", async () => api["/sessions"]());
    await viz.then("it appears with the working folder and the prompt as title", async () => {
      const listed = JSON.stringify(await asJson(r));
      expect(listed).toContain(`"id":"${SESSION}"`);
      expect(listed).toContain('"title":"fix it"');
      expect(listed).toContain('"project":"/work/repo"');
    });
  });

  it("should tail the main transcript and every helper, each from its own offset", async () => {
    await viz.given("a main transcript ending mid-line and a helper with its meta file");
    const first = await viz.when("events are asked for from the start", async () =>
      events(`id=${SESSION}&from=0&subs=`),
    );
    await viz.then("the main call and the helper's call arrive, the helper tagged", () => {
      expect(first.body).toMatchObject({
        calls: [
          { id: "toolu_1", agent: "main" },
          { id: "s1", agent: "h1 Clear lint" },
        ],
        agents: [
          { id: "h1", description: "Clear lint", toolUseId: "toolu_1", final: false },
          { id: "h2", description: "helper", toolUseId: "", final: false },
          { id: "h3", description: "helper", toolUseId: "", final: true },
        ],
        more: false,
      });
    });
    const again = await viz.when(
      "events are asked for again with the offsets it handed back",
      async () => {
        const body = z_offsets(first.body);
        return events(
          `id=${SESSION}&from=${body.offset}&subs=${encodeURIComponent(JSON.stringify(body.subs))}`,
        );
      },
    );
    await viz.then("nothing is repeated, and the half-written line waits", () => {
      expect(again.body).toMatchObject({ calls: [], results: [], more: false });
    });
  });

  it("should answer 404 for an unknown or malformed session id", async () => {
    await viz.given("no session with that id on disk");
    const r = await viz.when("an unknown session is asked for", async () =>
      events("id=nope&from=0&subs="),
    );
    await viz.then("it is a 404", () => {
      expect(httpStatus(r.r)).toBe(404);
    });
  });
});

/** Pulls the offsets out of an /events reply without asserting its type. */
function z_offsets(body: unknown): { offset: number; subs: unknown } {
  const o = typeof body === "object" && body !== null ? body : {};
  return {
    offset: "offset" in o && typeof o.offset === "number" ? o.offset : 0,
    subs: "subs" in o ? o.subs : {},
  };
}

describe("labelling calls with the local model", () => {
  it("should refuse for viz verify without calling the model", async () => {
    const fetchSpy = await viz.given("a fetch that must not be called", () =>
      stubFetch(() => Response.json({})),
    );
    const out = await viz.when("verify's browser asks for a label", async () =>
      label(ask, { "user-agent": "Chrome VizAutomation/1" }),
    );
    await viz.then("it gets the stub and Ollama is never called", () => {
      expect(out).toEqual({ label: null });
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  it("should reject a malformed request", async () => {
    await viz.given("a label request missing its tool");
    const out = await viz.when("a label is asked for with no tool", async () => label({ id: "x" }));
    await viz.then("it is a 400", () => {
      expect(httpStatus(out)).toBe(400);
    });
  });

  it("should ask the model once, tidy its answer, and serve repeats from the cache", async () => {
    const fetchSpy = await viz.given("a model that answers with a quoted sentence", () =>
      stubFetch(() => Response.json({ response: '"Searching memory for AI ZAP."' })),
    );
    const first = await viz.when("the same call is labelled twice", async () => [
      await label(ask),
      await label(ask),
    ]);
    await viz.then("both answers are the tidy label and the model ran once", () => {
      expect(first).toEqual([
        { label: "Searching memory for AI ZAP" },
        { label: "Searching memory for AI ZAP" },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });
  });

  it("should return null, and not cache it, when the model is down or answers oddly", async () => {
    const fetchSpy = await viz.given("a model that is down", () =>
      stubFetch(() => {
        throw new Error("connection refused");
      }),
    );
    const down = await viz.when("a new call is labelled", async () => label({ ...ask, id: "c2" }));
    await viz.then("the label is null", () => {
      expect(down).toEqual({ label: null });
      fetchSpy.mockRestore();
    });
    const odd = await viz.given("a model that answers in the wrong shape", () =>
      stubFetch(() => Response.json({ nope: 1 })),
    );
    const out = await viz.when("the same call is tried again", async () =>
      label({ ...ask, id: "c2" }),
    );
    await viz.then("it is asked again and is still null", () => {
      expect(out).toEqual({ label: null });
      expect(odd).toHaveBeenCalledTimes(1);
      odd.mockRestore();
    });
  });
});

describe("saying what a finished call achieved", () => {
  it("should refuse for viz verify and reject a malformed request", async () => {
    const spy = await viz.given("a fetch that must not be called", () =>
      stubFetch(() => Response.json({})),
    );
    const out = await viz.when(
      "verify's browser asks, then a request with no session arrives",
      async () => [
        await outcome(outcomeAsk, { "user-agent": "Chrome VizAutomation/1" }),
        httpStatus(await outcome({ id: "x" })),
      ],
    );
    await viz.then("it gets the stub and a 400, and Ollama was never called", () => {
      expect(out).toEqual([{ outcome: null }, 400]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("should re-read the result from the transcript, lead the prompt with the error, and cache the answer", async () => {
    const spy = await viz.given("a model that answers in a sentence", () =>
      stubFetch(() => Response.json({ response: "1 test failed: test_refund_rounding." })),
    );
    const out = await viz.when("the same call's outcome is asked for twice", async () => [
      await outcome(outcomeAsk),
      await outcome(outcomeAsk),
    ]);
    await viz.then("both answers are the tidy line and the model ran once", () => {
      expect(out).toEqual([
        { outcome: "1 test failed: test_refund_rounding" },
        { outcome: "1 test failed: test_refund_rounding" },
      ]);
      expect(spy).toHaveBeenCalledTimes(1);
    });
    await viz.then(
      "what it was shown was the intent, the call, and the error result from the file",
      () => {
        const sent = sentBody(spy);
        expect(sent).toContain("Intent: Run the tests");
        expect(sent).toContain("uv run pytest");
        expect(sent).toContain("the tool reported an error");
        expect(sent).toContain("1 failed: test_refund_rounding");
        spy.mockRestore();
      },
    );
  });

  it("should read a helper's call from the helper's own transcript", async () => {
    const spy = await viz.given("a model and a call made inside helper hx", () =>
      stubFetch(() => Response.json({ response: "Found 3 matches" })),
    );
    const out = await viz.when("its outcome is asked for with the helper's agent tag", async () =>
      outcome({ session: SESSION2, id: "s9", agent: "hx Search helper", pos: 0, intent: "Search" }),
    );
    await viz.then("the helper's result reached the model", () => {
      expect(out).toEqual({ outcome: "Found 3 matches" });
      expect(sentBody(spy)).toContain("3 matches");
      spy.mockRestore();
    });
  });

  it("should give null, without asking the model, when there is nothing to summarise", async () => {
    const spy = await viz.given("a model that must not be called", () =>
      stubFetch(() => Response.json({})),
    );
    const out = await viz.when(
      "outcomes are asked for a call with no result, an unknown session, helper and bad tag",
      async () => [
        await outcome({ ...outcomeAsk, id: "t2", pos: 0 }),
        await outcome({ ...outcomeAsk, id: "t3", session: "cccccccc-1111-2222-3333-444444444444" }),
        await outcome({ ...outcomeAsk, id: "t4", agent: "nope Missing helper" }),
        await outcome({ ...outcomeAsk, id: "t5", agent: "../x Bad" }),
      ],
    );
    await viz.then("every answer is null and Ollama was not called", () => {
      expect(out).toEqual([
        { outcome: null },
        { outcome: null },
        { outcome: null },
        { outcome: null },
      ]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe("how long the model gets", () => {
  it("should give a label 8 seconds and an outcome 20", async () => {
    const stub = await viz.given("a model that answers and a spy on the timeout", () => ({
      fetchSpy: stubFetch(() => Response.json({ response: "Done" })),
      timeoutSpy: spyOn(AbortSignal, "timeout"),
    }));
    await viz.when("a fresh label and a fresh outcome are asked for", async () => {
      await label({ id: "timeout-label", tool: "mcp__x__y", input: "{}" });
      await outcome({ ...outcomeAsk, id: "t3", pos: posT3 });
    });
    await viz.then("the signals were made for 8000 and 20000 ms", () => {
      expect(stub.timeoutSpy.mock.calls.map((c) => c[0])).toEqual([15_000, 40_000]);
      stub.timeoutSpy.mockRestore();
      stub.fetchSpy.mockRestore();
    });
  });
});

describe("summing up a conversation strip", () => {
  const beatAsk = {
    key: "s1 start 3 1",
    before: "Fix the build",
    steps: ["Read the config", "Run the build (failed)", "Claude said: checking the pin"],
    after: "Done, token=supersecretvalue123",
  };
  const beat = async (body: object, headers: Record<string, string> = {}): Promise<unknown> =>
    api["/beat"](
      new Request("http://x/api/beat", { method: "POST", headers, body: JSON.stringify(body) }),
    );

  it("should refuse for viz verify and reject a strip with no steps", async () => {
    const spy = await viz.given("a fetch that must not be called", () =>
      stubFetch(() => Response.json({})),
    );
    const out = await viz.when("verify asks, then a request with no steps arrives", async () => [
      await beat(beatAsk, { "user-agent": "Chrome VizAutomation/1" }),
      httpStatus(await beat({ ...beatAsk, steps: [] })),
    ]);
    await viz.then("it gets the stub and a 400, and Ollama was never called", () => {
      expect(out).toEqual([{ beat: null }, 400]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("should send the steps in order with what came before and after, and cache the line", async () => {
    const spy = await viz.given("a model that answers in a sentence", () =>
      stubFetch(() =>
        Response.json({
          response: "**Fix the build** → fixed\n\n* The pin was wrong.\n- Build passes.",
        }),
      ),
    );
    const out = await viz.when("the same strip is asked for twice", async () => [
      await beat(beatAsk),
      await beat(beatAsk),
    ]);
    await viz.then("both answers are the tidy line and the model ran once", () => {
      const line = "Fix the build → fixed\n- The pin was wrong.\n- Build passes.";
      expect(out).toEqual([{ beat: line }, { beat: line }]);
      expect(spy).toHaveBeenCalledTimes(1);
    });
    await viz.then("the prompt carries every step, and no secret", () => {
      const sent = sentBody(spy);
      expect(sent).toContain("Before this: Fix the build");
      expect(sent).toContain("- Run the build (failed)");
      expect(sent).toContain("Claude's next message: Done");
      expect(sent).not.toContain("supersecretvalue123");
      spy.mockRestore();
    });
  });
});

describe("placing a script in a lane", () => {
  const lane = async (body: object, headers: Record<string, string> = {}): Promise<unknown> =>
    api["/lane"](
      new Request("http://x/api/lane", { method: "POST", headers, body: JSON.stringify(body) }),
    );
  const script = { id: "s1", input: '{"command":"python3 - <<EOF\\nos.remove(1)\\nEOF"}' };

  it("should refuse for viz verify and reject a request with no id", async () => {
    const spy = await viz.given("a fetch that must not be called", () =>
      stubFetch(() => Response.json({})),
    );
    const out = await viz.when("verify asks, then a request with no id arrives", async () => [
      await lane(script, { "user-agent": "Chrome VizAutomation/1" }),
      httpStatus(await lane({ input: "x" })),
    ]);
    await viz.then("it gets the stub and a 400, and Ollama was never called", () => {
      expect(out).toEqual([{ lane: null }, 400]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("should take the model's word when it names a lane, cache it, and refuse anything else", async () => {
    const replies = ["Change.", "banana bread"];
    const spy = await viz.given(
      "a model that says Change for one script and rambles for another",
      () => stubFetch(() => Response.json({ response: replies.shift() })),
    );
    const out = await viz.when("one script is asked twice and another once", async () => [
      await lane(script),
      await lane(script),
      await lane({ ...script, id: "s2" }),
    ]);
    await viz.then("the lane comes back, from one model call, and the ramble is no lane", () => {
      expect(out).toEqual([{ lane: "change" }, { lane: "change" }, { lane: null }]);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(sentBody(spy)).toContain("os.remove");
      spy.mockRestore();
    });
  });
});

describe("telling the whole story", () => {
  const tell = async (body: object, headers: Record<string, string> = {}): Promise<unknown> =>
    api["/story"](
      new Request("http://x/api/story", { method: "POST", headers, body: JSON.stringify(body) }),
    );
  const session = {
    key: "s1 2 2",
    lines: ["P1: fix the build", "What the agent did:\nFixed it → done"],
  };

  it("should refuse for viz verify and reject a session with nothing in it", async () => {
    const spy = await viz.given("a fetch that must not be called", () =>
      stubFetch(() => Response.json({})),
    );
    const out = await viz.when("verify asks, then an empty session arrives", async () => [
      await tell(session, { "user-agent": "Chrome VizAutomation/1" }),
      httpStatus(await tell({ key: "k", lines: [] })),
    ]);
    await viz.then("it gets the stub and a 400, and Ollama was never called", () => {
      expect(out).toEqual([{ story: null }, 400]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("should tell it from the lines in order, with room for a long session, and cache it", async () => {
    const spy = await viz.given("a model that answers in chapters", () =>
      stubFetch(() =>
        Response.json({ response: "Fixed a build.\n\n### **Fixing** (P1-P1)\n* The pin was off." }),
      ),
    );
    const out = await viz.when("the same session is told twice", async () => [
      await tell(session),
      await tell(session),
    ]);
    await viz.then("the chapters come back tidy, from one model call with a large context", () => {
      const told = "Fixed a build.\n### Fixing (P1-P1)\n- The pin was off.";
      expect(out).toEqual([{ story: told }, { story: told }]);
      expect(spy).toHaveBeenCalledTimes(1);
      const sent = sentBody(spy);
      expect(sent).toContain("P1: fix the build");
      expect(sent).toContain('"num_ctx":32768');
      spy.mockRestore();
    });
  });
});
