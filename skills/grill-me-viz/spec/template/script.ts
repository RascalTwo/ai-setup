// The film's script, derived from spec.json so there is one copy of the words. Used by film.ts (the
// scenes) and scripts/build.ts (narration.json). Types only: nothing here may import at runtime.
import type { Spec } from "./spec.schema.js";

export interface Scene {
  title: string;
  kind: "ask" | "should" | "shouldnt" | "plan" | "call";
  lines: string[];
}

// A scene holds at most five lines, or it runs off the stage: split a longer list evenly.
const MAX = 5;
function pages(title: string, kind: Scene["kind"], lines: string[]): Scene[] {
  if (lines.length === 0) return [];
  const n = Math.ceil(lines.length / MAX);
  const per = Math.ceil(lines.length / n);
  return Array.from({ length: n }, (_, i) => ({
    title: n > 1 ? `${title} (${i + 1} of ${n})` : title,
    kind,
    lines: lines.slice(i * per, (i + 1) * per),
  }));
}

export function script(spec: Spec): Scene[] {
  const should = spec.examples.filter((e) => e.kind === "should");
  const shouldnt = spec.examples.filter((e) => e.kind === "shouldnt");
  const n = spec.examples.length + spec.assumptions.length;
  return [
    { title: "The ask", kind: "ask", lines: [spec.task.title, spec.ask] },
    ...pages(
      "What you'll see",
      "should",
      should.map((e) => e.text),
    ),
    ...pages(
      "What won't happen",
      "shouldnt",
      shouldnt.map((e) => e.text),
    ),
    ...pages(
      "How it goes",
      "plan",
      spec.plan.map((p) => p.step),
    ),
    {
      title: "Your call",
      kind: "call",
      lines: [
        `That is ${n} things to judge. Disagree with any? Mark it, say why, and send. Otherwise, sign off.`,
      ],
    },
  ];
}
