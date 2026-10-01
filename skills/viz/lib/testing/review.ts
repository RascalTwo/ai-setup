// lib/testing/review.ts — the review page's script (review.html). serveReview strips its types as it serves /review.js.

type Pending = { name: string; kind: "new" | "changed" }; // as listPending (shots.ts) sends it
type Pt = [number, number];

const $ = <E extends Element = HTMLElement>(s: string) => document.querySelector<E>(s)!;
const MODES = [["side", "Side by side"], ["swipe", "Swipe"], ["blend", "Blend"], ["flicker", "Flicker"], ["diff", "Diff"], ["bw", "Diff B/W"]] as const;
let items: Pending[] = [], at = 0, mode: string = "diff", tb = false, angle = 90, blend = 0.5, point: { x: number; y: number } | null = null, flick: ReturnType<typeof setInterval> | undefined;

const src = (which: "baseline" | "pending", name: string) => `/img/${which}/${encodeURIComponent(name)}?t=${Date.now()}`;
const load = (url: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });

async function refresh() {
  const r = await (await fetch("/list")).json() as { viz: string; pending: Pending[] };
  $("#title").textContent = `${r.viz}: ${r.pending.length} to review`;
  items = r.pending; at = Math.min(at, Math.max(0, items.length - 1));
  $("#list").innerHTML = items.map((p, i) => `<button data-i="${i}" aria-current="${i === at}"><span>${p.name}</span><span class="tag ${p.kind}">${p.kind}</span></button>`).join("");
  draw();
}
$("#list").addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-i]"); if (b) { at = +b.dataset["i"]!; refresh(); } });

async function decide(approve: boolean) {
  const p = items[at]; if (!p) return;
  await fetch(`/${approve ? "approve" : "reject"}/${encodeURIComponent(p.name)}`, { method: "POST" });
  refresh();
}

async function draw() {
  clearInterval(flick);
  const p = items[at], bar = $("#bar"), stage = $("#stage");
  if (!p) { bar.innerHTML = ""; stage.innerHTML = `<p class="empty">Nothing waiting. Close this tab and re-run <code>viz verify</code>.</p>`; return; }
  const [now, was] = await Promise.all([load(src("pending", p.name)), p.kind === "changed" ? load(src("baseline", p.name)) : null]);
  const sameSize = was && was.naturalWidth === now.naturalWidth && was.naturalHeight === now.naturalHeight;
  const m = !was ? "new" : sameSize ? mode : "side";
  bar.innerHTML = `<h2>${p.name}</h2>` + (was ? `<span class="seg">${MODES.map(([k, l], i) => `<button data-mode="${k}" aria-pressed="${m === k}" title="${i + 1}">${l}</button>`).join("")}</span>` : `<span class="tag new">new — no baseline yet</span>`)
    + (m === "side" ? `<span class="seg"><button data-tb="0" aria-pressed="${!tb}">Left | right</button><button data-tb="1" aria-pressed="${tb}">Top / bottom</button></span>` : "")
    + (m === "swipe" ? `<label class="ctl">Angle <input type="range" id="angle" min="0" max="179" value="${angle}"> <output>${angle}°</output></label>` : "")
    + (m === "blend" ? `<label class="ctl">Baseline <input type="range" id="blend" min="0" max="1" step="0.01" value="${blend}"> New</label>` : "")
    + `<span class="actions"><button class="act reject" id="reject">Reject</button><button class="act approve" id="approve">Approve</button></span>`;
  $("#approve").onclick = () => decide(true); $("#reject").onclick = () => decide(false);

  const fig = (img: HTMLImageElement, cap: string) => `<figure><figcaption>${cap}</figcaption><div class="checker" style="display:inline-block"><img src="${img.src}"></div></figure>`;
  if (m === "new" || !was) { stage.innerHTML = `<p class="note">Look at it. Approve makes it the baseline every later run is compared with.</p>` + fig(now, "new"); return; }
  if (m === "side") {
    stage.innerHTML = (sameSize ? "" : `<p class="note">The size changed (${was.naturalWidth}×${was.naturalHeight} → ${now.naturalWidth}×${now.naturalHeight}), so only side by side.</p>`)
      + `<div class="pair ${tb ? "tb" : ""}">${fig(was, "baseline")}${fig(now, "new")}</div>`;
    return;
  }
  if (m === "diff" || m === "bw") return drawDiff(was, now, m === "bw");
  stage.innerHTML = `<div class="stack checker"><img src="${was.src}" alt="baseline"><img src="${now.src}" alt="new" id="top"><svg id="guide"></svg></div>`;
  const top = $("#top");
  if (m === "blend") { top.style.opacity = String(blend); $("#blend").oninput = (e) => { blend = +(e.target as HTMLInputElement).value; top.style.opacity = String(blend); }; }
  if (m === "flicker") { let on = true; flick = setInterval(() => { on = !on; top.style.visibility = on ? "visible" : "hidden"; }, 600); }
  if (m === "swipe") swipe(top, $(".stack"));
}

