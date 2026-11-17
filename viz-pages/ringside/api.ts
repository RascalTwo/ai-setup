// api.ts — reads Claude Code transcripts (and their subagents) from ~/.claude/projects. It never
// writes to them. What it writes is the local model's caches under ~/.agents/state/ringside/, and
// what it calls is the local Ollama, which every model route refuses for `viz verify`
// (VizAutomation), so loading the page there is harmless.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Handlers } from "@viz/kit/api.js";
import { z } from "@viz/kit/zod.js";
import type { AgentInfo, Routes, SessionInfo } from "./contract.ts";
import {
  callExcerpt,
  cleanLabel,
  cleanLines,
  clip,
  completeLines,
  endsFinal,
  parseLines,
  redact,
} from "./model.ts";

const ROOT = process.env["CLAUDE_PROJECTS_DIR"] ?? path.join(homedir(), ".claude", "projects");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_CHUNK = 4 * 1024 * 1024;

async function findSession(id: string): Promise<string | null> {
  if (!ID.test(id)) return null;
  const dirs = await readdir(ROOT);
  const paths = dirs.map((dir) => path.join(ROOT, dir, `${id}.jsonl`));
  const hits = await Promise.all(paths.map(async (p) => ((await Bun.file(p).exists()) ? p : null)));
  return hits.find((p) => p !== null) ?? null;
}

const Offsets = z.record(z.string(), z.number());
const Meta = z.object({
  description: z.string().optional(),
  agentType: z.string().optional(),
  toolUseId: z.string().optional(),
});
const LabelBody = z.object({ id: z.string(), tool: z.string(), input: z.string() });
const OutcomeBody = z.object({
  session: z.string(),
  id: z.string(),
  agent: z.string(),
  pos: z.number(),
  intent: z.string(),
});
const BeatBody = z.object({
  key: z.string().min(1),
  before: z.string(),
  steps: z.array(z.string()).min(1),
  after: z.string(),
});
const StoryBody = z.object({ key: z.string().min(1), lines: z.array(z.string()).min(1) });
const LaneBody = z.object({ id: z.string().min(1), input: z.string() });
/** The lanes the model may pick for a script; Plan, Delegate and Outside are never shell commands. */
const SCRIPT_LANES = ["look", "change", "run", "verify"] as const;
const OllamaReply = z.object({ response: z.string() });
const LabelCache = z.record(z.string(), z.string());

// A label is a short prompt; an outcome reads a result excerpt and was measured at 4-7s.
const LABEL_TIMEOUT_MS = 15_000;
const OUTCOME_TIMEOUT_MS = 40_000;
// A beat reads up to 60 steps; a real 8-step strip answered in 1.3-2s warm.
const BEAT_TIMEOUT_MS = 60_000;
const BEAT_STEPS = 60;
// The story reads the whole session's summaries; measured on the canary session before setting.
const STORY_TIMEOUT_MS = 180_000;
/** Context and reply room, in tokens. Ollama's own default context is far smaller than the model's 131k. */
const SMALL = { ctx: 8192, predict: 400 };
const STORY_SIZE = { ctx: 32_768, predict: 1500 };
const OLLAMA = "http://127.0.0.1:11434/api/generate";
// gemma4:e4b answered in 0.5-0.7s warm (6.6s cold) with clean 4-5 word labels; gemma4:12b and
// qwen2.5-coder:7b were slower or chattier on the same three real calls.
const MODEL = "gemma4:e4b";
// Accuracy over brevity, by the user's call (2026-10-12): no word limits, and nothing is cut.
const ACCURATE =
  "Accuracy and completeness come first: say everything the reader needs to know what really " +
  "happened. Brevity is a distant second, but it must be easy to read: short sentences, one fact " +
  "each. No preamble, no options, no headings, no bold. Use only facts from the input; the " +
  "examples show the shape and their facts are never to be copied. ";
const SYSTEM =
  "You label one AI tool call for a live audience. Reply with one plain-English present-tense " +
  "line saying what the call does, naming its target precisely. Reply with that line only. " +
  ACCURATE +
  "No quotes, no trailing period. Examples: Looking up Jira issue HYD-42; Listing the 20 newest " +
  "Gmail threads labelled billing.";
/** Ringside's state: the local model's labels, outcomes, lanes, beats and stories. */
const STATE = path.join(homedir(), ".agents", "state", "ringside");
const LABELS = process.env["RINGSIDE_LABEL_CACHE"] ?? path.join(STATE, "labels.json");
const OUTCOMES = process.env["RINGSIDE_OUTCOME_CACHE"] ?? path.join(STATE, "outcomes.json");
const LANE_CACHE = process.env["RINGSIDE_LANE_CACHE"] ?? path.join(STATE, "lanes.json");
const LANE_SYSTEM =
  "You sort one shell command an AI coding agent ran into exactly one category, by what it really " +
  "does, reading any script or heredoc inside it. Categories: look = only reads or searches, " +
  "changes nothing; change = creates, edits, moves or deletes files, or commits; verify = runs " +
  "tests, lint, type checks, builds or other checks; run = anything else (installs, servers, " +
  "network calls, starting or stopping things). If it does several, pick the most consequential: " +
  "change, then verify, then run, then look. Reply with the one category word only.";
