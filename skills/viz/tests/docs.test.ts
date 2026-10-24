// tests/docs.test.ts — the agent-facing docs, checked against the code they describe.
//
// Docs can't go red on their own: a flag that was renamed, a script that was deleted, or a
// reference file nothing links to just misleads quietly until an agent acts on it. Each
// check here is a drift the docs have actually suffered — `--triaged` outliving its rename,
// `vendor-rm` outliving `vendor rm`, and `bun build.ts` outliving `viz publish`.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { buildProgram } from "../program.ts";

const SKILL = path.dirname(import.meta.dir);
const read = (rel: string) => readFileSync(path.join(SKILL, rel), "utf8");
const REFERENCE = readdirSync(path.join(SKILL, "reference"))
  .filter((f) => f.endsWith(".md"))
  .toSorted()
  .map((f) => `reference/${f}`);
const DOCS = ["SKILL.md", ...REFERENCE, "kit/README.md", "kit/EXCHANGE.md"];

/** Every line of every doc, for checks that report file:line. */
const lines = DOCS.flatMap((file) =>
  read(file)
    .split("\n")
    .map((text, i) => ({ file, line: i + 1, text })),
);
const where = (l: { file: string; line: number }) => `${l.file}:${l.line}`;

// ---- 1. every `viz <verb> … --flag` resolves against the real command tree ----------------

/** `viz` mentions: inline code spans, and lines of fenced blocks that start with `viz `. */
function vizMentions(): { at: string; words: string[] }[] {
  const out: { at: string; words: string[] }[] = [];
  let fenced = false;
  for (const l of lines) {
    if (l.text.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    const spans = fenced
      ? [l.text.replace(/#.*$/u, "").trim()]
      : [...l.text.matchAll(/`([^`]+)`/gu)].map((m) => m[1]!);
    for (const s of spans)
      if (/^viz(\s|$)/u.test(s)) out.push({ at: where(l), words: s.split(/\s+/u).slice(1) });
  }
  return out;
}

/** Resolve `create`, `vendor rm`, `server start` … to its Command, or say what failed. */
function resolve(program: Command, words: string[]): { cmd: Command } | { error: string } {
  let cmd = program;
  for (const w of words) {
    if (w.startsWith("-") || !/^[a-z][a-z-]*$/u.test(w)) break; // flags, <placeholders>, paths
    const sub = cmd.commands.find((c) => c.name() === w);
    if (!sub) {
      // A group needs a subcommand; a leaf's next bare word is a positional argument.
      if (cmd === program || cmd.commands.length > 0)
        return { error: `no verb "${[...commandPath(cmd), w].join(" ")}"` };
      break;
    }
    cmd = sub;
  }
  return { cmd };
}
const commandPath = (c: Command): string[] =>
  c.parent ? [...commandPath(c.parent), c.name()] : [];

describe("docs name only verbs and flags the CLI has", () => {
  const program = buildProgram();
  const mentions = vizMentions();

  test("the docs mention the CLI at all (guards the extractor)", () => {
    expect(mentions.length).toBeGreaterThan(20);
  });

  test("every `viz <verb> [sub] --flag` resolves", () => {
    const problems: string[] = [];
    for (const { at, words } of mentions) {
      if (words[0]?.startsWith("<")) continue; // `viz <verb> --help` — the placeholder form
      const r = resolve(program, words);
      if ("error" in r) {
        problems.push(`${at}: ${r.error}`);
        continue;
      }
      const longs = new Set(r.cmd.options.map((o) => o.long));
      for (const flag of words.join(" ").match(/--[a-z][a-z-]*/gu) ?? []) {
        if (flag === "--help" || flag === "--examples" || longs.has(flag)) continue; // --help/--examples: every command answers both
        problems.push(`${at}: \`viz ${commandPath(r.cmd).join(" ")}\` has no ${flag}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// ---- 2. banned names -----------------------------------------------------------------------

const BANNED: { name: string; re: RegExp }[] = [
  { name: "--triaged (renamed --approved, ADR 0015)", re: /--triaged\b/u },
  {
    name: "hyphenated vendor verb (now `vendor <sub>`)",
    re: /\bvendor-(ls|add|rm|sync|check|guard)\b/u,
  },
  { name: "`bun <script>.ts` invocation (use `viz <verb>`)", re: /\bbun\s+["']?[^\s"'`]*\.ts\b/u },
  {
    name: "legacy script name (use `viz <verb>`)",
    re: /(?<![\w/.-])(manage|build|bootstrap|verify|check-exchange|deploy-all|publish|sync-runtimes)\.ts\b/u,
  },
  { name: "viz:kind (the axis ADR 0011 removed)", re: /viz:kind\b/u },
];

/** Genuine exceptions. Each must say why; match on file + a substring of the line. */
const ALLOWED: { file: string; contains: string; why: string }[] = [
  {
    file: "reference/full.md",
    contains: '`bun "$SKILL_DIR/viz.ts"`',
    why: "defines what `viz` means in every other doc",
  },
  {
    file: "reference/templates.md",
    contains: "**Not `viz:kind`.**",
    why: "warns against confusing it with viz:page-kind",
  },
];

test("docs carry no removed flags, verbs or legacy script names", () => {
  const hits: string[] = [];
  for (const l of lines) {
    if (ALLOWED.some((a) => a.file === l.file && l.text.includes(a.contains))) continue;
    for (const b of BANNED) if (b.re.test(l.text)) hits.push(`${where(l)}: ${b.name}`);
  }
  expect(hits).toEqual([]);
});

// ---- 3 + 5. routing: no dead links (orphans and nesting are scripts/skills-check.py) ------

/** Skill-root-relative doc paths a file points at, e.g. `reference/verify.md`, `kit/README.md`. */
const pointers = (file: string) =>
  [...read(file).matchAll(/(?<![\w/.-])((?:reference|kit)\/[\w./-]*[\w/])/gu)].map((m) =>
    m[1]!.replace(/\/$/u, ""),
  );

describe("routing", () => {
  test("every path the docs point at exists", () => {
    const dead = DOCS.flatMap((file) =>
      pointers(file)
        .filter((p) => !existsSync(path.join(SKILL, p)))
        .map((p) => `${file}: ${p}`),
    );
    expect(dead).toEqual([]);
  });

  test("relative markdown links resolve", () => {
    const dead: string[] = [];
    for (const l of lines) {
      for (const [, target = ""] of l.text.matchAll(/\]\(([^)\s]+)\)/gu)) {
        if (/^(https?:|mailto:|#)/u.test(target)) continue;
        const file = target.split("#")[0]!;
        if (!existsSync(path.resolve(path.join(SKILL, path.dirname(l.file)), file)))
          dead.push(`${where(l)}: ${target}`);
      }
    }
    expect(dead).toEqual([]);
  });
});
