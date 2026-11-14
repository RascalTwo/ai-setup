// GENERATED from kit/src/exchange-shared.ts by `bun run sync:kit` — edit that file, not this one.
// exchange-shared.ts — what the exchange runtime's parts share: the shape of the data a variant's
// content.js exports (EXCHANGE.md), and the two DOM helpers every part builds with.
export const SVGNS = "http://www.w3.org/2000/svg";
/** `v`, or `d` when `v` is missing or falsy: 0 and "" count as missing (a plain `??` would keep them). */
// oxlint-disable-next-line typescript/prefer-nullish-coalescing -- the point of this helper: 0 and "" fall back too
export const orElse = (v, d) => v || d;
export const el = (t, c, h) => {
    const d = document.createElement(t);
    if (c)
        d.className = c;
    if (h !== undefined && h !== null)
        d.innerHTML = h;
    return d;
};
/** Every id queried is created by mount(); missing one is a broken runtime, said plainly. */
export const $ = (s) => {
    const e = document.querySelector(s);
    if (!e)
        throw new Error(`exchange: no ${s}`);
    return e;
};