const STORIES = process.env["RINGSIDE_STORY_CACHE"] ?? path.join(STATE, "stories.json");
const STORY_SYSTEM =
  "You tell the whole story of one working session between a person and an AI coding agent, for " +
  "someone who missed it. The input is the session in order: the person's prompts (P1, P2, ...), " +
  "summaries of what the agent did between messages, and the agent's replies. Reply in exactly " +
  "this shape and nothing else. First line: one sentence saying what the session was about and " +
  "where it ended up. Then 2 to 8 chapters in order, never more than 8, each a line '### <what " +
  "came of it> (P<first>-P<last>)' followed by 1 to 4 lines starting with '- ', each one short " +
  "sentence with one fact. Results come first: lead each chapter with what was built, fixed, " +
  "found or decided, then the turning points that got there: what the person asked for or " +
  "changed, what failed and how it was fixed, what was tried and dropped. Skip routine mechanics " +
  "(finding files, re-running tests, fixing lint, committing) unless they changed the outcome. " +
  "Group related prompts into one chapter rather than one chapter per prompt. Last, a " +
  "line '### Where it stands' followed by 1 to 3 '- ' lines saying what is done and what is still " +
  "open. Accuracy and completeness come first, brevity second, readability always: short " +
  "sentences, one fact each, no bold, no preamble. Use only facts from the input; never guess at " +
  "motives and never add events.";
const BEATS = process.env["RINGSIDE_BEAT_CACHE"] ?? path.join(STATE, "beats.json");
const BEAT_SYSTEM =
  "You sum up one stretch of an AI coding agent's work for a live audience. " +
  ACCURATE +
  "Reply in exactly this shape: a first line saying what it set out to do, then ' → ', then what " +
  "came of it in a few words; then 1 to 6 lines starting with '- ', each one short sentence with " +
  "one fact. Name files, counts, versions, test or build results from the steps. If something " +
  "failed and stayed failed, say so; if it failed and was then fixed, say that too. Example:\n" +
  "Find why the login test flakes → found and fixed\n" +
  "- The flake came from a temp dir shared by every test in conftest.py.\n" +
  "- Each test now gets its own temp dir.\n" +
  "- 3 runs in a row passed.";
const OUTCOME_SYSTEM =
  "You say, for a live audience, what an AI tool call achieved, in one to three short plain " +
  "sentences. " +
  ACCURATE +
  "Be specific: name counts, files, tests or numbers that appear in the output. If the output shows " +
  "a failure, start with what failed. Never start with 'The tool' or 'Successfully'. Examples: " +
  "2 of 40 tests failed. Both, test_refund_rounding and test_refund_currency, round cents wrongly. | " +
  "Read 85 lines of billing.py: the refund calculation and its helpers. | " +
  "Exit 1: docs/runbook.md does not exist.";

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Reads from a byte offset to the last complete line, at most MAX_CHUNK bytes. */
async function readFrom(
  file: string,
  from: number,
): Promise<{ done: string; start: number; offset: number; capped: boolean }> {
  const f = Bun.file(file);
  const start = Math.max(0, Math.min(from, f.size));
  const buf = await f.slice(start, Math.min(f.size, start + MAX_CHUNK)).text();
  const { done } = completeLines(buf);
  return {
    done,
    start,
    offset: start + Buffer.byteLength(done),
    capped: start + MAX_CHUNK < f.size,
  };
}

/** The subagent transcripts of a session, each with the details from its `.meta.json`. */
async function subagents(sessionFile: string): Promise<{ file: string; info: AgentInfo }[]> {
  const dir = path.join(sessionFile.replace(/\.jsonl$/u, ""), "subagents");
  const names = await readdir(dir).catch((): string[] => []);
  const files = names.toSorted().flatMap((n) => {
    const id = /^agent-(.+)\.jsonl$/u.exec(n)?.[1];
    return id ? [{ id, file: path.join(dir, n) }] : [];
  });
  return Promise.all(
    files.map(async ({ id, file }) => {
      const meta = Meta.safeParse(
        await Bun.file(file.replace(/\.jsonl$/u, ".meta.json"))
          .json()
          .catch((): unknown => null),
      );
      const m = meta.success ? meta.data : {};
      const f = Bun.file(file);
      const final = endsFinal(await f.slice(Math.max(0, f.size - 65_536), f.size).text());
      return {
        file,
        info: {
          id,
          description: m.description ?? m.agentType ?? "helper",
          toolUseId: m.toolUseId ?? "",
          final,
        },
      };
    }),
  );
}

