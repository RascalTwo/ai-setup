// film-shared.ts — what film.js's parts (timing, cursor, frame, controls) share: the types, and
// the few helpers every part uses.

import type { Timeline } from "@viz/kit";

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const fmt = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** An element film() just created or cannot run without — missing means a broken page, said plainly. */
export function must<E extends Element>(el: E | null, what: string): E {
  if (!el) throw new Error(`film(): no ${what}`);
  return el;
}

export interface FilmOptions {
  stage?: string;
  pad?: number;
  gap?: number;
  script?: string;
  manifest?: string;
}
export interface Chapter {
  n: number;
  title: string;
  t0: number;
  dur: number;
  beats: number[];
}
export interface Beat {
  ci: number;
  t0: number;
  dur: number;
}
/** One cursor keyframe: glide to (x, y) — stage px — at time t, and stay until `until`. */
export interface CursorFrame {
  t: number;
  until: number;
  x: number;
  y: number;
}
export interface FilmTimeline extends Timeline {
  total: number;
  seek(t: number): void;
  play(): void;
  pause(): void;
  readonly rate: number;
  chapters: { n: number; title: string; t0: number; dur: number }[];
  beats: Beat[];
}
export interface Film {
  timeline: FilmTimeline;
  chapters: FilmTimeline["chapters"];
  beats: Beat[];
  seek(t: number): void;
  rescan(): void;
  setCursor(frames: CursorFrame[]): void;
}

export const chapterAt = (chapters: Chapter[], t: number): number =>
  Math.max(
    0,
    chapters.findLastIndex((c) => t >= c.t0 - 0.01),
  );
