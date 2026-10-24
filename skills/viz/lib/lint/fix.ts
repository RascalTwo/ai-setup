// lib/lint/fix.ts — `--fix` (lint, format, verify): move executable inline <script> code into sibling .ts files (ADR 0023: author in .ts,
// reference .js), so Oxlint and the type checker can read it. Oxlint's own safe fixes are applied by lint(dir, [], true).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format } from "../format/format.ts";
import { lint } from "./lint.ts";

/** Same test as lint.ts's inlineScripts: import maps and data blocks are not code. */
const isCode = (attrs: string): boolean => {
  const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/iu)?.[1]?.toLowerCase();
  return !type || type === "module" || /(?:java|ecma)script$/u.test(type);
};

/** Extract each inline code script of each `.html` in `vizDir` to `<page>.<n>.ts`; returns the files written. */
export function extractInlineScripts(vizDir: string): string[] {
  const written: string[] = [];
  for (const name of readdirSync(vizDir)
    .filter((n) => n.endsWith(".html"))
    .toSorted()) {
    const file = path.join(vizDir, name),
      base = name.slice(0, -".html".length);
    let n = 0;
    const html = readFileSync(file, "utf8").replaceAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/giu,
      (all, attrs: string, body: string) => {
        if (/\bsrc\s*=/u.test(attrs) || !body.trim() || !isCode(attrs)) return all;
        const ts = `${base}.${++n}.ts`;
        writeFileSync(path.join(vizDir, ts), `${body.replace(/^\s*\n/u, "").trimEnd()}\n`);
        written.push(ts);
        return `<script${attrs} src="./${base}.${n}.js"></script>`;
      },
    );
    if (n) writeFileSync(file, html);
  }
  return written;
}

/** Everything `--fix` does, in the order that keeps each step from undoing the last: inline scripts out, Oxlint's safe fixes, then the formatting. */
export function fixViz(vizDir: string): void {
  extractInlineScripts(vizDir);
  lint(vizDir, [], true);
  format(vizDir, [], true);
}
