import { stepper, $ } from "/_kit/viz.js";

type Row = [string, string, "ok" | "bad"];
interface Step { t: string; rows: Row[]; lede: string }

const S: Step[] = [
  { t: "POSTTOOLUSE FIRES",
    rows: [["raw stdin, unparsed", "string", "ok"], ["SNIFF regex", "\\.png · \"type\":\"image\"", "ok"],
           ["json.loads", "skipped on no match", "bad"]],
    lede: "The hook runs after <b>every</b> tool call, so it scans the raw payload as text first and returns before parsing if nothing looks image-shaped. Common case = interpreter startup." },
  { t: "RESOLVE THE SESSION",
    rows: [["$HERDR_PANE_ID", "%3", "ok"], ["herdr pane get → agent_session", "a41f…", "ok"],
           ["payload session_id", "fallback only", "bad"]],
    lede: "<code>session_name()</code> asks herdr, not the payload. A session running as a background job reports a job id in <code>session_id</code> — the viewer would then read a different folder than the hook wrote." },
  { t: "HARVEST",
    rows: [["collect_b64(tool_input)", "0", "ok"], ["collect_b64(tool_response)", "1 image block", "ok"],
           ["collect_paths(tool_input)", "/tmp/shot.png", "ok"], ["SHOW_RE(tool_response)", "show-image: lines", "ok"],
           ["collect_paths(tool_response)", "never called", "bad"]],
    lede: "The asymmetry is the capture rule. Base64 blocks count from anywhere; a <b>path</b> counts only where the tool was <em>asked</em> to act on it — otherwise one <code>ls ~/Pictures</code> floods the gallery. <code>show-image</code> announces its PNG on one output line." },
  { t: "GUARD",
    rows: [["size ≥ MIN_BYTES (2048)", "184 KB", "ok"], ["count ≤ MAX_PER_CALL (5)", "2", "ok"],
           ["already_spooled(base, size)", "no match", "ok"], ["dir == the spool itself", "skip", "bad"]],
    lede: "Dedup is <b>basename plus byte count</b>, not mtime. Without it every <code>open</code> or <code>cp</code> mentioning the same file re-copies it." },
  { t: "WRITE",
    rows: [["~/.agents/state/ttyimgspool/a41f…/", "mkdir -p", "ok"],
           ["20260913-142207-Bash-shot.png", "written", "ok"], [".hook.log", "saved=1", "ok"]],
    lede: "Timestamp, tool name, basename. The directory sorts by time on its own, and the log only gets a line when something was actually saved." },
  { t: "DRAW INLINE",
    rows: [["can_draw(): Ghostty · kitty_graphics = true", "yes", "ok"], ["upload to Claude Code's tty", "a=t, 3072-byte APCs, q=2", "ok"],
           ["placement", "a=p,U=1 · 40×12 cells", "ok"], ["systemMessage", "12 rows of U+10EEEE, fg = image id", "ok"],
           ["path only cp'd / open'd", "gallery-only", "bad"]],
    lede: "Only images Claude <b>saw</b> — base64 blocks, a <code>Read</code>, a paste, a <code>show-image</code> line. Claude Code prints the placeholder cells as text, and the terminal paints the picture wherever they are." },
  { t: "CTRL+CLICK",
    rows: [["OSC 8 link on image + caption", "file://…/shot.png", "ok"], ["plain click, file://", "Claude Code → Finder reveal", "bad"], ["plain click, borrowed scheme", "ttyimgspool-link <scheme>", "ok"],
           ["herdr link_handlers → rascaltwo.ttyimgspool", "view open", "ok"], ["overlay pane, original PNG", "full-pane · any key closes", "ok"]],
    lede: "Claude Code swallows a plain click on a <code>file://</code> link (claude-code#95675), so <b>Ctrl+click</b> goes to herdr instead. Borrow a scheme Claude Code does open with <code>ttyimgspool-link</code> and a <b>plain click</b> works too. Either way it shows the original file, not the thumbnail." },
  { t: "PREFIX+I",
    rows: [["same agent_session lookup", "a41f…", "ok"], ["prune to KEEP (100)", "0 removed", "ok"],
           ["sweep dirs older than DAYS (30)", "2 swept", "ok"], ["chafa -f kitty --size 22x8", "8 thumbs", "ok"]],
    lede: "Opening the gallery is also the only garbage collection. Then it draws once and holds a <code>dirty</code> flag — the footer repaints per keystroke, the kitty-graphics grid does not." },
];

