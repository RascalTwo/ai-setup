// walk.json: a demo of a change, by persona. The agent writes it from spec.json (SKILL.md); the page,
// its backend and the injected guide all read it. `promised` is made at refine time (a throwaway mock),
// `live` at build end on the real build.
import { z } from "@viz/kit/zod.js";

const Done = z.union([
  z.object({ sel: z.string(), value: z.string() }), // the element's value becomes this (a select, an input)
  z.object({ sel: z.string(), text: z.string() }), // the element's text changes to include this
  z.object({ sel: z.string() }), // the element appears
]);

export const StepSchema = z.object({
  id: z.string(), // S1, S2, …: what the page's hash, the pips and the Send words call it
  persona: z.string(), // the spec persona (P1) whose journey this step is; the page groups by it
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
  // all kinds
  before: z.boolean().optional(), // web: show the previous build from this step on; cli: run this step on it too
  // A recording of the agent's own run, and why it isn't live. `before` is the previous version's
  // recording: an agent step needs it, so the two transcripts play side by side.
  clip: z.object({ src: z.string(), before: z.string().optional(), why: z.string() }).optional(),
  capture: z.string().optional(), // an image or text file in the viz folder standing for the before when it can't run
  promised: z.string().optional(), // HTML: what the spec promised for this step; live mode shows it behind a toggle
  differs: z.string().optional(), // plain words: how the build differs from that promise; the step is marked
  // dev kind: numbers measured doing the same task in both checkouts, drawn as paired bars
  measure: z
    .array(z.object({ label: z.string(), before: z.number(), after: z.number(), unit: z.string() }))
    .optional(),
});

export const WalkSchema = z.object({
  mode: z.enum(["promised", "live"]), // promised: no Accept/Send (judged on the spec page), embeddable; live: one decision
  title: z.string(),
  // The impact summary, 2-3 plain sentences: who is affected, their life before, their life after, why it matters. Live pages lead with it.
  impact: z.string().optional(),
  change: z.object({ repo: z.string(), commit: z.string(), subject: z.string() }),
  source: z.string(), // one line: what the human is looking at (a throwaway copy, nothing of theirs)
  kind: z.enum(["web", "cli", "agent", "dev"]),
  personas: z.array(z.object({ id: z.string(), who: z.string() })).min(1), // copied from spec.json's demo.personas
  reset: z.array(z.string()), // the command that puts the throwaway copy back to its start
  cmd: z.object({ now: z.array(z.string()), before: z.array(z.string()) }).optional(), // cli: run a step's args
  stage: z
    .object({ now: z.string(), before: z.string().nullable(), token: z.string().optional() })
    .optional(), // web: the two builds' URLs (promised: now is the mock, before null when only captures exist); token is a file holding the URL hash to open them with
  // Send runs `kelpie page` from this run folder. env: only for a throwaway Kelpie run (the fixtures).
  relay: z
    .object({ folder: z.string(), env: z.record(z.string(), z.string()).optional() })
    .optional(), // none on a promised demo: it has no Send
  // What a yes does, in plain words, shown beside Accept: the agent's "Approve?" line ("adds this to
  // your local copy; nothing goes online", or what else goes live on a deploy-on-approve project).
  // A promised demo has no Accept, so no yes.
  yes: z.string().optional(),
  steps: z.array(StepSchema),
  notes: z.array(z.string()), // the agent's own account and doubts; open only after the decision (live only)
});
export type Walk = z.infer<typeof WalkSchema>;
export type Step = z.infer<typeof StepSchema>;
