// lib.ts — cards an agent puts in front of the human, and their answers.
//
// One viz (the central library's `genui`, forked from page/ on first use) holds every card. A card
// is a line of its `_log/cards`, an answer a line of `_log/answers`: viz's page data route, so the
// page POSTs the answer and we fs.watch the log instead of polling it. Drawing lives in
// page/panel.ts; this side only writes specs, opens the floating panel, and waits.
//
// viz is reached through its CLI only (`bun <viz>/viz.ts`), never its internals. Each call costs
// ~0.8s of startup, so where the page is and which URL serves it are cached; a show that finds the
// cache good makes no viz call at all.

import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Subprocess } from "bun";
import { displayOnly, partsOf, summarize } from "./page/panel.ts";
import type { Answer, Card, FormSpec, PanelSpec } from "./page/panel.ts";

export type { Answer, Card, PanelSpec };
export { displayOnly, partsOf, summarize };

const HERE = import.meta.dir;
/** Each component's required fields, so a broken spec is refused before a human sees it. */
const NEEDS: Record<string, string[]> = {
  choice: ["columns", "rows"],
  confirm: [],
  diff: ["patch"],
  form: ["schema"],
  notice: [],
  table: ["columns", "rows"],
  code: ["text"],
  html: [],
};
/** viz's per-page data folder (its page data route): where _log/<name> lands. */
const DATA = ".viz-data";
/** Copied into the page on every show, so an improved component redraws every old card too. */
const COMPONENTS = ["panel.ts", "panel.css"];

/** How to run viz: GENUI_VIZ (e.g. "bun /path/viz.ts"), else the viz skill beside this one. */
const VIZ = process.env["GENUI_VIZ"]?.split(" ") ?? [
  "bun",
  path.resolve(HERE, "../viz/viz.ts"),
];

/** The floating panel (helper/build), when it's built. Else: a browser tab. */
export const HELPER =
  process.env["GENUI_HELPER"] ?? path.join(HERE, "helper/genui-panel");

type Where = { dir: string; url: string };
const CACHE =
  process.env["GENUI_CACHE"] ?? path.join(homedir(), ".agents/state/genui-viz.json");
// One entry per viz library + port, so a dev server (VIZ_PAGES_DIR, VIZ_PORT) never reuses the live one's.
const cacheKey = `${process.env["VIZ_PAGES_DIR"] ?? ""}|${process.env["VIZ_PORT"] ?? ""}`;

let where: Where | undefined;
const logFile = (name: string): string => {
  if (!where) throw new Error("ensurePage() first");
  return path.join(where.dir, DATA, `${name}.jsonl`);
};

/** Reject what page/panel.ts can't draw before a human ever sees a broken card. */
export function parseSpec(text: string): PanelSpec {
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch {
    throw new Error("spec is not JSON");
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    throw new Error("spec must be a JSON object");
  const o = spec as Record<string, unknown>;
  if (typeof o["title"] !== "string" || o["title"] === "") throw new Error("spec.title is required");
  if ("components" in o) {
    if (!Array.isArray(o["components"]) || o["components"].length === 0)
      throw new Error("spec.components must be a non-empty array of components");
    o["components"].forEach((c, i) => checkPart(c, `spec.components[${i}]`));
  } else checkPart(o, "spec");
  return spec as PanelSpec; // beyond its required fields, a component copes with what it gets
}

function checkPart(part: unknown, at: string): void {
  if (!part || typeof part !== "object") throw new Error(`${at} must be an object`);
  const o = part as Record<string, unknown>;
  const needs = typeof o["type"] === "string" ? NEEDS[o["type"]] : undefined;
  if (!needs)
    throw new Error(`${at}.type must be one of: ${Object.keys(NEEDS).join(", ")} (got ${JSON.stringify(o["type"])})`);
  for (const f of needs)
    if (!(f in o) || o[f] === "") throw new Error(`${at}.${f} is required for a ${String(o["type"])} component`);
  if (o["type"] === "form" && typeof (o as FormSpec).schema?.properties !== "object")
    throw new Error(`${at}.schema.properties is required: an MCP elicitation requestedSchema`);
}

function readLog<T>(name: string): T[] {
  const f = logFile(name);
  if (!existsSync(f)) return [];
  const out: T[] = [];
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      /* a torn line shouldn't hide the rest */
    }
  }
  return out;
}