const stage = $("#stage")!, lede = $("#lede")!, pos = $("#pos")!;
const render = (i: number): void => {
  const s = S[i]!;
  stage.innerHTML =
    `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--c4);margin-bottom:12px">${i + 1} · ${s.t}</div>` +
    s.rows.map(([k, v, st]) => `
      <div style="display:flex;justify-content:space-between;gap:14px;font-family:var(--mono);font-size:13px;
                  padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text)">${k}</span>
        <span style="color:${st === "ok" ? "var(--good)" : "var(--danger)"};white-space:nowrap">${st === "ok" ? "✓" : "✗"} ${v}</span>
      </div>`).join("");
  lede.innerHTML = s.lede;
  pos.textContent = `${i + 1} / ${S.length}`;
};

const st = stepper({ n: S.length, onStep: render, autoplayMs: 2600, hashKey: "spool" });
$("#next")!.onclick = () => st.next();
$("#prev")!.onclick = () => st.prev();
const play = $("#play")!;
let on = false;
play.onclick = () => { on = !on; on ? st.play() : st.pause(); play.textContent = on ? "❚❚ pause" : "▶ play"; };
for (const el of [$("#next")!, $("#prev")!])
  el.addEventListener("click", () => { on = false; play.textContent = "▶ play"; });

// ── The hero demo: a recreated Claude Code session. Every step renders from
// scratch (so ◀ and a #demo= link land in the right state); only a forward step
// from its predecessor animates.
const CAP = [
  "You ask Claude something about a page.",
  "Claude takes a screenshot.",
  "It lands inline, right under the tool call.",
  "Click it.",
  "The original, full-pane, full resolution.",
  "Click again to close. Claude carries on.",
  "prefix + i: every image this session saw.",
  "Click any thumbnail.",
  "Same full-pane view, from the gallery.",
];
const PROMPT = "is the self-portrait page rendering right?";

const term = $("#term")!, zoom = $("#zoom")!, zimg = $("#zimg") as HTMLImageElement, zbar = $("#zbar")!;
const cur = $("#cursor")!, rip = $("#ripple")!, kbd = $("#kbd")!, gallery = $("#gallery")!;
const typed = $("#typed")!, imgs = $("#imgs")!, thumbImg = $("#thumb img") as HTMLImageElement;
// the gallery's images live in the HTML, not built here: publish inlines <img src>, not JS strings
const cells = [...term.querySelectorAll<HTMLElement>(".cell")];
let pick = 2;                                  // which gallery image steps 7–8 open