/** Asks the local model, or returns null on any failure (the page keeps what it has). */
async function askOllama(
  system: string,
  prompt: string,
  timeoutMs: number,
  tidy: (raw: string) => string | null = cleanLabel,
  size = SMALL,
): Promise<string | null> {
  try {
    const res = await fetch(OLLAMA, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: MODEL,
        system,
        prompt,
        stream: false,
        think: false,
        // A guard against a runaway reply, not a length target.
        options: { num_ctx: size.ctx, num_predict: size.predict, temperature: 0 },
      }),
    });
    const parsed = OllamaReply.safeParse(await res.json());
    return parsed.success ? tidy(parsed.data.response) : null;
  } catch {
    return null;
  }
}

// ponytail: one JSON file per kind, read-modify-write; two answers finishing together can drop one
// entry (it is just asked again next load). Upgrade to a jsonl append if that ever shows up.
async function cached(
  file: string,
  id: string,
  make: () => Promise<string | null>,
): Promise<string | null> {
  const cache = LabelCache.safeParse(
    await Bun.file(file)
      .json()
      .catch(() => ({})),
  );
  const known = cache.success ? cache.data : {};
  const hit = known[id];
  if (hit) return hit;
  const made = await make();
  if (made) await Bun.write(file, JSON.stringify({ ...known, [id]: made }));
  return made;
}

async function labelFor(b: { id: string; tool: string; input: string }): Promise<string | null> {
  const label = await cached(LABELS, b.id, async () => {
    const made = await askOllama(
      SYSTEM,
      `Tool: ${b.tool}\nInput: ${redact(clip(b.input, 1500))}`,
      LABEL_TIMEOUT_MS,
    );
    return made;
  });
  return label;
}

/** The transcript file a call lives in: the main session's, or one of its helpers'. */
async function transcriptOf(session: string, agent: string): Promise<string | null> {
  const main = await findSession(session);
  if (!main || agent === "main") return main;
  const id = agent.split(" ", 1).join("");
  if (!/^[\w-]+$/u.test(id)) return null;
  const file = path.join(main.replace(/\.jsonl$/u, ""), "subagents", `agent-${id}.jsonl`);
  return (await Bun.file(file).exists()) ? file : null;
}

/** What a finished call achieved: its result is re-read from the transcript, then summarised. */
async function outcomeFor(b: z.infer<typeof OutcomeBody>): Promise<string | null> {
  const outcome = await cached(OUTCOMES, b.id, async () => {
    const file = await transcriptOf(b.session, b.agent);
    if (!file) return null;
    const text = await Bun.file(file)
      .slice(Math.max(0, b.pos), Math.max(0, b.pos) + MAX_CHUNK)
      .text();
    const call = callExcerpt(completeLines(text).done, b.id);
    if (!call?.result) return null;
    const kind = call.error ? "Result (the tool reported an error)" : "Result";
    return askOllama(
      OUTCOME_SYSTEM,
      `Intent: ${redact(clip(b.intent, 200))}\nTool: ${call.tool}\nInput: ${call.input}\n${kind}:\n${call.result}`,
      OUTCOME_TIMEOUT_MS,
    );
  });
  return outcome;
}

/** The lane for a call that runs a script, read from its input; null when the model says nothing usable. */
async function laneFor(b: z.infer<typeof LaneBody>): Promise<(typeof SCRIPT_LANES)[number] | null> {
  const said = await cached(LANE_CACHE, b.id, async () => {
    const made = await askOllama(LANE_SYSTEM, redact(clip(b.input, 4000)), LABEL_TIMEOUT_MS);
    return made;
  });
  const word = said?.toLowerCase().match(/[a-z]+/u)?.[0];
  return SCRIPT_LANES.find((l) => l === word) ?? null;
}

/** The whole session retold in chapters, from its prompts, strip summaries and replies. */
async function storyFor(b: z.infer<typeof StoryBody>): Promise<string | null> {
  const told = await cached(STORIES, b.key, async () => {
    const made = await askOllama(
      STORY_SYSTEM,
      redact(b.lines.join("\n\n")),
      STORY_TIMEOUT_MS,
      cleanLines,
      STORY_SIZE,
    );
    return made;
  });
  return told;
}

