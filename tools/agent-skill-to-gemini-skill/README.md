---
rascaltwo-ai-setup:
  kind: tool
  state: false
  integrates:
    gemini-app: skill upload (manual)
  requires:
    commands: [python3]
---
# agent-skill-to-gemini-skill

Turns any Agent Skill folder into two things for the Gemini app: a skill to upload (folder and zip), and a megaprompt to paste into a chat. **For a skill with pictures, use the megaprompt:** Gemini skills garble pictures, so the converter warns whenever a skill has any.

```sh
python3 tools/agent-skill-to-gemini-skill/agent-skill-to-gemini-skill.py path/to/my-skill --out dist/gemini [--image-urls map.json] [--strip-urls]
# → dist/gemini/my-skill/, dist/gemini/my-skill.zip and dist/gemini/my-skill.megaprompt.md; exit 1 if a rule is broken
```

Needs `python3` and ImageMagick's `magick` (`brew install imagemagick`) when the skill has pictures.

## Why

Gems are being retired (personal accounts lose them on 2026-12-17, Workspace in 2027), and Gemini skills use the same `SKILL.md` format as everyone else. But the Gemini app is stricter than its docs, measured on 2026-10-23:

- **It loads only `SKILL.md` and images.** A skill with any other text file (`references/*.md`, scripts, CSS) uploads fine and then "failed to load" in chat. Images load and Gemini can see them.
- **Uploads allow 47 extensions, 100 files, 100 MiB.** One other file, such as a font, a `.toml` or a `LICENSE`, rejects the whole upload.

Evidence, including the rules read from Gemini's own code: [skills-anywhere provenance](https://github.com/RascalTwo/explorables/blob/main/viz-pages/skills-anywhere/provenance/gemini-measured-2026-10-23.md).

## What it does

1. Lists the skill's files: `git ls-files` when the skill is in a repo (so `node_modules` and logs never count), otherwise everything. Skips `.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`, `__MACOSX/`, and paths matched by `.geminiignore` or `--exclude`.
2. Inlines every UTF-8 file other than `SKILL.md` at the end of it under `## FILE: <path>`, in a fence longer than any inside it, and adds one line telling the model to read those sections where the instructions name a path. Inlining also sidesteps the extension list. Other binary files (fonts, wasm) are dropped with a warning on stderr; PDFs stay as files.
3. Writes the **megaprompt**, `<out>/<name>.megaprompt.md`: `.gemini-preamble.md`, then `SKILL.md` with its included files, then an `IMAGE CATALOG` of the links `--image-urls` gives. Each mapped picture path in the text becomes its link. Pictures without a link are left out with a warning. Web addresses stay.
4. Writes the **skill**, `<out>/<name>/` and `<out>/<name>.zip`: each picture is shrunk to a palette PNG (`magick in -strip -colors 256 PNG8:out`) and written into `SKILL.md` as a `data:image/png;base64,...` URI wherever its path appears, plus a short `# Pictures` section (a row for any picture no text names). No image files are shipped. A picture still over 3 KB after shrinking is left out with a warning naming it.
5. Refuses the skill (exit 1, every `file:line` and address listed; the megaprompt is still written) if `SKILL.md`, its frontmatter, `.gemini-preamble.md` or an inlined file holds `http://` or `https://`. `--strip-urls` writes it without them instead and lists what it removed.
6. Checks: name is lowercase-with-hyphens, ≤ 100 files, ≤ 100 MiB, every remaining extension on Gemini's list. The zip has the folder at the top and fixed timestamps, so an unchanged skill gives a byte-identical zip and megaprompt (CI can diff them).

`.geminiignore` sits in the skill folder: gitignore-style globs, one per line, `#` comments, `!` re-includes, last match wins. A repo can also treat its presence as "convert this skill".

`--image-urls map.json` maps picture paths to hosted links, for the megaprompt only: `{"assets/logo.png": "https://lh3.googleusercontent.com/d/<drive-file-id>"}`. The 2026-10-31 runs used `lh3` links to files in a Drive folder. A key that isn't a picture in the skill fails the run and names it. The converter never uploads anything.

## Skills that build pages

Measured on the Gemini app, a Workspace account, 2026-10-31:

- **Call the skill with `@name`.** That opens a real Canvas panel, even when the prompt never says "Canvas". Picking Canvas from the + menu first hides skills ("Avatar, Skills and Connectors are not available"). Google's [help page 18560919](https://support.google.com/gemini/answer/18560919) still says skills don't work with Canvas; it's wrong.
- **Use Pro.** Only 3.1 Pro made Canvas pages from a skill; Flash errored and Thinking came back empty (one run each). Pro has a usage limit (hit once that day, with a reset time shown); plan live runs around it.
- **No web addresses in a skill.** Any `http(s)://` URL in a skill's text made the answer come back empty (7 of 7 runs), and the skills editor won't save text containing `https://`. Splitting the address didn't help. Gemini's own output may still contain URLs (it added a Tailwind CDN script); only the skill's text breaks it. Hence the refusal and `--strip-urls`.
- **Bundled images don't show.** A Canvas page pointing at a skill's `assets/x.png` shows a broken image (0 of 2).
- **Small data URIs sometimes do.** Gemini copies a data URI character by character, and sometimes gets a character wrong, which breaks that picture. Earlier probes using up to 1.6 KB of shrunk pictures were exact; in the final runs with this converter, three icons (1.9 KB and 5.7 KB in total) came back with one icon garbled each time (2 of 2 runs); a page using ten icons (18 KB) was fully right 1 of 2 runs and took 10-13 minutes; an unshrunk 6.4 KB picture failed 0 of 2. So a skill's pictures are best effort; the 3 KB cap is a constant at the top of the script.
- **The megaprompt is the dependable route for pictures.** The same three icons as `lh3` Drive links, pasted, came out right first time. Earlier, a 44 KB slide-deck megaprompt with ten `lh3` Drive links, pasted into a normal chat on Pro, built the deck with its real logo, icons and quote mark, 2 of 2 runs, about a minute each.
- **Canvas sometimes answers as a code block** instead of opening the panel; ask again.

### `.gemini-preamble.md`

Gemini-only wording, kept in the skill folder beside `.geminiignore`. The converter puts its text at the very top of both outputs and neither inlines nor ships the file. It adds no wording of its own. A template for a page-building skill:

```markdown
You are running in the Gemini app: there is no shell, no file system and no browser to open. Ignore any step below about running scripts, copying files or opening a browser. The page you build is a Canvas page: one self-contained HTML file with all CSS and JS inline. Put it in Canvas.

PICTURES: use only the pictures given below, exactly as written, as the `<img src>`. Never write a file path, invent a link or id, or make up base64.
```

## Limits

- It doesn't rewrite the instructions beyond pictures and web addresses. Text written for an agent with a shell ("run `scripts/x.sh`", "open it in the browser") still says so; `.gemini-preamble.md` is where to tell Gemini to ignore it.
- It doesn't host anything: the megaprompt's links come from whoever hosts the pictures.
- PDFs are kept as files but weren't tested at load time.
- The rules are a snapshot (Gemini build `20261022.15`, and the 2026-10-31 Canvas runs). Google can change them; a real run is the final test.

Test: `sh tools/agent-skill-to-gemini-skill/agent-skill-to-gemini-skill.test.sh`.
