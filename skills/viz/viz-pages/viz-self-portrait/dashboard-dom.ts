// Reaching the page's own markup, and starting background work.

/** A required element of the page's own markup. Throws on use if it is missing, as the casts it replaces did. */
export const $ = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
/** The same, narrowed to a kind (a <select>, an <input>…): throws now if the markup has something else there. */
export function byKind<T extends HTMLElement>(selector: string, kind: new () => T): T {
  const el = document.querySelector(selector);
  /* c8 ignore next -- every id is fixed by index.html and the tests load it; the throw names the missing one instead of a bare TypeError */
  if (!(el instanceof kind)) throw new TypeError(`${selector} is not a ${kind.name}`);
  return el;
}
/** The nearest ancestor-or-self of an event's target that matches `selector` (SVG targets included). */
export function closestTo(e: Event, selector: string): HTMLElement | null {
  /* c8 ignore next -- a delegated listener's target on this page is always an Element; the check only narrows EventTarget for the type checker */
  return e.target instanceof Element ? e.target.closest<HTMLElement>(selector) : null;
}
/** Starts work nobody waits for (a listener, a timer): a rejection is logged, never left unhandled. */
export function fire(work: Promise<unknown>): void {
  work.catch((e: unknown) => {
    /* c8 ignore next -- only a rejecting background task reaches this, and no test makes one reject; the line exists so it is logged, not lost */
    console.error(e);
  });
}
