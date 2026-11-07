// walk.json: a guided walkthrough of finished work on the real build. The build agent writes it from
// the signed spec.json (SKILL.md); the page, its backend and the injected guide all read it.
import { z } from "@viz/kit/zod.js";

const Done = z.union([
  z.object({ sel: z.string(), value: z.string() }), // the element's value becomes this (a select, an input)
  z.object({ sel: z.string(), text: z.string() }), // the element's text changes to include this
  z.object({ sel: z.string() }), // the element appears
]);

export const StepSchema = z.object({
  id: z.string(), // S1, S2, …: what the page's hash, the pips and the Send words call it
  example: z.string().optional(), // the spec example this step shows (E1); only intro/outro steps have none
  say: z.string(), // HTML. Where to look and what to do; never what is right
  // web
  target: z.string().nullable().optional(), // CSS selector the guide spotlights inside the app
  done: Done.optional(), // product-tour's done: the step moves on by itself when the human does it
  reset: z.object({ sel: z.string(), value: z.string() }).optional(), // put back when the guide starts
  // journey test only: what doing the step is, when it isn't done.sel's value or a click on target
  act: z
    .array(
      z.union([
        z.object({ click: z.string() }),
        z.object({ select: z.string(), value: z.string() }),
      ]),
    )
    .optional(),
  // cli
  run: z.array(z.string()).optional(), // the command's arguments, run when the human presses it
  look: z.array(z.string()).optional(), // rows of the output to highlight
  // both
  before: z.boolean().optional(), // web: show the previous build from this step on; cli: run this step on it too
  clip: z.object({ src: z.string(), why: z.string() }).optional(), // a recording of the agent's own run, and why it isn't live
});

export const WalkSchema = z.object({
  title: z.string(),
  change: z.object({ repo: z.string(), commit: z.string(), subject: z.string() }),
  source: z.string(), // one line: what the human is looking at (a throwaway copy, nothing of theirs)
  kind: z.enum(["web", "cli"]),
  reset: z.array(z.string()), // the command that puts the throwaway copy back to its start
  cmd: z.object({ now: z.array(z.string()), before: z.array(z.string()) }).optional(), // cli: run a step's args
  stage: z
    .object({ now: z.string(), before: z.string().nullable(), token: z.string().optional() })
    .optional(), // web: the two builds' URLs; token is a file holding the URL hash to open them with
  // Send runs `kelpie page` from this run folder. env: only for a throwaway Kelpie run (the fixtures).
  relay: z.object({ folder: z.string(), env: z.record(z.string(), z.string()).optional() }),
  // What a yes does, in plain words, shown beside Accept: the agent's "Approve?" line ("adds this to
  // your local copy; nothing goes online", or what else goes live on a deploy-on-approve project)
  yes: z.string(),
  steps: z.array(StepSchema),
  notes: z.array(z.string()), // the agent's own account and doubts; open only after the decision
});
export type Walk = z.infer<typeof WalkSchema>;
export type Step = z.infer<typeof StepSchema>;