// term-local layout coordinates; the card is transform-scaled, rects are not
const box = (el: Element, rel: Element = term) => {
  const k = term.getBoundingClientRect().width / term.offsetWidth;
  const r = el.getBoundingClientRect(), t = rel.getBoundingClientRect();
  return { x: (r.left - t.left) / k, y: (r.top - t.top) / k, w: r.width / k, h: r.height / k };
};
const place = (b: { x: number; y: number; w: number; h: number }) =>
  Object.assign(zimg.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
const fit = () => {
  const W = zoom.offsetWidth, H = zoom.offsetHeight - 24;
  let w = W, h = w * 630 / 1200;
  if (h > H) { h = H; w = h * 1200 / 630; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
};
const point = (el: Element, animate: boolean, dx = 0.55, dy = 0.5) => {
  const b = box(el);
  cur.style.transition = animate ? "" : "none";
  Object.assign(cur.style, { left: `${b.x + b.w * dx}px`, top: `${b.y + b.h * dy}px` });
};
const click = (delay = 820) => setTimeout(() => {
  Object.assign(rip.style, { left: cur.style.left, top: cur.style.top });
  rip.classList.remove("on"); void rip.offsetWidth; rip.classList.add("on");
}, delay);
const key = (label: string) => { kbd.textContent = label; kbd.classList.remove("on"); void kbd.offsetWidth; kbd.classList.add("on"); };

let typing: ReturnType<typeof setInterval> | undefined;
let prev = -1;
const show = (i: number) => {
  const fwd = i === prev + 1;
  clearInterval(typing);
  term.dataset["step"] = String(i);
  for (const el of term.querySelectorAll<HTMLElement>("[data-s]"))
    el.classList.toggle("on", i >= Number(el.dataset["s"]) && i < Number(el.dataset["until"] ?? 6));
  // the prompt: typed in the input box at step 0, moved into the transcript after
  typed.textContent = "";
  if (i === 0) {
    let n = 0;
    typing = setInterval(() => { typed.textContent = PROMPT.slice(0, ++n); if (n >= PROMPT.length) clearInterval(typing); },
                         fwd || prev < 0 ? 38 : 0);
  }
  imgs.textContent = i >= 2 ? "🖼 6" : "🖼 5";
  imgs.classList.toggle("hot", i >= 2);
  gallery.classList.toggle("on", i >= 6);
  cells.forEach((c, k) => c.style.outline = i === 7 && k === pick ? "1px solid var(--c5)" : "");

  const zoomed = i === 4 || i === 8;
  const src = i === 8 ? cells[pick]! : $("#thumb")!;
  if (zoomed) {
    const img = (i === 8 ? cells[pick]!.querySelector("img") : thumbImg) as HTMLImageElement;
    const n = i === 8 ? cells[pick]!.dataset["name"] : "viz-self-portrait.png";
    zimg.src = img.src;
    zbar.textContent = i === 8
      ? `[${pick + 1}/6] ${n}   n older · p newer · g/click gallery · q quit`
      : `${n} · 1200×630   (click or any key closes)`;
    zoom.classList.add("on");
    zimg.style.transition = "none";
    place(fwd ? box(src.querySelector("img")!, zoom) : fit());
    void zimg.offsetWidth; zimg.style.transition = "";
    place(fit());
  } else if (prev === 4 && i === 5) {           // shrink back into the thumbnail
    place(box(thumbImg, zoom));
    setTimeout(() => zoom.classList.remove("on"), 380);
  } else zoom.classList.remove("on");

  // the pointer
  if (i <= 2) point(thumbImg, false, 0.9, 0.8);   // hovering on the thumbnail
  if (i === 3) { point(thumbImg, fwd); click(fwd ? 820 : 0); }
  if (i === 4 && !fwd) point(zoom, false, 0.62, 0.45);
  if (i === 5) { click(0); point(thumbImg, true, 0.9, 0.8); }
  if (i === 6) { point(gallery.querySelector(".gfoot")!, fwd, 0.8, -1.5); if (fwd) key("ctrl+b  i"); }
  if (i === 7) { point(cells[pick]!, fwd); click(fwd ? 820 : 0); }
  if (i === 1 && fwd) key("⏎");

  $("#dpos")!.textContent = `${i + 1} / ${CAP.length}`;
  $("#dcap")!.textContent = CAP[i]!;
  prev = i;
};

// the stepper stops at the end; the hero loops, with a beat on the last frame
function loop(i: number) {
  if (i === CAP.length - 1) setTimeout(() => { if (playing) { demo.go(0, false); demo.play(); } }, 3200);
}
const quiet = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.webdriver;
const demo = stepper({ n: CAP.length, onStep: (i) => { show(i); loop(i); }, autoplayMs: 2500, hashKey: "demo", target: term });
const dplay = $("#dplay")!;
let playing = !quiet;
const setPlay = (on: boolean) => { playing = on; on ? demo.play() : demo.pause(); dplay.textContent = on ? "❚❚ pause" : "▶ play"; };
dplay.onclick = () => setPlay(!playing);
$("#dnext")!.onclick = () => { setPlay(false); demo.next(); };
$("#dprev")!.onclick = () => { setPlay(false); demo.prev(); };
// the fake is clickable too, like the real thing
$("#thumb")!.addEventListener("click", () => { setPlay(false); demo.go(4); });
zoom.addEventListener("click", () => { setPlay(false); demo.go(demo.current === 8 ? 6 : 5); });
cells.forEach((c, k) => c.addEventListener("click", () => { setPlay(false); pick = k; demo.go(8); }));

// first paint is the share-card frame: the thumbnail already inline
show(location.hash.includes("demo=") ? demo.current : 2);
if (!location.hash.includes("demo=")) demo.go(2, false);
if (playing) setTimeout(() => demo.play(), 1200);
