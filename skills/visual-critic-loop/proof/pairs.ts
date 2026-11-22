#!/usr/bin/env node
// Builds the agreement set: 30 pairs of one viz page before and after a commit that says it fixed
// something visual, plus 10 pairs of two different pages. Old versions come from git archive and
// render from a standalone export, so no working copy is touched.
// Usage: node proof/pairs.ts <out-dir> [truth.json]
// Cross pairs the fix commits can't fill come from the clean screens in truth.json (from plant.ts).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HIDE_WIDGET, openBrowser, vizRequire } from "../shoot.ts";

const HOME = process.env.HOME!;
const { PNG } = vizRequire("pngjs");
const VIZ = HOME + "/.claude/skills/viz/viz.ts";
const GREP = "overflow|overlap|contrast|clip|misalign|alignment|legib|readab|cramped|cut off|unreadable|layout";
const REPOS: [string, RegExp][] = [
  [HOME + "/Desktop/Desktop/Code/ai-setup", /^viz-pages\/([^/]+)\//],
  [HOME + "/Desktop/Desktop/Code/explorables", /^viz-pages\/([^/]+)\//],
  [HOME + "/.agents/state/viz", /^([^/._][^/]*)\//],
];
const SAME = 30, CROSS = 10;

const out = process.argv[2];
if (!out) {
  console.error("usage: node proof/pairs.ts <out-dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const browser = await openBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

// Extracts the viz dir at one revision, exports it standalone and takes a full-page screenshot.
// Null if any step fails.
async function shoot(repo: string, rev: string, dir: string, key: string): Promise<string | null> {
  const src = join(out, "src", key);
  const png = join(out, "full", `${key}.png`);
  if (existsSync(png)) return png;
  mkdirSync(src, { recursive: true });
  mkdirSync(join(out, "full"), { recursive: true });
  const tar = spawnSync("sh", ["-c", 'git -C "$1" archive "$2" "$3" | tar -x -C "$4"', "sh", repo, rev, dir, src]);
  const index = join(src, dir, "index.html");
  if (tar.status !== 0 || !existsSync(index)) return null;
  // export skips local-posture pages; this scratch copy is only screenshotted, never published.
  writeFileSync(index, readFileSync(index, "utf8").replace(/(name="viz:posture" content=")local/, "$1public"));
  const ex = spawnSync(process.execPath, [VIZ, "export", join(src, dir), "--out", join(src, "out"), "--no-og", "--json"]);
  const html = join(src, "out", dir.split("/").filter(Boolean).at(-1)!, "index.html");
  if (ex.status !== 0 || !existsSync(html)) return null;
  try {
    await page.goto("file://" + html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.addStyleTag({ content: HIDE_WIDGET });
    await new Promise((r) => setTimeout(r, 1500));
    // An export that prints its own source as text is a harness failure, not a bad page.
    const raw = await page.evaluate(() => /<\/?(!doctype|script|html|head|meta|link|style|div|span|svg)\b|^\s*import |:root\s*\{|var\(--/im.test(document.body.innerText.slice(0, 3000)));
    if (raw) return null;
    await page.screenshot({ path: png, fullPage: true });
    return png;
  } catch {
    return null;
  }
}

// Crops both full-page shots to one 1280x800 screen starting a little above their first differing row,
// so the pair shows what the fix changed. Null when the pages are pixel-identical.
export function cropAtDiff(aPath: string, bPath: string, aOut: string, bOut: string): number | null {
  const a = PNG.sync.read(readFileSync(aPath)), b = PNG.sync.read(readFileSync(bPath));
  const rowBytes = a.width * 4, rows = Math.min(a.height, b.height);
  let y = -1;
  if (a.width === b.width) {
    for (let r = 0; r < rows && y < 0; r++) if (!a.data.subarray(r * rowBytes, (r + 1) * rowBytes).equals(b.data.subarray(r * rowBytes, (r + 1) * rowBytes))) y = r;
    if (y < 0 && a.height === b.height) return null;
    if (y < 0) y = rows;
  } else y = 0;
  const top = Math.max(0, y - 150);
  for (const [img, path] of [[a, aOut], [b, bOut]] as const) {
    const crop = new PNG({ width: 1280, height: 800 });
    crop.data.fill(0);
    PNG.bitblt(img, crop, 0, Math.min(top, Math.max(0, img.height - 800)), Math.min(1280, img.width), Math.min(800, img.height), 0, 0);
    writeFileSync(path, PNG.sync.write(crop));
  }
  return top;
}

type Cand = { repo: string; rev: string; dir: string; slug: string; subject: string };
const cands: Cand[] = [];
for (const [repo, re] of REPOS) {
  const log = spawnSync("git", ["-C", repo, "log", "--no-merges", "-i", "-E", `--grep=${GREP}`, "--format=%H%x09%s", "--", "*.html", "*.css"], { encoding: "utf8", maxBuffer: 1 << 30 }).stdout ?? "";
  for (const line of log.trim().split("\n").filter(Boolean)) {
    const [rev, subject] = line.split("\t");
    const files = execFileSync("git", ["-C", repo, "diff-tree", "--no-commit-id", "--name-only", "-r", rev], { encoding: "utf8" }).trim().split("\n");
    const dirs = new Set(files.map((f) => f.match(re)?.[0]).filter(Boolean) as string[]);
    if (dirs.size !== 1) continue;
    const dir = [...dirs][0].replace(/\/$/, "");
    cands.push({ repo, rev, dir, slug: dir.split("/").at(-1)!, subject });
  }
}
console.log(`${cands.length} single-page fix commits`);

const pairs: { id: string; kind: "same" | "cross"; a: string; b: string; note: string }[] = [];
const used = new Set<string>();
const spare: { slug: string; shot: string }[] = [];
for (const c of cands) {
  if (used.has(c.slug) || /deck/.test(c.slug)) continue; // decks are slides, not one screen
  const key = `${c.slug}-${c.rev.slice(0, 7)}`;
  const before = await shoot(c.repo, `${c.rev}^`, c.dir, `${key}-before`);
  const after = before && (await shoot(c.repo, c.rev, c.dir, `${key}-after`));
  if (!before || !after) {
    console.log(`skip ${key}: did not render`);
    continue;
  }
  mkdirSync(join(out, "shots"), { recursive: true });
  const [a, b] = [join(out, "shots", `${key}-before.png`), join(out, "shots", `${key}-after.png`)];
  const top = cropAtDiff(before, after, a, b);
  if (top === null) {
    console.log(`skip ${key}: no visible change`);
    continue;
  }
  used.add(c.slug);
  if (pairs.length < SAME) {
    pairs.push({ id: key, kind: "same", a, b, note: `${c.rev.slice(0, 7)} at y=${top}: ${c.subject}` });
    console.log(`same ${pairs.length}: ${key}`);
  } else {
    spare.push({ slug: c.slug, shot: b });
    if (spare.length >= CROSS * 2) break;
  }
}
for (let i = 0; i + 1 < spare.length && pairs.filter((p) => p.kind === "cross").length < CROSS; i += 2) {
  pairs.push({ id: `cross-${spare[i].slug}-vs-${spare[i + 1].slug}`, kind: "cross", a: spare[i].shot, b: spare[i + 1].shot, note: "two different pages" });
}
const truth = process.argv[3] && JSON.parse(readFileSync(process.argv[3], "utf8"));
const cleans: string[] = truth ? truth.pages.map((p: string) => truth.faults.find((f: any) => f.page === p).clean) : [];
for (let i = 0; i + 1 < cleans.length && pairs.filter((p) => p.kind === "cross").length < CROSS; i += 2) {
  pairs.push({ id: `cross-${truth.pages[i]}-vs-${truth.pages[i + 1]}`, kind: "cross", a: cleans[i], b: cleans[i + 1], note: "two different pages" });
}
await browser.close();
writeFileSync(join(out, "pairs.json"), JSON.stringify({ pairs }, null, 1));
console.log(`${pairs.filter((p) => p.kind === "same").length} same-page, ${pairs.filter((p) => p.kind === "cross").length} cross-page -> ${join(out, "pairs.json")}`);
