// lib/render/capture.ts — seek, screenshot, pipe to ffmpeg. Never a screen recording.
//
// Each frame is "put the page at exactly t, then shoot it", so the file is frame-accurate
// by construction and any slice of frames can be rendered by its own browser. That is the
// whole trick behind parallel workers: N browsers, N contiguous slices, one lossless concat.
//
// Two ways to put a page at t (reference/timeline.md):
//   timeline — the page exposes window.__viz.timeline.seek(t). Exact.
//   auto     — it doesn't; freeze every CSS/Web Animation at t via document.getAnimations().
//              Best effort: JS-driven motion (rAF loops, canvas) cannot be reached this way,
//              so it is detected and warned about rather than silently rendered frozen.

import { spawn } from "node:child_process";
import { launch as launchChrome, type Browser, type Page } from "puppeteer-core";
import { chromePath } from "../verify/chrome.ts";
import { tagAutomation } from "../automation.ts";

// Server chrome, not part of the piece: feedback widget, reload badge, on-page captions
// (the video carries captions as a subtitle track instead) — and anything the page itself
// marks data-viz-chrome, e.g. its play/scrub controls.
const HIDE = "#viz-feedback,#viz-status,#viz-captions,[data-viz-chrome]{display:none!important}";

// Runs before any page script. The reload client would navigate away mid-capture on the
// next file save, so its socket (and only its socket) is swapped for a dead one. The rAF
// counter is how auto mode notices motion it cannot seek.
const PRELUDE = `(() => {
  const WS = window.WebSocket;
  window.WebSocket = function (url, p) {
    if (String(url).endsWith("/_reload")) return { close() {}, send() {}, addEventListener() {} };
    return new WS(url, p);
  };
  window.WebSocket.prototype = WS.prototype;
  let n = 0; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { n++; return raf(cb); };
  window.__vizRenderRaf = () => n;
})()`;

const SEEK = `async (t) => {
  const tl = window.__viz && window.__viz.timeline;
  if (tl) return void (await tl.seek(t));
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
}`;

export type Probe = {
  mode: "timeline" | "auto";
  total: number;
  warnings: string[];
  chapters?: { n: number; t0: number; dur: number }[];
  beats?: { t0: number; dur: number }[];
};

/** Every browser this process has open, so a cancel can close them (Chrome runs in its own process group). */
export const open = new Set<Browser>();
let launched: ((pid: number) => void) | undefined;
export const onLaunch = (fn: (pid: number) => void): void => {
  launched = fn;
};

export async function launch(): Promise<Browser> {
  // One retry: under load (several renders, a test suite) Chrome occasionally fails to start,
  // and a render job shouldn't die on that.
  const opts = {
    executablePath: chromePath(),
    headless: true,
    // Puppeteer's own SIGTERM handler closes the browser but swallows the exit, which left a
    // cancelled runner hanging with ffmpeg waiting on its stdin. run.ts owns SIGTERM instead.
    handleSIGTERM: false,
    args: ["--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio"],
  };
  const b = await launchChrome(opts).catch(async () => {
    await Bun.sleep(1500);
    return launchChrome(opts);
  });
  open.add(b);
  const pid = b.process()?.pid;
  if (pid) launched?.(pid);
  b.on("disconnected", () => {
    open.delete(b);
  });
  return b;
}

export async function openPage(browser: Browser, url: string, w: number, h: number): Promise<Page> {
  const page = await browser.newPage();
  await tagAutomation(page); // backends refuse to ACT on this load: see lib/automation.ts
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(PRELUDE);
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.addStyleTag({ content: HIDE });
  // A page that declares <meta name="viz:film"> will register a timeline, however long its setup
  // takes (fonts, a highlighter, data) — wait for it rather than guessing it has none.
  const film = await page.evaluate(`!!document.querySelector('meta[name="viz:film"]')`);
  await page
    .waitForFunction("!!(window.__viz && window.__viz.timeline)", { timeout: film ? 20_000 : 1500 })
    .catch(() => {
      /* no timeline registered: nothing to wait for */
    });
  await page.evaluate("window.__viz && window.__viz.timeline && window.__viz.timeline.pause()");
  return page;
}

export async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate(`(${SEEK})(${t.toFixed(4)})`);
}

const field = (v: unknown, k: string): unknown =>
  typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined;
const hasNums = (v: unknown, ...keys: string[]): boolean =>
  keys.every((k) => typeof field(v, k) === "number");

/** The page's `{ total, chapters, beats }`, or null when it has no usable timeline. What the page hands back is only trusted after this. */
function readTimeline(v: unknown): Omit<Probe, "mode" | "warnings"> | null {
  const total = field(v, "total");
  if (typeof total !== "number") return null;
  const chapters = field(v, "chapters");
  const beats = field(v, "beats");
  return {
    total,
    ...(Array.isArray(chapters) && {
      chapters: chapters.filter((c: unknown): c is { n: number; t0: number; dur: number } =>
        hasNums(c, "t0", "dur"),
      ),
    }),
    ...(Array.isArray(beats) && {
      beats: beats.filter((b: unknown): b is { t0: number; dur: number } =>
        hasNums(b, "t0", "dur"),
      ),
    }),
  };
}

