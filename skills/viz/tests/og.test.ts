// Link-preview tags for an animated card: og.gif as the image (first frame is the still
// everywhere that doesn't animate), og.mp4 as og:video, sizes read from the files.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mediaSize, ogTagsFor } from "../lib/publish/og.ts";

const HTML = `<html><head><title>t</title><meta name="viz:description" content="d"></head><body></body></html>`;
// 1×1 GIF89a with the logical screen patched to 800×420
const gif = (w: number, h: number) => {
  const b = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8);
  return b;
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==", "base64");

let dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), "og-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });
const tags = (viz: string, out: string, warnings: string[] = []) =>
  ogTagsFor(viz, out, true, "https://h.example/v/", "https://h.example/v/", HTML, warnings);

describe("animated preview cards", () => {
  test("Given og.gif and og.png, when tags are built, then the GIF wins with its own size and type", () => {
    const viz = tmp(), out = tmp();
    writeFileSync(path.join(viz, "og.gif"), gif(800, 420));
    writeFileSync(path.join(viz, "og.png"), PNG);
    const t = tags(viz, out);
    expect(t).toContain(`og:image" content="https://h.example/v/og.gif"`);
    expect(t).toContain(`og:image:width" content="800"`);
    expect(t).toContain(`og:image:height" content="420"`);
    expect(t).toContain(`og:image:type" content="image/gif"`);
    expect(existsSync(path.join(out, "og.gif"))).toBe(true);
  });

  test("Given an og.png only, when tags are built, then its real size is declared and there is no og:video", () => {
    const viz = tmp(), out = tmp();
    writeFileSync(path.join(viz, "og.png"), PNG);
    const t = tags(viz, out);
    expect(t).toContain(`og:image:width" content="1"`);
    expect(t).not.toContain("og:video");
    expect(t).not.toContain("og:image:type");
  });

  test("Given og.mp4 beside the image, when tags are built, then it ships as og:video with its size", () => {
    const viz = tmp(), out = tmp();
    writeFileSync(path.join(viz, "og.gif"), gif(800, 420));
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1200x630:d=0.2",
      "-pix_fmt", "yuv420p", path.join(viz, "og.mp4")]);
    const t = tags(viz, out);
    expect(t).toContain(`og:video" content="https://h.example/v/og.mp4"`);
    expect(t).toContain(`og:video:secure_url" content="https://h.example/v/og.mp4"`);
    expect(t).toContain(`og:video:type" content="video/mp4"`);
    expect(t).toContain(`og:video:width" content="1200"`);
    expect(t).toContain(`og:video:height" content="630"`);
    expect(existsSync(path.join(out, "og.mp4"))).toBe(true);
  });

  test("Given og.mp4 but no image, when tags are built, then no video is declared (a card needs its still)", () => {
    const viz = tmp(), out = tmp();
    writeFileSync(path.join(viz, "og.mp4"), "x");
    expect(tags(viz, out)).not.toContain("og:video");
  });

  test("Given a GIF over 1 MB, when tags are built, then publishing warns about the unfurl budget", () => {
    const viz = tmp(), out = tmp(), warnings: string[] = [];
    writeFileSync(path.join(viz, "og.gif"), Buffer.concat([gif(800, 420), Buffer.alloc(1_100_000)]));
    tags(viz, out, warnings);
    expect(warnings.join("\n")).toContain("drop preview images past ~1 MB");
  });

  test("Given a JPEG, when its size is read, then the standard 1200×630 is assumed", () => {
    const viz = tmp();
    writeFileSync(path.join(viz, "og.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(mediaSize(path.join(viz, "og.jpg"))).toEqual([1200, 630]);
  });
});
