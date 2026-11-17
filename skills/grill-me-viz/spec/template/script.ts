// The film's script, derived from spec.json so there is one copy of the words. Used by film.ts (the
// scenes) and scripts/build.ts (narration.json). Types only: nothing here may import at runtime.
import type { Spec } from "./spec.schema.js";

export interface Scene {
  title: string;
  kind: "ask" | "persona" | "should" | "shouldnt" | "plan" | "call";
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
  const n = spec.questions.length;
  return [
    { title: "The ask", kind: "ask", lines: [spec.task.title, spec.ask, spec.demo.scope] },
    // Who it changes, one chapter each: what they do today, then what they will do.
    ...spec.demo.personas.map((p): Scene => ({
      title: p.who,
      kind: "persona",
      lines: [`Today: ${p.before.text}`, `After: ${p.after.text}`],
    })),
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
        n > 0
          ? `${n} ${n === 1 ? "question needs" : "questions need"} your call. The rest is already marked right: change anything you disagree with, say why, and sign off.`
          : "Everything is already marked right. Change anything you disagree with, say why, and sign off.",
      ],
    },
  ];
}
