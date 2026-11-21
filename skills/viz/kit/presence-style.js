// GENERATED from kit/src/presence-style.ts by `bun run sync:kit` — edit that file, not this one.
// presence-style.ts — the people layer's stylesheet and the layer it draws on (shared by presence.js's parts).
import { el } from "@viz/kit/presence-shared.js";
const CSS = `
#viz-presence{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none;font:12px/1.3 var(--sans,system-ui,sans-serif)}
#viz-presence .vp-cur{position:absolute;transition:left .08s linear,top .08s linear}
#viz-presence .vp-cur svg{display:block}
#viz-presence .vp-name{position:absolute;left:14px;top:14px;white-space:nowrap;padding:1px 6px;border-radius:8px;color:#0d1117;font-weight:600}
#viz-presence .vp-cur.elsewhere{opacity:.35}
#viz-presence .vp-cur.elsewhere .vp-name{pointer-events:auto;cursor:pointer}
#viz-presence .vp-bubble{position:absolute;left:14px;top:34px;max-width:260px;padding:4px 9px;border-radius:10px;color:#0d1117;animation:vp-fade 6s forwards}
#viz-presence .vp-ring{position:absolute;border:3px solid;border-radius:6px;animation:vp-fade 3s forwards}
#viz-presence .vp-dot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border:3px solid;border-radius:50%;animation:vp-fade 3s forwards}
#viz-presence svg.vp-ink{position:absolute;left:0;top:0;overflow:visible}
#viz-presence .vp-ink polyline{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;animation:vp-fade 4s forwards}
#viz-presence input.vp-say{position:absolute;pointer-events:auto;width:220px;padding:4px 8px;border-radius:10px;border:2px solid;background:#0d1117;color:#fff;font:inherit}
@keyframes vp-fade{0%,70%{opacity:1}100%{opacity:0}}
.vp-btn{all:unset;cursor:pointer;padding:0 8px;font:600 12px var(--sans,system-ui);color:var(--text,#e6edf3)}
.vp-panel{position:fixed;right:14px;bottom:60px;width:280px;max-height:60vh;overflow:auto;z-index:2147483001;background:var(--panel,#161b22);color:var(--text,#e6edf3);border:1px solid var(--border,#30363d);border-radius:10px;padding:10px;font:13px/1.4 var(--sans,system-ui);box-shadow:0 8px 30px #0008}
.vp-panel h4{margin:8px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8b949e)}
.vp-row{display:flex;align-items:center;gap:6px;padding:2px 0}
.vp-row .vp-sw{width:10px;height:10px;border-radius:50%;flex:none}
.vp-row .vp-who{flex:1;cursor:pointer}
.vp-row.away .vp-who{opacity:.45}
.vp-panel button{font:inherit;color:inherit;background:var(--panel-2,#21262d);border:1px solid var(--border,#30363d);border-radius:6px;padding:2px 8px;cursor:pointer}
.vp-panel input[type=color]{width:22px;height:22px;padding:0;border:none;background:none}
.vp-panel input[type=text]{width:100%;box-sizing:border-box;background:var(--bg,#0d1117);color:inherit;border:1px solid var(--border,#30363d);border-radius:6px;padding:4px 6px;font:inherit}
.vp-log{max-height:140px;overflow:auto;font-size:12px}
.vp-panel button.vp-switch{position:relative;flex:none;width:30px;height:16px;padding:0;border-radius:8px}
.vp-switch::after{content:"";position:absolute;left:2px;top:2px;width:10px;height:10px;border-radius:50%;background:var(--muted,#8b949e);transition:left .15s}
.vp-switch[aria-checked=true]::after{left:16px;background:#3fb950}
.vp-solo{position:fixed;right:14px;bottom:14px;z-index:2147483000;background:var(--panel,#161b22);border:1px solid var(--border,#30363d);border-radius:16px;padding:4px 2px}`;
/** Adds the stylesheet and the page-sized layer (cursors, pings, bubbles) with its ink canvas. */
export function mountLayer() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    const layer = el("div", { id: "viz-presence", "data-viz-chrome": "" });
    const inkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    inkSvg.classList.add("vp-ink");
    layer.append(inkSvg);
    document.documentElement.append(layer);
    return { layer, inkSvg };
}
