(() => {
const DATA = __DATA__;
const pid = (location.pathname.match(/(\d{8,})/) || [])[1];
const items = DATA[pid];
if (!items) return "crv: no data for page " + pid;
document.getElementById("crv-root")?.remove();
window.__crvStop?.();
const norm = s => (s || "").replace(/\s+/g, " ").trim();
const editor = () => [...document.querySelectorAll(".ProseMirror")].sort((a, b) => b.textContent.length - a.textContent.length)[0];
const fullText = it => norm(it.text || (it.wdiff || []).filter(w => w[0] != "-").map(w => w[1]).join(" "));
const COLORS = { added: "#16a34a", changed: "#d97706", deleted: "#6b7280", note: "#dc2626" };
const color = it => it.note ? COLORS.note : COLORS[it.kind] || "#2563eb";

function locate(it) {
  const ed = editor(); if (!ed) return null;
  let t = fullText(it);
  if (it.btype === "tableRow") t = t.split(" | ")[0];
  const k = t.split("[date]").map(norm).sort((a, b) => b.length - a.length)[0].slice(0, 70);
  if (!k) return null;
  const sel = it.btype === "tableRow" ? "tr" : it.btype === "heading" ? "h1,h2,h3,h4,h5,h6" : "p,li,h1,h2,h3,h4,h5,h6,div";
  let best = null, bl = Infinity;
  for (const el of ed.querySelectorAll(sel)) {
    const tx = norm(el.textContent);
    if (tx.length < bl && tx.includes(k)) { best = el; bl = tx.length; }
  }
  return best;
}
// a block inside a collapsed expand has no box: point at the nearest visible ancestor (the expand itself)
function visible(el) {
  let e = el, hidden = false;
  while (e && e !== document.body) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { el: e, hidden };
    hidden = true; e = e.parentElement;
  }
  return { el, hidden };
}

const h = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
const root = h("div", "position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:13px/1.4 -apple-system,system-ui,sans-serif");
root.id = "crv-root";
document.body.appendChild(root);
const layer = h("div", "position:absolute;inset:0");
root.appendChild(layer);

const st = items.map((it, i) => {
  const box = h("div", `position:absolute;border:3px solid ${color(it)};border-radius:6px;background:${color(it)}14;display:none;transition:opacity .2s`);
  const tag = h("div", `position:absolute;display:none;align-items:center;gap:2px;color:${color(it)};font-weight:700;font-size:20px;white-space:nowrap`);
  const num = h("span", `display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 4px;border-radius:12px;background:${color(it)};color:#fff;font-size:13px`, String(i + 1));
  tag.append(num, h("span", "", "➜"));
  const hint = h("div", `position:absolute;display:none;background:${color(it)};color:#fff;font-size:11px;padding:1px 6px;border-radius:4px;white-space:nowrap`, "");
  layer.append(box, tag, hint);
  return { it, box, tag, hint, el: null, done: false };
});

// side panel
const panel = h("div", "position:fixed;top:112px;left:12px;width:360px;max-height:calc(100vh - 130px);overflow:auto;background:#fff;color:#172b4d;border:1px solid #c1c7d0;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.25);pointer-events:auto");
root.appendChild(panel);
const head = h("div", "position:sticky;top:0;background:#f4f5f7;padding:8px 10px;border-bottom:1px solid #dfe1e6;display:flex;gap:6px;align-items:center;flex-wrap:wrap;z-index:1");
const title = h("div", "font-weight:700;flex:1 1 100%", `Review: ${items.length} change${items.length == 1 ? "" : "s"} on this page`);
const btn = (label, fn) => { const b = h("button", "font:inherit;padding:2px 8px;border:1px solid #c1c7d0;border-radius:5px;background:#fff;color:#172b4d;cursor:pointer", label); b.onclick = e => { e.preventDefault(); e.stopPropagation(); fn(); }; return b; };
let cur = -1, showBoxes = true, collapsed = false;
const list = h("div", "padding:6px 10px 10px");
const go = d => { cur = (cur + d + st.length) % st.length; focus(cur); };
const progress = h("span", "color:#6b778c;margin-left:auto", "");
head.append(title, btn("‹ prev", () => go(-1)), btn("next ›", () => go(1)),
  btn("boxes on/off", () => { showBoxes = !showBoxes; }),
  btn("–", () => { collapsed = !collapsed; list.style.display = collapsed ? "none" : ""; }),
  btn("×", () => { stop(); root.remove(); }), progress);
const legend = h("div", "flex:1 1 100%;font-size:11px;color:#6b778c");
legend.append(...[["added", COLORS.added], ["changed", COLORS.changed], ["check this — I deviated / chose myself", COLORS.note]].map(([l, c]) => { const s = h("span", "margin-right:10px", ""); s.append(h("span", `display:inline-block;width:9px;height:9px;border-radius:2px;background:${c};margin-right:4px`), document.createTextNode(l)); return s; }));
head.appendChild(legend);
panel.append(head, list);

const cards = st.map((s, i) => {
  const it = s.it, e = it.edit || {};
  const card = h("div", `border-left:4px solid ${color(it)};padding:6px 8px;margin:8px 0;background:#fafbfc;border-radius:4px;cursor:pointer`);
  const top = h("div", "display:flex;gap:6px;align-items:baseline");
  top.append(h("span", `font-weight:700;color:${color(it)}`, `${i + 1}.`), h("span", `font-size:10px;font-weight:700;color:#fff;background:${COLORS[it.kind] || "#2563eb"};padding:0 5px;border-radius:3px`, it.kind.toUpperCase()));
  top.append(h("span", "font-weight:600", e.id ? `${e.id} — ${e.title}` : "(no single decision)"));
  const chk = h("input", "margin-left:auto"); chk.type = "checkbox"; chk.title = "mark reviewed";
  chk.onclick = ev => { ev.stopPropagation(); s.done = chk.checked; card.style.opacity = s.done ? .45 : 1; prog(); };
  top.appendChild(chk);
  card.appendChild(top);
  if (e.pick) card.appendChild(h("div", "margin-top:3px", `You picked ${e.pick}${e.pickLabel ? " — " + e.pickLabel : ""}`));
  if (e.said) card.appendChild(h("div", "margin-top:2px;font-style:italic;color:#42526e", `You said: “${e.said}”`));
  if (it.note) card.appendChild(h("div", "margin-top:4px;padding:4px 6px;background:#fff1f0;border:1px solid #ffccc7;border-radius:4px;color:#a8071a", it.note));
  if (it.wdiff) {
    const d = h("div", "margin-top:4px;font-size:12px;color:#42526e");
    for (const [op, t] of it.wdiff) {
      const sp = op === "=" ? h("span", "", t.length > 120 ? t.slice(0, 50) + " … " + t.slice(-50) : t)
        : h(op === "-" ? "del" : "ins", op === "-" ? "background:#ffe4e4;color:#a8071a" : "background:#dcfce7;color:#14532d;text-decoration:none", t);
      d.append(sp, document.createTextNode(" "));
    }
    card.appendChild(d);
  } else if (it.kind === "deleted") card.appendChild(h("del", "display:block;margin-top:4px;font-size:12px;background:#ffe4e4;color:#a8071a", (it.before || []).join(" / ").slice(0, 300)));
  else card.appendChild(h("div", "margin-top:4px;font-size:12px;color:#42526e", "“" + (fullText(it).length > 160 ? fullText(it).slice(0, 160) + "…" : fullText(it)) + "”"));
  s.where = h("div", "margin-top:3px;font-size:11px;color:#b45309", "");
  card.appendChild(s.where);
  card.onclick = () => { cur = i; focus(i); };
  list.appendChild(card);
  return card;
});
const prog = () => { progress.textContent = `${st.filter(s => s.done).length}/${st.length} reviewed`; };
prog();

function focus(i) {
  const s = st[i]; s.el = locate(s.it) || s.el;
  cards.forEach((c, j) => c.style.outline = j === i ? `2px solid ${color(st[j].it)}` : "");
  cards[i].scrollIntoView({ block: "nearest" });
  if (!s.el) return;
  visible(s.el).el.scrollIntoView({ block: "center", behavior: "smooth" });
  s.box.animate([{ boxShadow: `0 0 0 0 ${color(s.it)}` }, { boxShadow: `0 0 0 12px transparent` }], { duration: 700, iterations: 3 });
}

let t = 0;
function relocate() { for (const s of st) s.el = locate(s.it); }
relocate();
function draw() {
  for (const s of st) {
    if (!s.el || !s.el.isConnected) { s.box.style.display = s.tag.style.display = s.hint.style.display = "none"; s.where.textContent = s.it.kind === "deleted" ? "removed from the page — nothing to point at" : "⚠ couldn't find this on the page — look for the quoted text"; continue; }
    const v = visible(s.el), r = v.el.getBoundingClientRect();
    s.where.textContent = v.hidden ? "▸ inside a collapsed section — expand it to see this" : "";
    const on = showBoxes && r.bottom > 0 && r.top < innerHeight;
    s.box.style.display = on ? "" : "none";
    s.tag.style.display = on ? "flex" : "none";
    s.hint.style.display = on && v.hidden ? "" : "none";
    if (!on) continue;
    Object.assign(s.box.style, { left: r.left - 6 + "px", top: r.top - 4 + "px", width: r.width + 12 + "px", height: r.height + 8 + "px", opacity: s.done ? .3 : 1 });
    const tagLeft = Math.max(4, r.left - 58);
    Object.assign(s.tag.style, { left: tagLeft + "px", top: r.top + Math.min(r.height, 40) / 2 - 12 + "px", opacity: s.done ? .3 : 1 });
    if (v.hidden) { s.hint.textContent = `#${st.indexOf(s) + 1} is inside — expand`; Object.assign(s.hint.style, { left: r.left + "px", top: r.top - 20 + "px" }); }
  }
}
let raf = 0, iv = setInterval(() => { if (++t % 20 === 0) relocate(); }, 100);
const loop = () => { draw(); raf = requestAnimationFrame(loop); };
loop();
function stop() { cancelAnimationFrame(raf); clearInterval(iv); }
window.__crvStop = stop;
return `crv: ${items.length} items, located ${st.filter(s => s.el).length}`;
})()
