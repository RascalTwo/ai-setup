// Exhibit 6: "How big is each inline image?" A to-scale terminal pane and one screenshot at any size.
// The screenshot is invented (an "invoice dashboard" drawn in SVG), never a real capture. The
// readout converts the size into the real height of its body text on a 1500 px wide pane, because
// "readable" is a pixel height, not an opinion.
import { clamp, optLabel, pressOne, q } from "./util.js";

const PANE_W = 1500; // invented pane, px
const PANE_H = 907; // 55 rows
const COLS = 184;
const ROW_PX = PANE_H / 55;
const NATIVE_W = 1400;
const NATIVE_H = 868;
const BODY_PX = 15; // body text height inside the invented screenshot
const SIZES = [
  { id: "A", name: "thumbnail", cols: 40 },
  { id: "B", name: "medium", cols: 72 },
  { id: "C", name: "large", cols: 150 },
] as const;

/** The invented screenshot: a small invoicing dashboard, 1400×868, text at 15 px and up. */
function screenshot(): string {
  const rows = [
    ["#2041", "Brightside Bakery", "14 Nov", "$1,284.00", "Paid"],
    ["#2042", "Harbor Lights Cafe", "16 Nov", "$642.50", "Open"],
    ["#2043", "Juniper & Finch", "21 Nov", "$2,910.00", "Open"],
    ["#2044", "Copperline Bikes", "22 Nov", "$388.25", "Overdue"],
    ["#2045", "Moss Street Books", "28 Nov", "$1,075.00", "Open"],
    ["#2046", "Tidewater Studio", "30 Nov", "$519.00", "Paid"],
    ["#2047", "Larkspur Florist", "02 Dec", "$744.80", "Open"],
  ];
  const col = [60, 190, 650, 800, 1010];
  const kpis = [
    ["Outstanding", "$6,879"],
    ["Paid this month", "$1,803"],
    ["Overdue", "1 invoice"],
  ];
  return `<svg viewBox="0 0 ${NATIVE_W} ${NATIVE_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="An invented invoicing dashboard">
    <rect width="${NATIVE_W}" height="${NATIVE_H}" fill="#f6f7f9"/>
    <rect width="${NATIVE_W}" height="64" fill="#1f2a44"/>
    <text x="32" y="42" font-size="26" font-weight="700" fill="#fff" font-family="sans-serif">Ledgerly</text>
    <text x="1000" y="40" font-size="${BODY_PX + 3}" fill="#c8d0e0" font-family="sans-serif">Invoices   Customers   Reports   Settings</text>
    <rect y="64" width="250" height="${NATIVE_H - 64}" fill="#e9ecf2"/>
    ${["Overview", "Invoices", "Customers", "Reports"].map((t, i) => `<text x="32" y="${120 + i * 48}" font-size="${BODY_PX + 3}" fill="${i === 1 ? "#1f2a44" : "#5b6477"}" font-weight="${i === 1 ? 700 : 400}" font-family="sans-serif">${t}</text>`).join("")}
    ${kpis.map(([k, v], i) => `<rect x="${290 + i * 365}" y="96" width="335" height="120" rx="10" fill="#fff" stroke="#d9dde6"/><text x="${314 + i * 365}" y="138" font-size="${BODY_PX + 1}" fill="#5b6477" font-family="sans-serif">${k}</text><text x="${314 + i * 365}" y="192" font-size="44" font-weight="700" fill="#1f2a44" font-family="sans-serif">${v}</text>`).join("")}
    <rect x="290" y="250" width="1085" height="${NATIVE_H - 290}" rx="10" fill="#fff" stroke="#d9dde6"/>
    ${["No.", "Customer", "Due", "Amount", "Status"].map((t, i) => `<text x="${(col[i] ?? 0) + 270}" y="296" font-size="${BODY_PX}" font-weight="700" fill="#5b6477" font-family="sans-serif">${t}</text>`).join("")}
    ${rows
      .map(
        (r, k) =>
          `<line x1="310" x2="1355" y1="${316 + k * 74}" y2="${316 + k * 74}" stroke="#eceff4"/>` +
          r
            .map(
              (c, i) =>
                `<text x="${(col[i] ?? 0) + 270}" y="${358 + k * 74}" font-size="${BODY_PX + 1}" fill="${c === "Overdue" ? "#c0392b" : "#1f2a44"}" font-family="sans-serif">${c}</text>`,
            )
            .join(""),
      )
      .join("")}
  </svg>`;
}

export function initShot(): void {
  const root = q<HTMLElement>(document, "#ex6-stage");
  root.innerHTML = `
    <div class="sliderrow">
      <span class="row" id="sizes" style="margin:0">${SIZES.map((s) => `<button class="btn" data-cols="${s.cols}" aria-pressed="false" data-viz-id="size-${s.id}" data-label="size ${s.id}: ${s.name}, ${s.cols} columns">${optLabel(s.id, s.name)}</button>`).join("")}</span>
      <input type="range" id="cols" min="20" max="170" step="1" value="40" aria-label="image width in terminal columns" data-viz-id="cols-slider" data-label="image width in columns" />
      <output id="colsv"></output>
    </div>
    <div class="two">
      <div>
        <div class="sub-h">ONE SCREEN OF THE TERMINAL PANE · to scale · ${COLS} columns × 55 rows</div>
        <div class="pane" id="pane" data-viz-id="pane" data-label="terminal pane to scale"></div>
      </div>
      <div>
        <div class="sub-h">BODY TEXT OF THAT SCREENSHOT, AT ITS REAL SIZE ON THE PANE</div>
        <div class="out" id="shot-read"></div>
        <div class="sample" id="sample" data-viz-id="sample" data-label="sample line at the real text size">Brightside Bakery   14 Nov   $1,284.00   Open</div>
        <p class="out m" style="margin-top:10px">The pane is invented (${PANE_W} px wide, a 1400×868 screenshot). Under 9 px you are not reading, you are guessing.</p>
      </div>
    </div>`;
  const pane = q<HTMLElement>(root, "#pane");
  const slider = q<HTMLInputElement>(root, "#cols");
  const colsv = q<HTMLElement>(root, "#colsv");
  const read = q<HTMLElement>(root, "#shot-read");
  const sample = q<HTMLElement>(root, "#sample");
  const btns = [...root.querySelectorAll<HTMLElement>("#sizes .btn")];

  function render(): void {
    const cols = Number(slider.value);
    const W = pane.clientWidth || 440;
    const f = W / PANE_W;
    pane.style.height = `${PANE_H * f}px`;
    const imgW = (cols / COLS) * PANE_W;
    const imgH = (imgW * NATIVE_H) / NATIVE_W;
    const rows = Math.round(imgH / ROW_PX);
    const bar = (top: number, w: number, strong = false): string =>
      `<div class="tl" style="top:${top * f}px;width:${w * f}px;height:${Math.max(2, 10 * f)}px;background:${strong ? "#3b4350" : "#232a33"};border-radius:2px"></div>`;
    const y0 = 3.5 * ROW_PX;
    pane.innerHTML =
      bar(1 * ROW_PX, 280, true) +
      bar(2 * ROW_PX, 520) +
      `<div class="img" style="top:${y0 * f}px;left:${10 * f}px;width:${imgW * f}px;height:${imgH * f}px" data-viz-id="img" data-label="the screenshot at ${cols} columns">${screenshot()}</div>` +
      bar(y0 + imgH + 1 * ROW_PX, 640) +
      bar(y0 + imgH + 2.5 * ROW_PX, 380);
    const px = BODY_PX * (imgW / NATIVE_W);
    const verdict =
      px < 9 ? ["no", "unreadable"] : px < 11.5 ? ["meh", "a squint"] : ["ok", "readable"];
    colsv.textContent = `${cols} cols × ${rows} rows`;
    read.innerHTML = `<b>${px.toFixed(1)} px</b> text <span class="verdict ${verdict[0]}">${verdict[1]}</span><br><span style="color:var(--muted)">${Math.round((cols / COLS) * 100)}% of the pane width, ${Math.min(100, Math.round((rows / 55) * 100))}% of its height${rows > 50 ? " (it takes over the screen)" : ""}.</span>`;
    sample.style.fontSize = `${clamp(px, 1, 22)}px`;
    sample.style.minHeight = "28px";
    pressOne(btns, btns.find((b) => Number(b.dataset["cols"]) === cols) ?? null);
  }
  slider.addEventListener("input", render);
  root.querySelector("#sizes")?.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-cols]") : null;
    if (!b) return;
    slider.value = b.dataset["cols"] ?? "40";
    render();
  });
  new ResizeObserver(render).observe(pane);
  render();
}
