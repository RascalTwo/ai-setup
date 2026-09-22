// lib/library/meta.ts — Reading and rewriting the viz:* meta tags in an index.html.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- meta upsert/remove (reference impl: viz-self-portrait/api.ts) ----
// Targets the real <meta name content> tag; replaces content if present, else
// inserts just after <head>.
export function upsertMeta(html: string, name: string, content: string): string {
  // (content=)(quote)(.*?)\2 — match up to the SAME delimiter via backreference.
  // A plain [^"'] class stops at the first apostrophe inside a double-quoted value
  // (e.g. "Claude Code's ..."), which would truncate-and-corrupt on replace.
  const re = new RegExp(`(<meta\\s+name=["']${name}["']\\s+content=)(["'])(.*?)\\2`, "i");
  // Function replacers throughout: free-text content (title/description/tags) may
  // contain `$`, which a string replacement would mangle as a capture reference.
  if (re.test(html)) return html.replace(re, (_m, p1, q) => `${p1}${q}${content}${q}`);
  const tag = `  <meta name="${name}" content="${content}">\n`;
  return /<head[^>]*>/i.test(html) ? html.replace(/(<head[^>]*>\s*)/i, (m) => `${m}${tag}`) : tag + html;
}

// Meta content lives HTML-escaped (same convention as inline.ts mirror overrides).
export function escAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
