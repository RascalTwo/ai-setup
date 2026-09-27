#!/usr/bin/env bun
// body.ts — the mechanical parts of an r2-pr body. The words are the agent's; this only moves them.
//
//   bun body.ts preview  <pr.md> <owner/repo> [--github]   → pr.html beside it, opened
//                         (rendered on this machine by Bun; --github sends the draft to GitHub's
//                          renderer instead, for an exact render)
//   bun body.ts finalize <pr.md> video=<url> image=<url>   → the body to post, on stdout
//   bun body.ts sync     <final.md> <owner/repo> <number>  → replace only r2-pr's marked sections on the PR
//
// A draft names its media by local path, one per line:  r2-pr:video <path>  /  r2-pr:image <path>
// Sections r2-pr owns sit between  <!-- r2-pr:<name> -->  and  <!-- /r2-pr:<name> -->.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [cmd, ...args] = process.argv.slice(2);
const home = (p: string) => p.replace(/^~(?=\/)/, os.homedir());
const MEDIA = /^r2-pr:(video|image) (.+)$/gm;
const SECTION = /<!-- r2-pr:([\w-]+) -->[\s\S]*?<!-- \/r2-pr:\1 -->/g;
const gh = (argv: string[], input?: string) => {
  const p = Bun.spawnSync(["gh", ...argv], { stdin: input ? Buffer.from(input) : undefined, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${argv[0]} ${argv[1] ?? ""}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
};

// GitHub-only markup a local render lacks: alert boxes and #123 references (outside code and links).
const ALERT = /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g;
function githubisms(html: string, repo: string) {
  let out = "", depth = 0;
  for (const part of html.split(/(<\/?(?:pre|code|a)\b[^>]*>)/)) {
    if (/^<(pre|code|a)\b/.test(part)) depth++;
    else if (/^<\/(pre|code|a)>/.test(part)) depth--;
    else if (!depth) { out += part.replace(/(^|[\s(])#(\d+)\b/g, `$1<a href="https://github.com/${repo}/issues/$2">#$2</a>`); continue; }
    out += part;
  }
  // An alert is a blockquote whose first line is [!TYPE]; GitHub renders it as a titled box.
  return out.replace(ALERT, (_, t) => `<blockquote class="markdown-alert markdown-alert-${t.toLowerCase()}"><p class="markdown-alert-title">${t[0]}${t.slice(1).toLowerCase()}</p><p>`);
}

if (cmd === "preview") {
  const [file, repo] = args;
  const exact = args.includes("--github");
  const md = readFileSync(file, "utf8");
  // Media become markers the renderer passes through, then local players after rendering.
  const media: [string, string][] = [];
  const marked = md.replace(MEDIA, (_, kind, p) => `R2PRMEDIA${media.push([kind, home(p.trim())]) - 1}`);
  const rendered = exact
    ? gh(["api", "markdown", "-f", "mode=gfm", "-f", `context=${repo}`, "-F", "text=@-"], marked)
    : githubisms(Bun.markdown.html(marked, { autolinks: true }), repo);
  const html = rendered.replace(/R2PRMEDIA(\d+)/g, (_, i) => {
      const [kind, p] = media[+i];
      if (!existsSync(p)) return `<p><b>missing ${kind}: ${p}</b></p>`;
      return kind === "video" ? `<video src="file://${p}" controls muted style="max-width:100%;max-height:640px"></video>` : `<img src="file://${p}" style="max-width:100%">`;
    });
  const out = file.replace(/\.md$/, "") + ".html";
  // The page fetches three open-source libraries (stylesheet, highlighter, mermaid); none of the draft leaves this machine.
  writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>PR preview</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
<style>body{background:#0d1117;margin:0}.markdown-body{box-sizing:border-box;max-width:1012px;margin:0 auto;padding:32px}.markdown-body pre code.hljs{padding:0;background:none}</style>
<article class="markdown-body">${html}</article>
<script type="module">
  // github.com colours code and draws mermaid blocks; do the same here (GitHub's renderer output is already coloured).
  const blocks = [...document.querySelectorAll('[lang="mermaid"], .highlight-source-mermaid, code.language-mermaid')];
  if (blocks.length) {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
    for (const [i, b] of blocks.entries()) (b.closest("pre") ?? b).outerHTML = (await mermaid.render("m" + i, b.textContent)).svg;
  }
  const code = document.querySelectorAll('pre code[class*="language-"]');
  if (code.length) {
    const { default: hljs } = await import("https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/es/highlight.min.js");
    code.forEach((c) => hljs.highlightElement(c));
  }
</script>`);
  Bun.spawnSync(["open", out]);
  console.log(out);
} else if (cmd === "finalize") {
  const [file, ...pairs] = args;
  const urls = Object.fromEntries(pairs.map((p) => p.split(/=(.*)/s).slice(0, 2)));
  const body = readFileSync(file, "utf8").replace(MEDIA, (_, kind) => {
    if (!urls[kind]) throw new Error(`no ${kind}=<url> given`);
    // A bare attachment URL on its own line is how GitHub embeds a video player.
    return kind === "video" ? urls.video : `<img width="1400" alt="Image walkthrough" src="${urls.image}" />`;
  });
  process.stdout.write(body);
} else if (cmd === "sync") {
  const [file, repo, number] = args;
  const fresh = new Map([...readFileSync(file, "utf8").matchAll(SECTION)].map((m) => [m[1], m[0]]));
  const live = JSON.parse(gh(["pr", "view", number, "-R", repo, "--json", "body"])).body as string;
  const found = new Set<string>();
  const body = live.replace(SECTION, (whole, name) => (fresh.has(name) ? (found.add(name), fresh.get(name)!) : whole));
  const missing = [...fresh.keys()].filter((n) => !found.has(n));
  if (missing.length) throw new Error(`the PR body has no r2-pr:${missing.join(", r2-pr:")} section; add the markers once by hand, then sync`);
  if (body === live) { console.log("unchanged"); process.exit(0); }
  const tmp = path.join(os.tmpdir(), `r2-pr-${number}.md`);
  writeFileSync(tmp, body);
  gh(["pr", "edit", number, "-R", repo, "--body-file", tmp]);
  console.log(`synced ${[...found].join(", ")} on ${repo}#${number}`);
} else {
  console.error("usage: body.ts preview <pr.md> <owner/repo> | finalize <pr.md> video=<url> image=<url> | sync <final.md> <owner/repo> <number>");
  process.exit(1);
}
