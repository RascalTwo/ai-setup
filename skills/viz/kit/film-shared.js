// GENERATED from kit/src/film-shared.ts by `bun run sync:kit` — edit that file, not this one.
// film-shared.ts — what film.js's parts (timing, cursor, frame, controls) share: the types, and
// the few helpers every part uses.
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** An element film() just created or cannot run without — missing means a broken page, said plainly. */
export function must(el, what) {
    if (!el)
        throw new Error(`film(): no ${what}`);
    return el;
}
export const chapterAt = (chapters, t) => Math.max(0, chapters.findLastIndex((c) => t >= c.t0 - 0.01));
