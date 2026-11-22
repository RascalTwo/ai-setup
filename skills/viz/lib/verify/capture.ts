// lib/verify/capture.ts — what one verify run collects from the page: console, failures, network, and the audit result.
import type { HTTPResponse, Page } from "puppeteer-core";
import type { Layout } from "./audit-page.ts";
import { isBenignAbort } from "./noise.ts";

export const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const stamp = (): string => new Date().toISOString().slice(11, 23);

/** Everything the page and the run hand back, filled in as verify goes and read by the report at the end. */
export type Capture = {
  lines: string[];
  /** uncaught exceptions + failed requests — the signal that matters */
  errors: string[];
  /** full request+response block per response */
  network: string[];
  /** response.text() reads, awaited before close */
  bodyTasks: Promise<void>[];
  dom: string;
  /** narration.json warnings — informational, like density */
  narration: string[];
  /** chapters.png for a timed film */
  filmSheet: string | null;
  /** Mechanical layout findings + a mark census, populated by the in-page audit. */
  layout: Layout;
};

export const newCapture = (): Capture => ({
  lines: [],
  errors: [],
  network: [],
  bodyTasks: [],
  dom: "",
  narration: [],
  filmSheet: null,
  layout: { findings: [], census: "?", words: 0, graphical: 0 },
});

// favicon: every page 404s it. .tts/ ERR_ABORTED: narration clips preloading when verify
// closes the page — a film always has some in flight. Neither is a viz bug.
const isNoise = (s: string) =>
  s.includes("favicon.ico") || (s.includes("/.tts/") && s.includes("ERR_ABORTED"));

/** One response as a text block: status line, request and response headers, bodies (text-ish content only). */
async function networkBlock(res: HTTPResponse): Promise<string> {
  const req = res.request();
  const ct = res.headers()["content-type"] ?? "";
  let respBody: string;
  if (/event-stream/iu.test(ct)) {
    respBody = "[event-stream — not read (would never end)]"; // a streaming api route
    // (_reload is no longer here — it's a websocket now; see kit/reload.ts)
  } else if (/json|text|javascript|xml|html|csv|svg|x-www-form-urlencoded/iu.test(ct)) {
    try {
      // Hard timeout: a stalled/streaming body must never hang the whole run.
      const t = await Promise.race([
        res.text(),
        new Promise<never>((_, rej) => {
          setTimeout(() => {
            rej(new Error("timeout"));
          }, 3000);
        }),
      ]);
      respBody =
        t.length > 20000 ? t.slice(0, 20000) + `\n…[truncated, ${t.length} bytes total]` : t;
    } catch {
      respBody = "[body unavailable (redirect/cache/stream/timeout)]";
    }
  } else {
    respBody = `[non-text body: ${ct || "unknown type"}]`;
  }
  const hdrs = (h: Record<string, string>) =>
    Object.entries(h)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join("\n") || "    (none)";
  const postData = req.hasPostData() ? await req.fetchPostData().catch(() => null) : null;
  return (
    `### ${res.status()} ${req.method()} ${res.url()}\n` +
    `  > request headers:\n${hdrs(req.headers())}\n` +
    `  > request body: ${postData ?? "(none)"}\n` +
    `  < response headers:\n${hdrs(res.headers())}\n` +
    `  < response body:\n${respBody}`
  );
}

/** Wire the page's console, exceptions, failed requests and responses into the capture buffers. */
export function attachListeners(page: Page, cap: Capture): void {
  const { lines, errors, network, bodyTasks } = cap;
  page.on("console", (msg) => {
    const loc = msg.location();
    const where = loc.url ? ` (${loc.url.split("/").pop()}:${loc.lineNumber ?? "?"})` : "";
    const entry = `[${stamp()}] ${msg.type()}: ${msg.text()}${where}`;
    lines.push(entry);
    if (msg.type() === "error" && !isNoise(entry)) errors.push(entry);
  });
  page.on("pageerror", (err) => {
    const entry = `[${stamp()}] UNCAUGHT: ${err instanceof Error ? err.message : String(err)}`;
    lines.push(entry);
    errors.push(entry);
  });
  page.on("requestfailed", (req) => {
    const entry = `[${stamp()}] REQUEST FAILED: ${req.url()} (${req.failure()?.errorText ?? "?"})`;
    lines.push(entry);
    if (!isNoise(entry) && !isBenignAbort(req.resourceType(), req.failure()?.errorText))
      errors.push(entry);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !isNoise(res.url())) {
      const entry = `[${stamp()}] HTTP ${res.status()}: ${res.url()}`;
      lines.push(entry);
      errors.push(entry);
    }
    // Full request+response block. Body only for text-ish content (dumping binary as
    // text is noise); awaited via bodyTasks so the page stays open until reads finish.
    bodyTasks.push(
      networkBlock(res)
        .then((block) => {
          network.push(block);
        })
        .catch(() => {
          /* a response whose block cannot be built is left out */
        }),
    );
  });
}
