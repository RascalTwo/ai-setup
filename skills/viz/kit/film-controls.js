// GENERATED from kit/src/film-controls.ts by `bun run sync:kit` — edit that file, not this one.
// film-controls.ts — the chapter bar (part of the picture, so it renders) and the controls for a
// person in the browser (`viz render` hides [data-viz-chrome]): play/pause, chapters, scrubber,
// speed, and the keys.
import { $, $$ } from "@viz/kit";
import { RATES, must } from "@viz/kit/film-shared.js";
/** Chapter bar: segment width = chapter length. Returns the segments and the clock. */
export function buildBar(root, chapters) {
    root.insertAdjacentHTML("beforeend", `<div id="film-bar"><div class="segs">${chapters.map((c) => `<div style="flex:${c.dur}" title="${c.title}"><i></i></div>`).join("")}</div><div class="meta"><span class="pos"></span><span class="clock"></span></div></div>`);
    return {
        segs: $$("#film-bar .segs div", root),
        clock: must($("#film-bar .clock", root), "clock"),
    };
}
export function buildControls() {
    document.body.insertAdjacentHTML("beforeend", `<div id="film-controls" data-viz-chrome>
    <button data-go="-1" title="previous chapter (←)">⏮</button><button data-play title="play / pause (space)">▶</button>
    <button data-go="1" title="next chapter (→)">⏭</button><input type="range" min="0" max="1000" value="0" aria-label="position"><span class="pos"></span>
    <select data-rate title="speed (&lt; &gt;)" aria-label="playback speed">${RATES.map((r) => `<option value="${r}">${r}×</option>`).join("")}</select></div>`);
    const ctl = must($("#film-controls"), "#film-controls");
    return {
        ctl,
        scrub: must($("input", ctl), "scrubber"),
        playBtn: must($("[data-play]", ctl), "play button"),
        ctlPos: must($(".pos", ctl), "position readout"),
        rateSel: must($("[data-rate]", ctl), "speed selector"),
    };
}
/** The playback speed: SPEED IS THE VIEWER'S, like the CC toggle — remembered in this browser, not in the link. */
export function createRate(rateSel) {
    // narrate() plays its clips at the same rate, so voice and picture stay together.
    const stored = Number(localStorage.getItem("viz-rate"));
    let rate = RATES.includes(stored) ? stored : 1;
    const set = (r) => {
        rate = r;
        rateSel.value = String(r);
        localStorage.setItem("viz-rate", String(r));
    };
    set(rate);
    rateSel.addEventListener("change", () => set(+rateSel.value));
    return {
        get value() {
            return rate;
        },
        set,
    };
}
/** Buttons, scrubber and keys → the film. */
export function wireControls({ ctl, scrub }, d) {
    ctl.addEventListener("click", (e) => {
        const b = e.target instanceof Element ? e.target.closest("button") : null;
        if (!b)
            return;
        if (b.dataset["go"])
            d.go(+b.dataset["go"]);
        else
            d.toggle();
    });
    scrub.addEventListener("input", () => d.seek((+scrub.value / 1000) * d.total));
    addEventListener("keydown", (e) => {
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el &&
            /INPUT|TEXTAREA/u.test(el.tagName) &&
            !(el instanceof HTMLInputElement && el.type === "range"))
            return;
        if (e.key === " ") {
            e.preventDefault();
            d.toggle();
        }
        else if (e.key === "ArrowRight")
            d.go(1);
        else if (e.key === "ArrowLeft")
            d.go(-1);
        else if (e.key === ">" || e.key === "<")
            d.rate.set(RATES[Math.min(RATES.length - 1, Math.max(0, RATES.indexOf(d.rate.value) + (e.key === ">" ? 1 : -1)))] ?? 1);
    });
}
