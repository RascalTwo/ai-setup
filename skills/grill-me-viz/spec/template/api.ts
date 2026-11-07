// Sign-off: the page's one action. Inside a Kelpie run it runs Kelpie's `signoff` for the task (it
// quotes `words` onto the task and sets Refined); outside one it only saves the signed spec. Refuses
// unless every judgment is ✓, so the gate is enforced here as well as on the page.
import type { Handlers } from "@viz/kit/api.js";
import { relay } from "@viz/kit/server/kelpie-relay.ts";
import { feedbackText, foldFeedback, type Entry } from "@viz/kit/feedback-text.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SpecSchema } from "./spec.schema.ts";
import type { Routes } from "./contract.ts";

const KELPIE =
  process.env["KELPIE_CLI"] ??
  path.join(process.env["HOME"] ?? "", ".agents/ai-setup/tools/kelpie/kelpie.ts");
const KELPIE_RUNS = path.join(process.env["HOME"] ?? "", ".agents/state/kelpie/runs") + path.sep;
// A spec made outside a Kelpie run has no task for Kelpie to update; its agent watches feedback.jsonl.
const inKelpie = (folder: string | undefined): folder is string =>
  !!folder && path.resolve(folder).startsWith(KELPIE_RUNS);
// What the user said or typed on the page, by card, in `viz feedback`'s words: the agent gets it in
// the message itself, so a comment can't be lost to an agent that never opens the log.
const log = (): Entry[] => {
  const file = path.join(import.meta.dir, ".viz-data", "feedback.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l): Entry[] => {
      try {
        // oxlint-disable-next-line typescript/no-unsafe-return -- the page writes these lines itself
        return l ? [JSON.parse(l)] : [];
      } catch {
        return []; // a torn line shouldn't hide the rest
      }
    });
};
// Lines written since the last send: no agent has read them, so signing off now would bury them.
const unseen = (entries: Entry[]): boolean => {
  const last = entries.findLast((e) => e.type === "send")?.at ?? "";
  return entries.some(
    (e) => ["speech", "comment", "edit"].includes(e.type ?? "") && (e.at ?? "") > last,
  );
};
const said = (entries = log()): string => {
  if (entries.length === 0) return "";
  const { lines } = foldFeedback(entries);
  if (lines.length === 0) return "\n\nNo comments on the page.";
  return `\n\nWhat they said, by card:\n${feedbackText(lines, {}, false, (f) => f).join("\n")}`;
};
const refuse = (message: string, status = 409) => Response.json({ ok: false, message }, { status });

export default {
  // Send corrections: put the human's word in front of the agent waiting on this page right now,
  // instead of leaving it to watch a log. Kelpie finds the agent from the task folder.
  "/sent": async (req) => {
    if (req.method !== "POST") return refuse("not available");
    const words = `${(await req.json()).words}${said()}`;
    const spec = SpecSchema.parse(
      JSON.parse(readFileSync(path.join(import.meta.dir, "spec.json"), "utf8")),
    );
    const r = relay(req, words, spec.task.folder);
    if (r.outcome === "refused") return refuse("not available");
    if (r.outcome === "no-run")
      return { ok: true, message: "Sent. No Kelpie run: the agent reads it from the page's log." };
    if (r.outcome === "failed") return refuse(r.message, 502);
    return { ok: true, message: r.message };
  },
  "/signoff": async (req) => {
    // Routes are method-agnostic and `viz verify` loads the page like a reader: only a real POST acts.
    if (req.method !== "POST" || req.headers.get("user-agent")?.includes("VizAutomation"))
      return refuse("not available");
    const { words: picked, verdicts } = await req.json();
    const entries = log();
    // 428: the page sends them as corrections instead, and the agent folds them in before sign-off.
    if (unseen(entries))
      return refuse(
        "you left comments the agent hasn't seen: they go to it as corrections first",
        428,
      );
    const words = `${picked}${said(entries)}`;
    const file = path.join(import.meta.dir, "spec.json");
    const spec = SpecSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    if (spec.signedOffAt) return refuse("already signed off");
    const items = [...spec.examples, ...spec.assumptions];
    if (items.some((i) => verdicts[i.id] !== "ok"))
      return refuse("not every example and assumption is agreed", 400);
    if (spec.questions.some((q) => !q.options.some((o) => o.id === verdicts[q.id])))
      return refuse("not every question is answered", 400);
    let message = "Signed off.";
    if (inKelpie(spec.task.folder)) {
      const run = Bun.spawnSync(["bun", KELPIE, "signoff", words], {
        cwd: spec.task.folder,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (run.exitCode !== 0)
        return refuse(
          `kelpie signoff failed: ${run.stderr.toString().trim() || run.stdout.toString().trim()}`,
          502,
        );
      message = run.stdout.toString().trim();
    }
    const signed = {
      ...spec,
      examples: spec.examples.map((e) => ({ ...e, verdict: "ok" as const })),
      assumptions: spec.assumptions.map((a) => ({ ...a, verdict: "ok" as const })),
      questions: spec.questions.map((q) => ({ ...q, answer: verdicts[q.id] })),
      signedOffAt: new Date().toISOString(),
    };
    const json = `${JSON.stringify(signed, null, 2)}\n`;
    writeFileSync(file, json);
    // where pr-viz looks (pr-viz/reference/spec.md)
    if (spec.task.folder) writeFileSync(path.join(spec.task.folder, "spec.json"), json);
    return { ok: true, message };
  },
} satisfies Handlers<Routes>;
