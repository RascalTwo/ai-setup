// GENERATED from kit/src/exchange-stage.ts by `bun run sync:kit` — edit that file, not this one.
// exchange-stage.ts — the page an exchange is drawn on: the shell (top bar, stage, narration bar)
// and the static scenery on the stage (zones, firewalls, lanes, actor boxes, result panels, labels).
import { SVGNS, el, orElse } from "@viz/kit/exchange-shared.js";
/** The top bar, the stage with its two SVG layers (wires, packets) and the narration bar. */
export function buildShell(exchange, stageW, stageH) {
    const topbar = el("div", "topbar", `<h1>${exchange.title}</h1>
    <div class="sub">${exchange.subtitle ?? ""}</div><div class="spacer"></div>
    <div class="controls">
      <button id="restart">⟲ Restart</button><button id="prev">‹ Step</button>
      <button id="play" class="primary">▶ Play</button><button id="next">Step ›</button>
    </div>`);
    const wrap = el("div", "stagewrap");
    const stage = el("div", "stage");
    stage.id = "stage";
    stage.style.width = stageW + "px";
    stage.style.height = stageH + "px";
    const svg = document.createElementNS(SVGNS, "svg");
    svg.id = "wires";
    const pktLayer = document.createElementNS(SVGNS, "svg");
    pktLayer.id = "pkts";
    // Both the ATTRIBUTE and the inline STYLE, and the style is the one that matters:
    // engine.css pins #wires/#pkts to the 1780x1630 default, and a CSS declaration
    // beats a presentation attribute — so on a larger stage these layers stayed
    // 1780 wide and only kept working because they are overflow:visible. Verified
    // 2026-08-06 on the 1900px variant, where clientWidth read 1780.
    for (const s of [svg, pktLayer]) {
        s.setAttribute("width", String(stageW));
        s.setAttribute("height", String(stageH));
        s.style.width = stageW + "px";
        s.style.height = stageH + "px";
    }
    stage.append(svg, pktLayer);
    wrap.append(stage);
    const narr = el("div", "narr", `<div class="narrinner">
      <div class="stepno" id="stepno"></div>
      <div class="narrtext"><div class="nt" id="ntitle"></div><div class="track" id="track"></div></div>
    </div>`);
    document.body.append(topbar, wrap, narr);
    return { stage, svg, pktLayer };
}
/** Zones, firewalls and phase lanes: the bands the actors stand in. */
export function buildScenery(exchange, stage, stageW) {
    for (const z of exchange.zones ?? []) {
        const d = el("div", "zone " + (z.cls ?? ""));
        Object.assign(d.style, {
            left: z.x + "px",
            top: z.y + "px",
            width: z.w + "px",
            height: z.h + "px",
        });
        d.append(el("div", "ztitle", z.title), el("div", "zsub", z.sub ?? ""));
        stage.append(d);
    }
    for (const f of exchange.firewalls ?? []) {
        const d = el("div", "fw");
        Object.assign(d.style, { left: f.x + "px", top: f.y + "px", height: f.h + "px" });
        stage.append(d);
        const l = el("div", "fwlabel", f.label);
        Object.assign(l.style, { left: f.x - 15 + "px", top: f.y + orElse(f.labelAt, 520) + "px" });
        stage.append(l);
    }
    for (const L of exchange.lanes) {
        const d = el("div", "lane");
        d.id = "lane" + L.id;
        Object.assign(d.style, {
            left: "16px",
            top: L.y + "px",
            width: stageW - 32 + "px",
            height: L.h + "px",
        });
        const t = el("div", "lanetag", `${L.tag}<b>${L.name}</b>`);
        Object.assign(t.style, { left: orElse(L.tagX, 344) + "px", top: "-44px" });
        d.append(t);
        stage.append(d);
    }
}
/** The actor boxes, by id. */
export function buildNodes(exchange, stage) {
    const nodeEls = {};
    for (const [id, n] of Object.entries(exchange.nodes)) {
        const d = el("div", "node " + (n.cls ?? ""));
        d.dataset["vizId"] = "node-" + id;
        d.dataset["label"] = n.name;
        Object.assign(d.style, {
            left: n.x + "px",
            top: n.y + "px",
            width: n.w + "px",
            height: n.h + "px",
        });
        d.innerHTML =
            (n.tag ? `<div class="ntag">${n.tag}</div>` : "") +
                `<div class="nname">${n.name}</div>` +
                (n.role ? `<div class="nrole">${n.role}</div>` : "") +
                (n.spec ? `<div class="specrole">${n.spec}</div>` : "");
        if (n.spec)
            d.style.paddingBottom = "26px";
        stage.append(d);
        nodeEls[id] = d;
    }
    return nodeEls;
}
/** The per-phase result panels and the free-standing hand labels. */
export function buildPanels(exchange, stage) {
    for (const p of exchange.panels ?? []) {
        const d = el("div", "panelbox " + (p.cls ?? ""));
        d.id = p.id;
        d.dataset["vizId"] = p.id;
        d.dataset["label"] = p.title;
        Object.assign(d.style, { left: p.x + "px", top: p.y + "px", width: p.w + "px" });
        d.innerHTML = `<h5>${p.title}</h5><div class="body ${p.bodyCls ?? ""}">${p.body ?? ""}</div>`;
        stage.append(d);
    }
    for (const b of exchange.labels ?? []) {
        const d = el("div", "handlabel", b.text);
        d.id = b.id;
        d.dataset["vizId"] = b.id;
        Object.assign(d.style, { left: b.x + "px", top: b.y + "px" });
        stage.append(d);
    }
}