// Swipe along a line at any angle: the new picture shows on one side of a line through `point`,
// the baseline on the other. Drag moves the line; the Angle slider (or Shift+wheel) turns it.
// Baseline on the left of a vertical line, new on the right — the usual way round.
function swipe(top: HTMLElement, box: HTMLElement) {
  const clip = () => {
    const w = box.clientWidth, h = box.clientHeight;
    const pt = (point ??= { x: w / 2, y: h / 2 });
    const t = ((angle + 90) * Math.PI) / 180, nx = Math.cos(t), ny = Math.sin(t);    // `angle` is the line's own direction (90° = vertical); this is its normal
    const side = ([x, y]: Pt) => (x - pt.x) * nx + (y - pt.y) * ny;
    const rect: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]], out: Pt[] = [];
    rect.forEach((a, i) => {                                                          // clip the rectangle to one half-plane
      const b = rect[(i + 1) % 4]!, sa = side(a), sb = side(b);
      if (sa >= 0) out.push(a);
      if (sa * sb < 0) { const k = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
    });
    top.style.clipPath = out.length ? `polygon(${out.map(([x, y]) => `${x}px ${y}px`).join(",")})` : "inset(100%)";
    const L = w + h, dx = -ny * L, dy = nx * L;
    $<SVGElement>("#guide").innerHTML = `<line x1="${pt.x - dx}" y1="${pt.y - dy}" x2="${pt.x + dx}" y2="${pt.y + dy}" stroke="#fff" stroke-width="2" stroke-dasharray="6 4"/><circle cx="${pt.x}" cy="${pt.y}" r="7" fill="#fff"/>`;
    const slider = document.querySelector<HTMLInputElement>("#angle");
    if (slider) { slider.value = String(angle); slider.nextElementSibling!.textContent = angle + "°"; }
  };
  const move = (e: PointerEvent) => { const r = box.getBoundingClientRect(); point = { x: e.clientX - r.left, y: e.clientY - r.top }; clip(); };
  box.onpointerdown = (e) => { box.setPointerCapture(e.pointerId); move(e); box.onpointermove = move; };
  box.onpointerup = () => (box.onpointermove = null);
  box.onwheel = (e) => { if (!e.shiftKey) return; e.preventDefault(); angle = (angle + (e.deltaY > 0 ? 3 : -3) + 180) % 180; clip(); };
  $("#angle").oninput = (e) => { angle = +(e.target as HTMLInputElement).value; clip(); };
  requestAnimationFrame(clip);
}

// Every pixel's difference, as the largest per-channel change (0–255). "diff": the baseline greyed
// out with red on top, as strong as the change. "bw": black where equal, brighter the more different.
function drawDiff(was: HTMLImageElement, now: HTMLImageElement, bw: boolean) {
  const w = now.naturalWidth, h = now.naturalHeight, px = (img: HTMLImageElement) => { const c = new OffscreenCanvas(w, h), g = c.getContext("2d")!; g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
  const a = px(was), b = px(now), c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d")!, out = g.createImageData(w, h), o = out.data;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!));
    if (d) changed++;
    if (bw) { o[i] = o[i + 1] = o[i + 2] = d; }
    else { const grey = 40 + 0.25 * (0.299 * a[i]! + 0.587 * a[i + 1]! + 0.114 * a[i + 2]!), k = d / 255;
      o[i] = grey + (255 - grey) * k; o[i + 1] = grey * (1 - k); o[i + 2] = grey * (1 - k); }
    o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  $("#stage").innerHTML = `<p class="note">${changed.toLocaleString()} of ${(w * h).toLocaleString()} pixels differ (${(100 * changed / (w * h)).toFixed(2)}%). ${bw ? "Brighter = more different." : "Redder = more different."}</p>`;
  $("#stage").append(c);
}

$("#bar").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("button"); if (!b) return;
  if (b.dataset["mode"]) { mode = b.dataset["mode"]; draw(); }
  if (b.dataset["tb"]) { tb = b.dataset["tb"] === "1"; draw(); }
});
addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.target as Element).matches("input")) return;
  const m = MODES[+e.key - 1];
  if (e.key === "a") decide(true);
  else if (e.key === "r") decide(false);
  else if (e.key === "ArrowDown" || e.key === "j") { at = Math.min(items.length - 1, at + 1); refresh(); }
  else if (e.key === "ArrowUp" || e.key === "k") { at = Math.max(0, at - 1); refresh(); }
  else if (m) { mode = m[0]; draw(); }
});
refresh();
