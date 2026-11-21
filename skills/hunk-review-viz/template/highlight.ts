// highlight.ts — syntax colour for diff lines, with highlight.js (the viz kit's pick:
// reference/assets/code-highlighting.md). A hunk is highlighted as one text, so a comment or string
// spanning lines colours correctly, then split back into lines with open spans closed and reopened.
// pr-viz does the same for its tour; this copy works on hunk-review-viz's plain " "/"+"/"-" lines.
import type { HLJSApi } from "highlight.js";
import { esc } from "@viz/kit";

const HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0";

const LANG: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  toml: "ini",
  ini: "ini",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "xml",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  tf: "ini",
  dockerfile: "dockerfile",
  gitignore: "bash",
  example: "bash",
};

/** The highlight.js language for a path, by extension or bare file name (Dockerfile, .gitignore). */
export function langOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = /\.(\w+)$/u.exec(name)?.[1] ?? name;
  return LANG[ext];
}

declare global {
  interface Window {
    hljs?: HLJSApi;
  }
}

let hljs: HLJSApi | undefined;

/** Loads highlight.js and its theme once. Resolves even if the CDN is unreachable (code stays plain). */
export async function loadHighlighter(): Promise<void> {
  document.head.insertAdjacentHTML(
    "beforeend",
    `<link rel="stylesheet" href="${HLJS}/styles/atom-one-dark.min.css">`,
  );
  await new Promise((ok) => {
    document.head.append(
      Object.assign(document.createElement("script"), {
        src: `${HLJS}/highlight.min.js`,
        onload: ok,
        onerror: ok,
      }),
    );
  });
  hljs = window.hljs;
}

/** Splits highlighted HTML at newlines, closing every open span at a line end and reopening it on the next. */
function splitBalanced(html: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let cur = "";
  for (const t of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+/gu) ?? []) {
    if (t === "\n") {
      out.push(cur + "</span>".repeat(stack.length));
      cur = stack.join("");
    } else if (t.startsWith("<span")) {
      stack.push(t);
      cur += t;
    } else if (t === "</span>") {
      stack.pop();
      cur += t;
    } else cur += t;
  }
  return [...out, cur];
}

const cache = new Map<string, string[]>();

/**
 * HTML for each diff line's code (prefix removed), same order as `lines`. Removed and context/added
 * lines are highlighted as two texts, the old side and the new side, so each reads as real code.
 * A "\ No newline" marker stays plain.
 */
export function highlightLines(path: string, lines: string[]): string[] {
  const key = `${path}\0${lines.join("\n")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lang = langOf(path);
  const paint = (text: string) =>
    hljs && lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
      : esc(text);
  const side = (keep: (l: string) => boolean) => {
    const idx = lines.flatMap((l, i) => (keep(l) ? [i] : []));
    const html = splitBalanced(paint(idx.map((i) => (lines[i] ?? "").slice(1)).join("\n")));
    return new Map(idx.map((i, k) => [i, html[k] ?? ""]));
  };
  const oldSide = side((l) => l.startsWith("-") || l.startsWith(" "));
  const newSide = side((l) => l.startsWith("+") || l.startsWith(" "));
  const out = lines.map((l, i) =>
    l.startsWith("\\")
      ? esc(l)
      : ((l.startsWith("-") ? oldSide.get(i) : newSide.get(i)) ?? esc(l.slice(1))),
  );
  cache.set(key, out);
  return out;
}