/** One line for a conversation strip: what Claude set out to do between two messages, and what came of it. */
async function beatFor(b: z.infer<typeof BeatBody>): Promise<string | null> {
  const steps = b.steps.slice(0, BEAT_STEPS).map((s) => `- ${clip(s, 300)}`);
  const prompt = redact(
    `Before this: ${clip(b.before, 400)}\nSteps, oldest first:\n${steps.join("\n")}\n` +
      `Claude's next message: ${clip(b.after, 400) || "(none yet)"}`,
  );
  const beat = await cached(BEATS, b.key, async () => {
    const made = await askOllama(BEAT_SYSTEM, prompt, BEAT_TIMEOUT_MS, cleanLines);
    return made;
  });
  return beat;
}

async function describeSession(f: {
  path: string;
  id: string;
  mtime: number;
  size: number;
}): Promise<SessionInfo> {
  const { path: file, id, mtime, size } = f;
  const head = await Bun.file(file)
    .slice(0, 256 * 1024)
    .text();
  const cwd = /"cwd":"([^"]+)"/u.exec(head)?.[1] ?? "";
  const first = parseLines(completeLines(head).done).prompts[0]?.text ?? "(no prompt yet)";
  return { id, project: cwd.replace(homedir(), "~"), mtime, size, title: clip(first, 120) };
}

export default {
  "/sessions": async () => {
    const dirs = await readdir(ROOT);
    const perDir = await Promise.all(
      dirs.map(async (dir) => {
        const names = await readdir(path.join(ROOT, dir)).catch((): string[] => []);
        const jsonl = names.filter(
          (n) => n.endsWith(".jsonl") && ID.test(n.replace(/\.jsonl$/u, "")),
        );
        return Promise.all(
          jsonl.map(async (n) => {
            const file = path.join(ROOT, dir, n);
            const s = await stat(file);
            return { path: file, id: n.replace(/\.jsonl$/u, ""), mtime: s.mtimeMs, size: s.size };
          }),
        );
      }),
    );
    const found = perDir.flat().toSorted((a, b) => b.mtime - a.mtime);
    const sessions = await Promise.all(found.slice(0, 15).map(describeSession));
    return { sessions };
  },

  "/events": async (req) => {
    const q = new URL(req.url).searchParams;
    const file = await findSession(q.get("id") ?? "");
    if (!file) return new Response("no such session", { status: 404 });
    const offsets = Offsets.safeParse(parseJson(q.get("subs") ?? ""));
    const main = await readFrom(file, Number(q.get("from") ?? 0) || 0);
    const helpers = await subagents(file);
    const reads = await Promise.all(
      helpers.map(async (h) => ({
        h,
        r: await readFrom(h.file, (offsets.success ? offsets.data[h.info.id] : 0) ?? 0),
      })),
    );
    const parts = [
      parseLines(main.done, undefined, main.start),
      ...reads.map(({ h, r }) => parseLines(r.done, `${h.info.id} ${h.info.description}`, r.start)),
    ];
    return {
      calls: parts.flatMap((p) => p.calls),
      results: parts.flatMap((p) => p.results),
      prompts: parts.flatMap((p) => p.prompts),
      says: parts.flatMap((p) => p.says),
      offset: main.offset,
      subs: Object.fromEntries(reads.map(({ h, r }) => [h.info.id, r.offset])),
      agents: helpers.map((h) => h.info),
      more: main.capped || reads.some(({ r }) => r.capped),
    };
  },

  "/label": async (req) => {
    if (req.headers.get("user-agent")?.includes("VizAutomation")) return { label: null };
    const body = LabelBody.safeParse(await req.json());
    if (!body.success) return new Response("bad label request", { status: 400 });
    return { label: await labelFor(body.data) };
  },

  "/beat": async (req) => {
    if (req.headers.get("user-agent")?.includes("VizAutomation")) return { beat: null };
    const body = BeatBody.safeParse(await req.json());
    if (!body.success) return new Response("bad beat request", { status: 400 });
    return { beat: await beatFor(body.data) };
  },

  "/story": async (req) => {
    if (req.headers.get("user-agent")?.includes("VizAutomation")) return { story: null };
    const body = StoryBody.safeParse(await req.json());
    if (!body.success) return new Response("bad story request", { status: 400 });
    return { story: await storyFor(body.data) };
  },

  "/lane": async (req) => {
    if (req.headers.get("user-agent")?.includes("VizAutomation")) return { lane: null };
    const body = LaneBody.safeParse(await req.json());
    if (!body.success) return new Response("bad lane request", { status: 400 });
    return { lane: await laneFor(body.data) };
  },

  "/outcome": async (req) => {
    if (req.headers.get("user-agent")?.includes("VizAutomation")) return { outcome: null };
    const body = OutcomeBody.safeParse(await req.json());
    if (!body.success) return new Response("bad outcome request", { status: 400 });
    return { outcome: await outcomeFor(body.data) };
  },
} satisfies Handlers<Routes>;
