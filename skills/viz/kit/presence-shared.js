// GENERATED from kit/src/presence-shared.ts by `bun run sync:kit` — edit that file, not this one.
// presence-shared.ts — what presence.js's parts (cursors, pings, sync, messages, ink, panel) share:
// the types, the one Ctx record they all take, and the small DOM helpers.
export const ADJ = "teal amber coral indigo olive plum rust sage slate ivory ochre cobalt crimson jade lilac maroon mint navy peach pearl ruby sand scarlet silver smoky sunny tawny violet wheat azure bronze copper".split(" ");
export const ANIMAL = "otter heron lynx badger finch koala marten newt puffin quokka raven tapir bison crane dingo egret ferret gecko ibis jackal lemur moose narwhal ocelot panda quail robin seal toucan walrus yak zebra".split(" ");
export const THING = "lamp kite anchor lantern compass harbor meadow pebble ribbon summit tundra willow canyon delta ember fjord glacier hollow island jetty lagoon mesa orchard prairie quarry reef spire thicket valley wharf beacon cove".split(" ");
export const COLORS = [
    "#4cc9f0",
    "#f72585",
    "#ffb703",
    "#80ed99",
    "#c77dff",
    "#ff7b54",
    "#2ec4b6",
    "#e9ff70",
];
export const any = (a) => a[Math.floor(Math.random() * a.length)] ?? "";
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function makeActions(room) {
    return {
        hi: room.makeAction("hi"),
        cur: room.makeAction("cur"),
        ping: room.makeAction("ping"),
        say: room.makeAction("say"),
        ink: room.makeAction("ink"),
        act: room.makeAction("act"),
        st: room.makeAction("st"),
        hist: room.makeAction("hist"),
    };
}
export function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs))
        node.setAttribute(k, v);
    if (text !== undefined)
        node.textContent = text;
    return node;
}
/** A send nobody waits for: a failed one is the peer's loss, never the page's. */
export function fire(sent) {
    sent.catch(() => {
        // peers come and go; there is nothing to retry or report
    });
}
export const toPage = ([fx, y]) => ({
    left: fx * document.documentElement.scrollWidth,
    top: y,
});
export const fromEvent = (e) => [
    e.pageX / document.documentElement.scrollWidth,
    e.pageY,
];
export const mine = (t) => t instanceof Element && !!t.closest("#viz-presence,.vp-panel,#viz-feedback,.vp-solo");
export const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(t.tagName));
export const find = (sel) => {
    try {
        return document.querySelector(sel);
    }
    catch {
        return null;
    }
};
