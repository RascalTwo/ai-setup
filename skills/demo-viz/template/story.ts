// The story: one card per change, four parts each (problem, before, after, why), told in order.
// Plain logic, no DOM: app.ts draws the parts and plays them with play.ts's player.
import type { Change } from "./walk.schema.js";

export type Part = {
  key: "problem" | "before" | "after" | "why";
  label: string;
  line: string;
  pic?: string | undefined;
};

export function partsOf(c: Change): Part[] {
  return [
    { key: "problem", label: "The problem", line: c.problem },
    { key: "before", label: "Before", ...c.before },
    { key: "after", label: "After", ...c.after },
    { key: "why", label: "Why it matters", line: c.why },
  ];
}

/** How long a line stays up when nothing is speaking it: about 3 words a second, with a beat to look at a picture. */
export function readMs(line: string, pic = false): number {
  const words = line.trim().split(/\s+/u).filter(Boolean).length;
  return Math.round(1200 + words * 330 + (pic ? 1500 : 0));
}

export const isVideo = (src: string): boolean => /\.(?:webm|mp4|mov)$/iu.test(src);
