#!/usr/bin/env node
// Plants known faults into real pages and records where each one is (the ground truth).
// Usage: node proof/plant.ts <candidates.json> <out-dir> [pages=10]
// candidates.json: [{ id }] where id is the viz id (its path under $HOME), served by the viz server.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HIDE_WIDGET, openBrowser } from "../shoot.ts";
const W = 1280, H = 800;
export const KINDS = ["overlap", "contrast", "misalign", "broken", "clipped"] as const;
export type Box = [number, number, number, number];
export type Fault = { id: string; page: string; kind: (typeof KINDS)[number]; shot: string; clean: string; box: Box };

const [candFile, outDir, nArg] = process.argv.slice(2);
if (!candFile || !outDir) {
  console.error("usage: node proof/plant.ts <candidates.json> <out-dir> [pages=10]");
  process.exit(2);
}
const want = Number(nArg ?? 10);
const cands: { id: string }[] = JSON.parse(readFileSync(candFile, "utf8"));

// Runs inside the page: finds a target for one fault kind, plants it, and returns the fault's box.
function plantInPage(kind: string, seed: number): [number, number, number, number] | null {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const VW = innerWidth, VH = innerHeight;
  const inView = (r: DOMRect) => r.top >= 8 && r.left >= 8 && r.bottom <= VH - 8 && r.right <= VW - 8;
  const fixed = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === "fixed" || p === "sticky") return true;
    }
    return false;
  };
  const ownText = (el: Element) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(" ").trim();
  const texts = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return ownText(el).length >= 12 && r.width >= 60 && r.width <= 900 && r.height >= 10 && r.height <= 60 &&
      inView(r) && cs.visibility === "visible" && Number(cs.opacity) > 0.5 && !fixed(el) && !el.closest("svg");
  });
  const blocks = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 200 && r.width <= 900 && r.height >= 80 && r.height <= 450 && inView(r) && !fixed(el) &&
      el.children.length >= 2;
  });
  const union = (a: DOMRect, b: DOMRect): [number, number, number, number] => {
    const x = Math.max(0, Math.min(a.left, b.left)), y = Math.max(0, Math.min(a.top, b.top));
    const r = Math.min(VW, Math.max(a.right, b.right)), bt = Math.min(VH, Math.max(a.bottom, b.bottom));
    return [x, y, r - x, bt - y];
  };
  const bg = (el: Element): string => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return "rgb(255, 255, 255)";
  };
  if (kind === "broken") {
    const b = pick(blocks);
    if (!b) return null;
    const before = b.getBoundingClientRect();
    b.style.transform = "translate(28%, 35%) rotate(-2deg)";
    return union(before, b.getBoundingClientRect());
  }
  const t = pick(texts);
  if (!t) return null;
  const before = t.getBoundingClientRect();
  if (kind === "overlap") {
    // Drop the element onto its nearest neighbour below, so two runs of text print over each other.
    const below = texts.filter((o) => o !== t && !o.contains(t) && !t.contains(o)).map((o) => [o, o.getBoundingClientRect()] as const)
      .filter(([, r]) => r.top > before.top + 4 && r.left < before.right && r.right > before.left)
      .sort((a, b) => a[1].top - b[1].top)[0];
    if (!below) return null;
    t.style.position = "relative";
    t.style.top = `${below[1].top - before.top + below[1].height * 0.25}px`;
    t.style.zIndex = "5";
    return union(t.getBoundingClientRect(), below[1]);
  }
  if (kind === "contrast") {
    const m = bg(t).match(/\d+(\.\d+)?/g)!.map(Number);
    const lum = (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000;
    const d = lum > 128 ? -22 : 22; // a shade off the background: present, but barely readable
    t.style.color = `rgb(${m[0] + d}, ${m[1] + d}, ${m[2] + d})`;
    return union(before, before);
  }
  if (kind === "misalign") {
    t.style.position = "relative";
    t.style.left = "26px";
    t.style.top = "4px";
    return union(before, t.getBoundingClientRect());
  }
  if (kind === "clipped") {
    t.style.display = "inline-block";
    t.style.whiteSpace = "nowrap";
    t.style.overflow = "hidden";
    t.style.width = `${Math.round(before.width * 0.45)}px`;
    t.style.verticalAlign = "top";
    return union(before, t.getBoundingClientRect());
  }
  return null;
}

const browser = await openBrowser();
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
const load = async (url: string) => {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await page.addStyleTag({ content: HIDE_WIDGET });
  await new Promise((r) => setTimeout(r, 1500));
};

const faults: Fault[] = [];
const pages: string[] = [];
mkdirSync(outDir, { recursive: true });
for (const [ci, c] of cands.entries()) {
  if (pages.length >= want) break;
  const url = `http://127.0.0.1:5180/${c.id}/`;
  const slug = c.id.split("/").at(-1)!;
  const dir = join(outDir, slug);
  mkdirSync(dir, { recursive: true });
  try {
    await load(url);
    const clean = join(dir, "clean.png");
    const cleanBuf = Buffer.from(await page.screenshot({ path: clean }));
    const mine: Fault[] = [];
    for (const [ki, kind] of KINDS.entries()) {
      let box: Box | null = null;
      for (let attempt = 0; attempt < 4 && !box; attempt++) {
        await load(url);
        box = (await page.evaluate(plantInPage, kind, ci * 1000 + ki * 10 + attempt)) as Box | null;
        await new Promise((r) => setTimeout(r, 300));
        const shot = join(dir, `${kind}.png`);
        const buf = Buffer.from(await page.screenshot({ path: shot }));
        if (box && buf.equals(cleanBuf)) box = null; // planted nothing visible: try another target
        if (box) mine.push({ id: `${slug}/${kind}`, page: slug, kind, shot, clean, box: box.map(Math.round) as Box });
      }
    }
    if (mine.length < KINDS.length) {
      console.log(`skip ${slug}: planted ${mine.length}/${KINDS.length}`);
      continue;
    }
    faults.push(...mine);
    pages.push(slug);
    console.log(`ok ${slug}`);
  } catch (e) {
    console.log(`skip ${slug}: ${(e as Error).message.slice(0, 120)}`);
  }
}
await browser.close();
writeFileSync(join(outDir, "truth.json"), JSON.stringify({ viewport: [W, H], pages, faults }, null, 1));
console.log(`${pages.length} pages, ${faults.length} faults -> ${join(outDir, "truth.json")}`);