/** How long the piece is, how it will be seeked, and anything the render can't do right. */
export async function probe(page: Page, duration?: number): Promise<Probe> {
  const tl = readTimeline(
    await page.evaluate(`(() => { const t = window.__viz && window.__viz.timeline;
    return t && { total: t.total, chapters: t.chapters, beats: t.beats }; })()`),
  );
  if (tl && tl.total > 0) return { mode: "timeline", warnings: [], ...tl };

  const warnings: string[] = [];
  const raf0 = Number(await page.evaluate("window.__vizRenderRaf()"));
  await Bun.sleep(500);
  const rafRate = Number(await page.evaluate("window.__vizRenderRaf()")) - raf0;
  const animRaw: unknown = await page.evaluate(`(() => {
    let end = 0, infinite = false;
    const all = document.getAnimations();
    for (const a of all) {
      const e = a.effect ? a.effect.getComputedTiming().endTime : 0;
      if (e === Infinity) infinite = true; else if (e > end) end = e;
    }
    return { end: end / 1000, infinite, count: all.length };
  })()`);
  const anim = {
    end: Number(field(animRaw, "end")),
    infinite: field(animRaw, "infinite") === true,
    count: Number(field(animRaw, "count")),
  };

  warnings.push(
    "no window.__viz.timeline — best-effort render: CSS/Web Animations are frozen per frame (reference/timeline.md)",
  );
  // A continuous rAF loop calls ~30 times in 500ms; a one-off layout tick calls a handful.
  if (rafRate > 10)
    warnings.push(
      `JS-driven motion detected (${rafRate} requestAnimationFrame calls in 500ms) — it cannot be seeked and will render frozen or wrong; expose window.__viz.timeline`,
    );

  const total = duration ?? anim.end;
  if (!duration && anim.infinite) {
    throw new Error(
      `the page has an infinitely repeating animation, so it has no natural length — pass --duration <seconds>`,
    );
  }
  if (!(total > 0)) {
    throw new Error(
      `nothing to render: no window.__viz.timeline and no finite CSS/Web Animations (${anim.count} found) — pass --duration <seconds>, or expose window.__viz.timeline`,
    );
  }
  if (duration && anim.end > duration)
    warnings.push(
      `--duration ${duration}s cuts off animations that run to ${anim.end.toFixed(2)}s`,
    );
  return { mode: "auto", total, warnings };
}

/**
 * Render frames [from, to) to one mp4 segment. Every segment is independently decodable
 * (it starts on a keyframe with identical encoder settings), which is what lets them be
 * concatenated without re-encoding.
 */
export async function renderSegment(o: {
  url: string;
  from: number;
  to: number;
  fps: number;
  w: number;
  h: number;
  out: string;
  onFrame: () => void;
  warn: (w: string) => void;
}): Promise<void> {
  const browser = await launch();
  try {
    const page = await openPage(browser, o.url, o.w, o.h);

    // Seam check. A slice starts from a fresh page; a serial render would arrive at the
    // same frame from the one before it. If those two differ, seek() is carrying state
    // across calls and the joins between slices will visibly glitch.
    if (o.from > 0) {
      await seek(page, o.from / o.fps);
      const fresh = await page.screenshot({ type: "png" });
      await seek(page, (o.from - 1) / o.fps);
      await seek(page, o.from / o.fps);
      const after = await page.screenshot({ type: "png" });
      if (!Buffer.from(fresh).equals(Buffer.from(after))) {
        o.warn(
          `a frame at a worker seam differs depending on the frame before it — seek(t) is not idempotent, so seams between workers may glitch; render with --workers 1 or fix seek()`,
        );
      }
    }

    const ff = spawn(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-framerate",
        String(o.fps),
        "-i",
        "-", // declared, not probed: a near-blank frame is too small a JPEG to sniff
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "17",
        "-preset",
        "medium",
        "-r",
        String(o.fps),
        "-movflags",
        "+faststart",
        o.out,
      ],
      { stdio: ["pipe", "ignore", "inherit"] },
    );
    let dead = false;
    const done = new Promise<number>((r) => {
      ff.on("close", (c) => {
        dead = true;
        r(c ?? 1);
      });
    });
    ff.stdin.on("error", () => {
      /* swallowed */
    }); // EPIPE when ffmpeg dies — reported below via its exit code

    // oxlint-disable-next-line no-unmodified-loop-condition -- `dead` is set by ffmpeg's close handler above
    for (let i = o.from; i < o.to && !dead; i++) {
      // oxlint-disable-next-line no-await-in-loop -- frames are seeked, shot and piped in order: ffmpeg reads one stream
      await seek(page, i / o.fps);
      // oxlint-disable-next-line no-await-in-loop -- same ordered pipeline
      const buf = await page.screenshot({ type: "jpeg", quality: 96 });
      // A drain that never comes (ffmpeg gone mid-backpressure) must not hang the job.
      if (!ff.stdin.write(buf))
        // oxlint-disable-next-line no-await-in-loop -- backpressure: wait for ffmpeg before the next frame
        await Promise.race([
          new Promise<void>((r) => {
            ff.stdin.once("drain", () => {
              r();
            });
          }),
          done,
        ]);
      o.onFrame();
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg exited ${code} encoding frames ${o.from}-${o.to}`);
  } finally {
    await browser.close();
  }
}

/** Join segments without re-encoding. */
export async function concat(segments: string[], out: string, listFile: string): Promise<void> {
  await Bun.write(
    listFile,
    segments.map((s) => `file '${s.replaceAll("'", "'\\''")}'`).join("\n") + "\n",
  );
  const p = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      out,
    ],
    { stderr: "inherit" },
  );
  if ((await p.exited) !== 0) throw new Error(`ffmpeg concat failed → ${out}`);
}
