// Small helpers shared by the exhibits. Everything here is invented-data plumbing: nothing reads a
// real grill, a real log or a real screenshot.

export const SVGNS = "http://www.w3.org/2000/svg";

/** A value that must exist: the exhibits build their own DOM, so a miss is a bug, not a state. */
export function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}

/** `arr[i]` that throws instead of returning undefined (noUncheckedIndexedAccess). */
export function at<T>(arr: readonly T[], i: number): T {
  return must(arr[i], `index ${i}`);
}

/** `root.querySelector` that must find something. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type argument is the caller's typing of a selector lookup, as with querySelector<T>
export function q<T extends Element>(root: ParentNode, sel: string): T {
  return must(root.querySelector<T>(sel), sel);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Set many attributes at once on an element. */
export function attrs<E extends Element>(el: E, a: Record<string, string | number>): E {
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, String(v));
  return el;
}

/** Does the reader want less motion? Exhibits that animate jump to the end state instead. */
export const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Mark exactly one button of a group as pressed. */
export function pressOne(btns: Iterable<HTMLElement>, on: HTMLElement | null): void {
  for (const b of btns) {
    const yes = b === on;
    b.classList.toggle("on", yes);
    b.setAttribute("aria-pressed", String(yes));
  }
}
