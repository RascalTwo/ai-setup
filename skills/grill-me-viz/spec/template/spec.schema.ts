// The shape of spec.json, shared by the page and its backend. The contract pr-viz reads is
// pr-viz/reference/spec.md; this adds what only the page needs (hero.slot, visuals).
import { z } from "@viz/kit/zod.js";

const Verdict = z.enum(["ok", "kinda", "fix"]).optional();
// A picture for the item, as inline SVG or HTML. Leave it out only when the item is not visual.
const Visual = z.string().optional();
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
  hero: z.object({ done: z.array(z.string()), scope: z.string(), slot: z.string() }),
  assumptions: z.array(
    z.object({ id: z.string(), text: z.string(), visual: Visual, verdict: Verdict }),
  ),
  examples: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["should", "shouldnt"]),
      text: z.string(),
      visual: Visual,
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
