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

Turns any Agent Skill folder into one the Gemini app both accepts and can load, as a folder and a zip ready to upload.

```sh
python3 tools/agent-skill-to-gemini-skill/agent-skill-to-gemini-skill.py path/to/my-skill --out dist/gemini
# → dist/gemini/my-skill/ and dist/gemini/my-skill.zip; exit 1 if a rule is broken
```

## Why

Gems are being retired (personal accounts lose them on 2026-12-17, Workspace in 2027), and Gemini skills use the same `SKILL.md` format as everyone else. But the Gemini app is stricter than its docs, measured on 2026-10-23:

- **It loads only `SKILL.md` and images.** A skill with any other text file (`references/*.md`, scripts, CSS) uploads fine and then "failed to load" in chat. Images load and Gemini can see them.
- **Uploads allow 47 extensions, 100 files, 100 MiB.** One other file, such as a font, a `.toml` or a `LICENSE`, rejects the whole upload.

Evidence, including the rules read from Gemini's own code: [skills-anywhere provenance](https://github.com/RascalTwo/explorables/blob/main/viz-pages/skills-anywhere/provenance/gemini-measured-2026-10-23.md).

## What it does

1. Lists the skill's files: `git ls-files` when the skill is in a repo (so `node_modules` and logs never count), otherwise everything. Skips `.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`, `__MACOSX/`, and paths matched by `.geminiignore` or `--exclude`.
2. Keeps images and PDFs as files. Inlines every other UTF-8 file at the end of `SKILL.md` under `## FILE: <path>`, in a fence longer than any inside it, and adds one line telling the model to read those sections where the instructions name a path. Inlining also sidesteps the extension list.
3. Drops other binary files (fonts, wasm) with a warning on stderr.
4. Checks: name is lowercase-with-hyphens, ≤ 100 files, ≤ 100 MiB, every remaining extension on Gemini's list.
5. Writes `<out>/<name>/` and `<out>/<name>.zip` with the folder at the top and fixed timestamps, so an unchanged skill gives a byte-identical zip (CI can diff it).

`.geminiignore` sits in the skill folder: gitignore-style globs, one per line, `#` comments, `!` re-includes, last match wins. A repo can also treat its presence as "convert this skill".

## Limits

- Built but parked: in the Gemini app, skills "do not yet work with features like Canvas and Deep Research" ([Google](https://support.google.com/gemini/answer/18560919), checked 2026-10-23), so a skill that builds pages (viz, branded-slides) can't show them there. Those keep their Gems until that changes.
- It doesn't rewrite the instructions. Text written for an agent with a shell ("run `scripts/x.sh`", "open it in the browser") still says so; put Gemini-specific wording in the skill or a wrapper.
- It doesn't host anything. A skill with more than 99 images needs `.geminiignore` or images on the web.
- PDFs are kept as files but weren't tested at load time.
- The rules are a snapshot of Gemini build `20261022.15`. Google can change them; a real upload is the final test.

Test: `sh tools/agent-skill-to-gemini-skill/agent-skill-to-gemini-skill.test.sh`.
