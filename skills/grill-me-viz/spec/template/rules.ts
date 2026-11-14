// What the schema can't say about a spec, and the page's gate message. Used by build.ts and spec.ts.
// Types only: nothing here may import at runtime.
import type { Spec } from "./spec.schema.js";

// Plain messages, one per problem; empty means the spec holds together. Takes raw JSON, so an old spec
// (hero, no demo) gets a message instead of a crash.
export function specProblems(spec: Spec): string[] {
  if ("hero" in spec)
    return [
      '"hero" was removed: say who the change alters in "demo" (scope, page, personas) instead',
    ];
  if (!spec.demo)
    return [
      'spec.json has no "demo" block: name the personas whose experience changes (SKILL.md, Spec mode)',
    ];
  const { personas, page } = spec.demo;
  const ids = personas.map((p) => p.id);
  const out: string[] = [];
  if (personas.length === 0)
    out.push(
      "demo.personas is empty: a spec needs at least one persona whose experience changes. If none does, make no spec page; hand back with who you checked and what you recommend",
    );
  if (!page.trim())
    out.push(
      "demo.page is empty: make the promised demo first (demo-viz, promised mode) and put its URL there",
    );
  if (new Set(ids).size < ids.length) out.push(`two personas share an id (${ids.join(", ")})`);
  for (const p of personas) {
    if (p.before.capture === "real" && !p.before.visual?.trim())
      out.push(
        `${p.id} (${p.who}): before.capture is "real" but has no visual; save the screenshot, terminal output or transcript and set before.visual, or use "described" when there is nothing to capture`,
      );
    if (!spec.examples.some((e) => e.kind === "should" && e.persona === p.id))
      out.push(
        `${p.id} (${p.who}): no "should" example walks this persona's journey; add one with "persona": "${p.id}", or drop the persona`,
      );
  }
  for (const e of spec.examples) {
    if (e.kind === "should" && !e.persona)
      out.push(`${e.id}: a "should" example needs a "persona" (${ids.join(", ")})`);
    else if (e.persona && !ids.includes(e.persona))
      out.push(`${e.id}: persona "${e.persona}" is not in demo.personas (${ids.join(", ")})`);
  }
  return out;
}

// ✗ on every persona means the gate failed: no one's experience changes.
export const noOneChanges = (
  personas: { id: string }[],
  verdict: (id: string) => string | undefined,
): boolean => personas.length > 0 && personas.every((p) => verdict(p.id) === "fix");

export const NO_ONE_CHANGES =
  "Every persona is marked ✗: no one's experience changes, so Sign off stays locked and this task goes back through the gate. Press Send corrections.";
