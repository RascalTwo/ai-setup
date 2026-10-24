// lib.ts — host.ts's pure parts, importable without starting a server.
import { existsSync, readFileSync } from "node:fs";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

/** What `show` puts in the panel: the AI's own HTML, or a page by URL (a viz page, say). */
export type ShowArgs = { html?: string; url?: string; title?: string; width?: number };

// Open door, the user's call: a shown page may load from, connect to and frame anything.
export const OPEN_CSP: McpUiResourceCsp = {
  resourceDomains: ["https:", "http:"],
  connectDomains: ["https:", "http:", "wss:", "ws:"],
  frameDomains: ["https:", "http:"],
};

// Runs inside a shown page: default colors, the MCP Apps handshake, `panel.send(text)` as ui/message, and the page's height as it changes.
const SHOW_HELPER = `<meta name="color-scheme" content="light dark"><style>:where(html){background:Canvas;color:CanvasText;font:13px -apple-system,system-ui,sans-serif}</style><script>(() => {
  let n = 0; const wait = new Map();
  const rpc = (method, params) => new Promise((ok) => { const id = ++n; wait.set(id, ok); parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*"); });
  const note = (method, params) => parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  addEventListener("message", (e) => { const m = e.data; if (e.source === parent && wait.has(m?.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const ready = rpc("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "app-panel show", version: "1" }, appCapabilities: {} })
    .then(() => note("ui/notifications/initialized", {}));
  window.panel = { send: (text) => ready.then(() => rpc("ui/message", { role: "user", content: [{ type: "text", text: String(text) }] })) };
  // The content's extent, not the body's: a fragment without a doctype renders in quirks mode, where the body fills the frame.
  const r = document.createRange();
  const size = () => (r.selectNodeContents(document.body), note("ui/notifications/size-changed", { height: Math.ceil(r.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).paddingBottom) + parseFloat(getComputedStyle(document.body).marginBottom)) }));
  ready.then(() => { size(); new ResizeObserver(size).observe(document.body); new MutationObserver(size).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
})();</script>`;

/** A long task's state: what the `progress` tool and command send, plus the times the host stamps on it. */
export type Progress = {
  title: string; stage?: string;
  /** Names, or names with each one's estimate in seconds; the host keeps the names here and the estimates in `estimates`. */
  stages?: (string | { name: string; eta?: number })[]; estimates?: (number | null)[]; done?: number; total?: number; eta?: number;
  status?: "running" | "done" | "failed"; note?: string; started?: number; stageStarted?: number; updated?: number; due?: number;
};

/** The view a `show` call becomes. A URL is framed at a fixed height: its page is another origin, so it can't be measured. */
export function showView(a: ShowArgs): { html: string; title: string; height?: number } {
  if (!a.html === !a.url) throw new Error("show takes exactly one of html or url");
  if (a.url) {
    const u = new URL(a.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("show's url must be http or https");
    const html = `<!doctype html><style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style><iframe src="${Bun.escapeHTML(u.href)}"></iframe>`;
    return { html, title: a.title ?? u.href, height: 640 };
  }
  const html = a.html!;
  const found = html.match(/<title[^>]*>([^<]*)</i)?.[1] ?? html.match(/<h1[^>]*>([^<]*)</i)?.[1] ?? "";
  const head = html.match(/<head[^>]*>/i)?.[0]; // after <head>, so a doctype stays first
  return { html: head ? html.replace(head, head + SHOW_HELPER) : SHOW_HELPER + html, title: a.title ?? (found.trim() || "show") };
}

/** Between server and tool in a proxied tool's name: `qr__generate_qr`. */
export const SEP = "__";

export type Entry = { command: string; args?: string[]; env?: Record<string, string> } | { url: string };

/** servers.json, in Claude Code's own `mcpServers` shape so an entry can be moved over as is. */
export function readConfig(file: string): Record<string, Entry> {
  if (!existsSync(file)) return {};
  const servers = (JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, Entry> }).mcpServers ?? {};
  for (const name of Object.keys(servers))
    if (name.includes(SEP)) throw new Error(`server name ${name} must not contain "${SEP}"`);
  return servers;
}

// Only these characters may appear in a CSP source we copy from a view's metadata (from basic-host).
const cleanDomains = (d?: string[]): string => (d ?? []).filter((x) => typeof x === "string" && !/[;\r\n'" ]/.test(x)).join(" ");

/** The sandbox's CSP, sent as a header so the view can't loosen it (adapted from ext-apps basic-host). */
export function cspHeader(csp?: McpUiResourceCsp): string {
  const res = cleanDomains(csp?.resourceDomains);
  const frames = cleanDomains(csp?.frameDomains);
  const base = cleanDomains(csp?.baseUriDomains);
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${res}`,
    `style-src 'self' 'unsafe-inline' blob: data: ${res}`,
    `img-src 'self' data: blob: ${res}`,
    `font-src 'self' data: blob: ${res}`,
    `media-src 'self' data: blob: ${res}`,
    `connect-src 'self' ${cleanDomains(csp?.connectDomains)}`,
    `worker-src 'self' blob: ${res}`,
    frames ? `frame-src ${frames}` : "frame-src 'none'",
    "object-src 'none'",
    base ? `base-uri ${base}` : "base-uri 'none'",
  ].map((d) => d.trim()).join("; ");
}
