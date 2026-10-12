// tests/feedback-page.test.ts — the feedback widget on every page (ADR 0026): what a build carries,
// how a page opts out, and the text a Copy puts on the clipboard.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSelfContained } from "../inline.ts";
import { feedbackHead, feedbackOptedOut } from "../lib/server/feedback-page.ts";
import { feedbackText, foldFeedback } from "../kit/src/feedback-text.ts";
import { parseJson } from "./json.ts";

function build(page: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "viz-fb-"));
  try {
    writeFileSync(path.join(dir, "index.html"), page);
    return buildSelfContained(dir).html;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const importMap = (html: string) =>
  parseJson<{ imports: Record<string, string> }>(
    /<script type="importmap">(.*?)<\/script>/u.exec(html)![1]!,
  ).imports;
const decode = (u: string) => Buffer.from(u.split(",")[1]!, "base64").toString();
const PAGE = `<!doctype html><html><head><title>t</title></head><body><canvas></canvas><script type="module">import "@viz/kit";</script></body></html>`;

describe("a build carries the widget", () => {
  test("Given a page, when built, then the stamp shim leads <head>, feedback.js is mapped once and screenshot.js is its own entry", () => {
    const html = build(PAGE);
    expect(html).toMatch(/<head>\s*<script data-viz-stamp="[0-9a-f]{10}">/u); // before any page script
    expect(html).toContain("preserveDrawingBuffer:true");
    const map = importMap(html);
    expect(Object.keys(map).filter((k) => k.endsWith("feedback.js"))).toEqual([
      "/_kit/feedback.js",
    ]);
    expect(map["@viz/kit/screenshot.js"]).toStartWith("data:text/javascript;base64,");
    // On demand by its alias, so not nested inside feedback.js's own base64.
    const widget = decode(map["/_kit/feedback.js"]!);
    expect(widget).toContain('import("@viz/kit/screenshot.js")');
    expect(widget.length).toBeLessThan(map["@viz/kit/screenshot.js"]!.length);
  });

  test("Given a page that opts out, when built, then it has no widget and no stamp", () => {
    const html = build(PAGE.replace("<title>", `<meta content="off" name="viz:feedback"><title>`));
    expect(html).not.toContain("/_kit/feedback.js");
    expect(html).not.toContain("data-viz-stamp");
  });

  test("Given a page, when built, then it carries the presence layer with Trystero inlined, even with the widget off", () => {
    for (const page of [
      PAGE,
      PAGE.replace("<title>", `<meta name="viz:feedback" content="off"><title>`),
    ]) {
      const presence = decode(importMap(build(page))["/_kit/presence.js"]!);
      expect(presence).toContain('import { joinRoom, selfId } from "data:text/javascript;base64,'); // no network fetch for the library
    }
  });

  test("Given a page that loads the widget itself (a hosted demo), when built, then it isn't added a second time", () => {
    const html = build(
      PAGE.replace("</body>", `<script type="module" src="/_kit/feedback.js"></script></body>`),
    );
    expect(html.match(/import "\/_kit\/feedback\.js"/gu)).toHaveLength(1);
  });

  test("Given the opt-out tag with its attributes in either order, then it reads as opted out; any other content does not", () => {
    expect(feedbackOptedOut(`<meta name="viz:feedback" content="off">`)).toBe(true);
    expect(feedbackOptedOut(`<meta content='off' name='viz:feedback'>`)).toBe(true);
    expect(feedbackOptedOut(`<meta name="viz:feedback" content="on">`)).toBe(false);
    expect(feedbackOptedOut(PAGE)).toBe(false);
  });

  test("Given the same source twice and a changed one, then the stamp repeats and then changes", () => {
    const stamp = (s: string) => /data-viz-stamp="(\w+)"/u.exec(feedbackHead(s))![1];
    expect(stamp("a")).toBe(stamp("a"));
    expect(stamp("a")).not.toBe(stamp("b"));
  });
});

describe("the text a Copy carries", () => {
  test("Given lines with crops and a pick, when the crops are numbered, then the text names them as on the contact sheet", () => {
    const { lines, picks } = foldFeedback([
      {
        type: "speech",
        id: "a",
        text: "too tall",
        at: "T",
        anchor: { selector: "#bar", label: "Bar 3" },
        where: { x: 1, y: 2, w: 3, h: 4, sx: 0, sy: 0 },
        shots: { start: "fb-a-start.png", end: "fb-a-end.png" },
      },
      { type: "pick", q: "Q1", opt: "B" },
    ]);
    const num: Record<string, number> = { "fb-a-start.png": 1, "fb-a-end.png": 2 };
    const text = feedbackText(lines, picks, true, (f, k) => `crop ${num[f]} (${k})`).join("\n");
    expect(text).toContain("[Bar 3]  #bar");
    expect(text).toContain("screenshots: crop 1 (start) · crop 2 (end)");
    expect(text).toContain("picks: Q1:B");
  });
});

describe("who said it", () => {
  const line = (id: string, by?: string) => ({
    type: "comment",
    id,
    text: `t${id}`,
    ...(by ? { by: { name: by, color: "#fff" } } : {}),
  });
  const text = (entries: object[]) => {
    const { lines, picks } = foldFeedback(entries);
    return feedbackText(lines, picks, false, (n) => n).join("\n");
  };

  test("Given lines from two people, when folded to text, then each line names who said it", () => {
    const out = text([line("1", "Teal Otter"), line("2", "Ruby Lynx")]);
    expect(out).toContain("Teal Otter: t1");
    expect(out).toContain("Ruby Lynx: t2");
  });

  test("Given lines from one person (or nobody known), then no names: solo pages read as before", () => {
    expect(text([line("1", "Teal Otter"), line("2", "Teal Otter")])).not.toContain("Teal Otter");
    expect(text([line("1")])).toContain("  1  (typed) t1");
  });
});
