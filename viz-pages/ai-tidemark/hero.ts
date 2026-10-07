interface Sample {
  t: number;
  w: number;
  v: number;
  r: number;
  q: "exact" | "lagged";
}
interface Pt {
  t: number;
  v: number;
}
// Object.groupBy is ES2024; the checker's lib stops short of it, the browsers that render this don't.
declare global {
  interface ObjectConstructor {
    groupBy<T, K extends PropertyKey>(
      items: Iterable<T>,
      key: (item: T, i: number) => K,
    ): Partial<Record<K, T[]>>;
  }
}

const WEEK = 168 * 3600e3,
  FIVE = 5 * 3600e3;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- demo.json is our own generated fixture (fixtures/generate.ts); zod here would ship a 117 KB parser to a poster
const D = await ((await fetch("fixtures/demo.json")).json() as Promise<{
  now: number;
  sources: { id: string; samples: Sample[] }[];
}>);
const src = (id: string) => D.sources.find((s) => s.id === id);
const claude = src("claude")!.samples.filter((s) => s.q === "exact");
// The most recent week that has closed.
const r = Math.max(...claude.filter((s) => s.w === 10080 && s.r <= D.now).map((s) => s.r)),
  start = r - WEEK;
const weekly = claude.filter((s) => s.w === 10080 && s.r === r).toSorted((a, b) => a.t - b.t);
const fives = claude.filter((s) => s.w === 300 && s.r > start && s.r <= r);
const cx = (src("codex")?.samples ?? [])
  .filter((s) => s.w === 10080 && s.t >= start && s.t <= r)
  .toSorted((a, b) => a.t - b.t);
const peak = Math.max(...weekly.map((s) => s.v));

const L = 34,
  R = 380,
  T = 12,
  B = 176;
const x = (t: number) => L + ((t - start) / WEEK) * (R - L),
  y = (v: number) => B - (v / 100) * (B - T);
const line = (pts: Pt[], f: (p: Pt) => number) =>
  pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(f(p)).toFixed(1)}`).join("");
let s = "";
for (const v of [0, 50, 100])
  s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${v}%</text>`;
// 5-hour windows, one filled shape each
for (const group of Object.values(Object.groupBy(fives, (f) => f.r))) {
  if (!group) continue;
  const w = group.toSorted((a, b) => a.t - b.t);
  const pts = [{ t: w[0]!.r - FIVE, v: 0 }, ...w, { t: w[0]!.r, v: w.at(-1)!.v }];
  s += `<path d="${line(pts, (p) => p.v)}L${x(w[0]!.r)},${y(0)}Z" fill="color-mix(in srgb,var(--src-claude) 18%,transparent)" stroke="var(--src-claude)" stroke-opacity=".5"/>`;
}
// even pace, the tidemark, and the gap nobody used
s += `<line x1="${x(start)}" y1="${y(0)}" x2="${x(r)}" y2="${y(100)}" stroke="var(--muted)" stroke-dasharray="5 4"/>`;
s += `<line x1="${L}" x2="${R}" y1="${y(peak)}" y2="${y(peak)}" stroke="var(--src-claude)" stroke-dasharray="2 3" stroke-opacity=".8"/>`;
s += `<text x="${L + 4}" y="${y(peak) - 5}" font-size="11" fill="var(--src-claude)">tidemark ${peak}%</text>`;
s += `<rect x="${R - 26}" y="${y(100)}" width="22" height="${y(peak) - y(100)}" rx="3" fill="color-mix(in srgb,var(--warn) 22%,transparent)" stroke="var(--warn)"/>`;
s += `<text x="${R - 32}" y="${y(100) + 12}" text-anchor="end" font-size="12" fill="var(--warn)">${100 - peak}% expired ▸</text>`;
if (cx.length > 0)
  s += `<path d="${line([{ t: start, v: 0 }, ...cx], (p) => p.v)}" stroke="var(--src-codex)" stroke-width="2" fill="none"/><text x="${x(cx.at(-1)!.t) - 4}" y="${y(cx.at(-1)!.v) + 15}" text-anchor="end" font-size="11" fill="var(--src-codex)">Codex</text>`;
s += `<path d="${line(weekly, (p) => p.v)}" stroke="var(--src-claude)" stroke-width="2.5" fill="none"/>`;
s += `<text x="${L}" y="${B + 16}" font-size="11" fill="var(--faint)">window opens</text><text x="${R}" y="${B + 16}" text-anchor="end" font-size="11" fill="var(--faint)">reset</text>`;
document.querySelector("#fig")!.innerHTML = s;
document.querySelector("#used")!.textContent = `${peak}%`;
document.querySelector("#gone")!.textContent = `${100 - peak}%`;