export const cards = (): Card[] => readLog<Card>("cards");
export const answerFor = (id: string): Answer | undefined =>
  readLog<Answer>("answers").findLast((a) => a.card === id);

export function cardUrl(id: string): string {
  if (!where) throw new Error("ensurePage() first");
  return `${where.url}?card=${encodeURIComponent(id)}`;
}

function viz(...args: string[]): unknown {
  const p = Bun.spawnSync([...VIZ, ...args], { stderr: "pipe" });
  if (p.exitCode !== 0)
    throw new Error(`viz ${args.join(" ")} failed: ${p.stderr.toString().trim() || p.exitCode}`);
  return JSON.parse(p.stdout.toString());
}

async function serving(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(400), redirect: "manual" })).status < 500;
  } catch {
    return false;
  }
}

/** Where the genui page is and its URL: the cache when it still holds, else ask viz (making the page
 *  on first use). Also starts the server, and refreshes the page's components. */
export async function ensurePage(): Promise<void> {
  const cached = readCache()[cacheKey];
  if (cached && existsSync(cached.dir) && (await serving(cached.url))) where = cached;
  else {
    const server = viz("server", "start", "--json") as { url: string };
    const found = (viz("ls", "--json", "--central", "--all") as { dir: string; id: string }[]).find(
      (v) => path.basename(v.dir) === "genui",
    );
    const dir = found?.dir ?? (viz("create", "genui", "--global", "--from", path.join(HERE, "page"), "--no-print", "--json") as { dir: string }).dir;
    // A viz is served at <server>/<its path under $HOME>/.
    where = { dir, url: `${server.url}/${path.relative(homedir(), dir)}/` };
    mkdirSync(path.dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ ...readCache(), [cacheKey]: where }, null, 2));
  }
  for (const f of COMPONENTS) {
    const src = readFileSync(path.join(HERE, "page", f), "utf8");
    const dst = path.join(where.dir, f);
    if (!existsSync(dst) || readFileSync(dst, "utf8") !== src) writeFileSync(dst, src);
  }
}

function readCache(): Record<string, Where> {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, Where>;
  } catch {
    return {};
  }
}

/** Point at a page directly (tests): no viz, no server. */
export function usePage(dir: string, url = "http://localhost/genui/"): void {
  where = { dir, url };
}

export async function addCard(spec: PanelSpec, pane?: string): Promise<Card> {
  const card: Card = {
    at: new Date().toISOString(),
    id: `c-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
    ...(pane ? { pane } : {}),
    spec,
  };
  mkdirSync(path.dirname(logFile("cards")), { recursive: true });
  await appendFile(logFile("cards"), JSON.stringify(card) + "\n");
  return card;
}

/** Show a card: in the floating panel glued to its herdr pane when the helper is built, else a tab.
 *  Returns the panel's process (a browser tab has none we could close), so a timed-out wait can
 *  close it rather than leave it floating with nobody listening. */
export function openCard(card: Card): Subprocess | null {
  const url = cardUrl(card.id);
  if (process.platform === "darwin" && existsSync(HELPER)) {
    const p = Bun.spawn([HELPER, url, "760", ...(card.pane ? [card.pane] : [])], {
      stdout: "ignore",
      stderr: "ignore",
    });
    p.unref();
    return p;
  }
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url]).unref();
  return null;
}

/** Resolve with the card's answer the moment the page writes it; undefined after timeoutMs. */
export async function waitAnswer(id: string, timeoutMs: number): Promise<Answer | undefined> {
  const now = answerFor(id);
  if (now) return now;
  const dir = path.dirname(logFile("answers"));
  mkdirSync(dir, { recursive: true });
  const answer = await new Promise<Answer | undefined>((resolve) => {
    // Watch the folder, not the file: the first answer creates answers.jsonl.
    const w = watch(dir, () => {
      const a = answerFor(id);
      if (a) done(a);
    });
    const timer = setTimeout(() => done(), timeoutMs);
    function done(a?: Answer): void {
      clearTimeout(timer);
      w.close();
      resolve(a);
    }
  });
  return answer;
}
