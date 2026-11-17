// The shape of spec.json, shared by the page and its backend. The contract pr-viz reads is
// pr-viz/reference/spec.md; this adds what only the page needs (visuals, demo.page, before.visual).
// What a schema can't say (every should example has a persona that exists, and so on) is rules.ts.
import { z } from "@viz/kit/zod.js";

const Verdict = z.enum(["ok", "kinda", "fix", "lost"]).optional();
// A picture for the item, as inline SVG or HTML. Leave it out only when the item is not visual.
const Visual = z.string().optional();
// A prototype of the item to try before judging: a page in the viz folder (`try/E1.html`) or the URL of a sandboxed run.
const Try = z.string().optional();
// The technical side of an item (names, files, mechanics), folded away so the card itself reads in plain words.
const Detail = z.string().optional();
export const SpecSchema = z.object({
  version: z.number(),
  changes: z.array(z.object({ v: z.number(), what: z.string() })).default([]),
  task: z.object({
    project: z.string(),
    id: z.string(),
    title: z.string(),
    folder: z.string().optional(),
  }),
  ask: z.string(),
  // The promised demo: who the change alters (the AI's pick, at least one), what they do today and what they will do.
  demo: z.object({
    scope: z.string(), // one plain sentence: what it is, then what it isn't
    page: z.string(), // the promised demo-viz page (all personas), embedded at the top of the spec page
    personas: z
      .array(
        z.object({
          id: z.string(),
          who: z.string(), // a role, not a name
          // "real": a capture of today (screenshot, terminal output, transcript) in `visual`; "described": brand-new work, nothing to capture
          before: z.object({
            text: z.string(),
            capture: z.enum(["real", "described"]),
            visual: Visual,
          }),
          after: z.object({ text: z.string() }),
          verdict: Verdict,
        }),
      )
      .min(1),
  }),
  // What the agent is unsure of, asked first as real choices (no recommendation): 2 to 4, or none.
  // Everything else on the page starts as ✓ and the user only touches what they disagree with.
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        detail: Detail,
        visual: Visual,
        options: z.array(z.object({ id: z.string(), label: z.string(), visual: Visual })).min(2),
        answer: z.string().optional(), // the picked option's id, stamped at sign-off
      }),
    )
    .default([]),
  assumptions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      detail: Detail,
      visual: Visual,
      try: Try,
      verdict: Verdict,
    }),
  ),
  examples: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["should", "shouldnt"]),
      persona: z.string().optional(), // required on "should": the persona whose journey this step is, in array order
      text: z.string(),
      detail: Detail,
      visual: Visual,
      try: Try,
      verdict: Verdict,
    }),
  ),
  visuals: z
    .array(z.object({ id: z.string(), title: z.string(), says: z.string(), html: z.string() }))
    .default([]),
  plan: z.array(z.object({ id: z.string(), step: z.string() })).default([]),
  // Stamped by build.ts on every rebuild: a ✗/kinda sent back before this goes back to "to judge".
  revisedAt: z.string().optional(),
  signedOffAt: z.string().nullable().default(null),
});
export type Spec = z.infer<typeof SpecSchema>;
