// Sign-off: the page's one action. Inside a Kelpie run it runs Kelpie's `signoff` for the task (it
// quotes `words` onto the task and sets Refined); outside one it only saves the signed spec. Refuses
// unless every judgment is ✓, so the gate is enforced here as well as on the page.
import type { Handlers } from "@viz/kit/api.js";
import { readFileSync, writeFileSync } from "node:fs";
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
const refuse = (message: string, status = 409) => Response.json({ ok: false, message }, { status });

export default {
  // Send corrections: put the human's word in front of the agent waiting on this page right now,
  // instead of leaving it to watch a log. Kelpie finds the agent from the task folder.
  "/sent": async (req) => {
    if (req.method !== "POST" || req.headers.get("user-agent")?.includes("VizAutomation"))
      return refuse("not available");
    const { words } = await req.json();
    const spec = SpecSchema.parse(
      JSON.parse(readFileSync(path.join(import.meta.dir, "spec.json"), "utf8")),
    );
    if (!inKelpie(spec.task.folder))
      return { ok: true, message: "Sent. No Kelpie run: the agent reads it from the page's log." };
    const run = Bun.spawnSync(["bun", KELPIE, "page", words], {
      cwd: spec.task.folder,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (run.exitCode !== 0)
      return refuse(
        `kelpie page failed: ${run.stderr.toString().trim() || run.stdout.toString().trim()}`,
        502,
      );
    return { ok: true, message: run.stdout.toString().trim() };
  },
  "/signoff": async (req) => {
    // Routes are method-agnostic and `viz verify` loads the page like a reader: only a real POST acts.
    if (req.method !== "POST" || req.headers.get("user-agent")?.includes("VizAutomation"))
      return refuse("not available");
    const { words, verdicts } = await req.json();
    const file = path.join(import.meta.dir, "spec.json");
    const spec = SpecSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    if (spec.signedOffAt) return refuse("already signed off");
    const items = [...spec.examples, ...spec.assumptions];
    if (items.some((i) => verdicts[i.id] !== "ok"))
      return refuse("not every example and assumption is agreed", 400);
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
      signedOffAt: new Date().toISOString(),
    };
    const json = `${JSON.stringify(signed, null, 2)}\n`;
    writeFileSync(file, json);
    // where pr-viz looks (pr-viz/reference/spec.md)
    if (spec.task.folder) writeFileSync(path.join(spec.task.folder, "spec.json"), json);
    return { ok: true, message };
  },
} satisfies Handlers<Routes>;
