// auto-handoff's Extracted state: extract.py reads a session transcript (JSONL) and lists exact details, capped.
import { afterAll, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EXTRACT = path.join(import.meta.dirname, "..", "skills/r2-handoff/scripts/extract.py");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ah-extract-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sh = (args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}) => {
  const p = spawnSync(args[0], args.slice(1), { ...opts, encoding: "utf8" });
  return { code: p.status, out: p.stdout, err: p.stderr };
};

let n = 0;
const use = (name: string, input: object, id = `t${++n}`) =>
  ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: string, is_error = false) =>
  ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
const say = (role: "user" | "assistant", text: string) =>
  ({ type: role, message: { content: role === "user" ? text : [{ type: "text", text }] } });

function run(events: object[], ...args: string[]) {
  const file = path.join(tmp, `t${++n}.jsonl`);
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n{half a line");
  const p = sh(["python3", EXTRACT, file, ...args]);
  expect(p.err).toBe("");
  return p.out;
}
const list = (out: string, title: string) => {
  const block = out.split(`**${title}`)[1] ?? "";
  return block.split("\n\n")[0].split("\n").slice(1);
};

const session = [
  say("user", "fix the parser, see https://github.com/acme/app/issues/42"),
  use("Read", { file_path: "/repo/src/a.ts" }, "r1"), result("r1", "code"),
  use("Read", { file_path: "/repo/src/b.ts" }, "r2"), result("r2", "code"),
  use("Edit", { file_path: "/repo/src/a.ts", old_string: "x", new_string: "y" }, "e1"), result("e1", "ok"),
  use("Bash", { command: "npm test" }, "b1"), result("b1", "Exit code 1\n\nerror: expected 2, got 3\nmore", true),
  use("TodoWrite", { todos: [{ content: "write parser", status: "completed" }, { content: "add tests", status: "pending" }] }, "w1"),
  use("TodoWrite", { todos: [{ content: "add tests", status: "in_progress" }, { content: "update README", status: "pending" }, { content: "old", status: "completed" }] }, "w2"),
  use("Bash", { command: "git commit -m fix" }, "g1"), result("g1", "[main 3f9c2ab1] fix"),
  { ...use("Edit", { file_path: "/subagent/only.ts" }, "s1"), isSidechain: true },
  { ...say("user", "Stop hook feedback:\nAUTO HANDOFF (context at 251k). Do not start new work. Read SKILL.md and follow its 'Auto' section: write the handoff to /h/handoff-auto-1.md, then end your turn."), isMeta: true },
  use("Write", { file_path: "/h/handoff-auto-1.md", content: "..." }, "h1"),
  use("Read", { file_path: "/skills/r2-handoff/SKILL.md" }, "h2"),
];

test("each list holds what the session did before the handoff request", () => {
  const out = run(session, "--until", "/h/handoff-auto-1.md");
  expect(out.startsWith("## Extracted state (mechanical, from the transcript)")).toBe(true);
  expect(list(out, "Files edited")).toEqual(["- `/repo/src/a.ts`"]);
  expect(list(out, "Files read")).toEqual(["- `/repo/src/b.ts`"]);
  expect(list(out, "Failed tool calls")).toEqual(["- Bash: npm test → Exit code 1: error: expected 2, got 3"]);
  expect(list(out, "Todos still open")).toEqual(["- [in_progress] add tests", "- [pending] update README"]);
  expect(list(out, "Identifiers")).toEqual(["- 3f9c2ab1", "- https://github.com/acme/app/issues/42"]);
  expect(list(out, "Last tool calls")).toEqual(["- Read: /repo/src/a.ts", "- Read: /repo/src/b.ts", "- Edit: /repo/src/a.ts",
    "- Bash: npm test", expect.stringMatching(/^- TodoWrite: /), expect.stringMatching(/^- TodoWrite: /), "- Bash: git commit -m fix"]);
  expect(out).not.toContain("handoff-auto-1.md"); // the handoff-writing steps are cut off
  expect(out).not.toContain("/subagent/only.ts");
});

test("open todos come from TaskCreate/TaskUpdate when the session used those", () => {
  const out = run([
    use("TaskCreate", { subject: "ship it", description: "d" }, "c1"), result("c1", "Task #1 created successfully: ship it"),
    use("TaskCreate", { subject: "tidy", description: "d" }, "c2"), result("c2", "Task #2 created successfully: tidy"),
    use("TaskUpdate", { taskId: "2", status: "completed" }),
    use("TaskUpdate", { taskId: "1", status: "in_progress" }),
  ]);
  expect(list(out, "Todos still open")).toEqual(["- [in_progress] #1 ship it"]);
});

test("a huge session stays under 3,000 tokens, newest kept, with a count of what was dropped", () => {
  const big = Array.from({ length: 600 }, (_, i) => use("Edit", { file_path: `/repo/very/long/path/to/some/module/file-${i}.ts` }));
  const out = run(big);
  expect(out.length / 4).toBeLessThanOrEqual(3000);
  const edited = list(out, "Files edited");
  expect(edited[0]).toBe("- `/repo/very/long/path/to/some/module/file-599.ts`");
  expect(edited.at(-1)).toMatch(/^- …and \d+ older$/);
  expect(Number(edited.at(-1)!.match(/\d+/)![0]) + edited.length - 1).toBe(600);
  const tight = run(big, "--cap", "300");
  expect(tight.length / 4).toBeLessThanOrEqual(300);
  expect(tight).toContain("older");
});

// The hook: on the stop that finds the handoff written, append the section, then launch the injector.
const HOOK = path.join(import.meta.dirname, "..", "tools/auto-handoff/auto-handoff");
function stopHook(handoff: string, transcript: string) {
  const state = path.join(tmp, `state${++n}`), herdr = path.join(tmp, "herdr");
  writeFileSync(herdr, "#!/bin/sh\necho '❯'\n", { mode: 0o755 }); // an idle pane with an empty prompt box
  mkdirSync(state, { recursive: true });
  writeFileSync(path.join(state, "t_1.json"), JSON.stringify({ phase: "writing", path: handoff, t: 0, enter: true }));
  const p = sh([HOOK, "stop"], {
    input: JSON.stringify({ transcript_path: transcript, background_tasks: [] }),
    env: { ...process.env, HERDR_PANE_ID: "t:1", HERDR_BIN_PATH: herdr, AUTO_HANDOFF_STATE: state, AUTO_HANDOFF: "1" },
  });
  expect(p.code).toBe(0);
  const log = readFileSync(path.join(state, "log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const phase = JSON.parse(readFileSync(path.join(state, "t_1.json"), "utf8")).phase;
  return { log, phase };
}

test("the hook appends the section to the written handoff once, then hands off", () => {
  const transcript = path.join(tmp, "hook.jsonl"), handoff = path.join(tmp, "handoff-auto-1.md");
  writeFileSync(transcript, session.map((e) => JSON.stringify(e)).join("\n").replaceAll("/h/handoff-auto-1.md", handoff));
  writeFileSync(handoff, "# Handoff\n\nprose\n");
  const { log, phase } = stopHook(handoff, transcript);
  const doc = readFileSync(handoff, "utf8");
  expect(doc).toMatch(/^# Handoff\n\nprose\n\n\n## Extracted state \(mechanical, from the transcript\)\n/);
  expect(doc).toContain("- `/repo/src/a.ts`");
  expect(phase).toBe("injecting");
  expect(log.at(-1).extracted_tokens).toBeGreaterThan(0);
  stopHook(handoff, transcript); // a second stop doesn't append it again
  expect(readFileSync(handoff, "utf8").split("## Extracted state").length).toBe(2);
});

test("a failed extraction is logged and the handoff goes ahead without the section", () => {
  const transcript = path.join(tmp, "hook2.jsonl"), handoff = path.join(tmp, "handoff-auto-2.md");
  writeFileSync(transcript, JSON.stringify(say("user", "hi")) + "\n");
  writeFileSync(handoff, "# Handoff\n", { mode: 0o444 }); // can't be appended to
  const { log, phase } = stopHook(handoff, transcript);
  expect(readFileSync(handoff, "utf8")).toBe("# Handoff\n");
  expect(log.at(-1).extract_error).toContain("Permission");
  expect(phase).toBe("injecting");
});
