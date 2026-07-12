---
name: local-vision
description: Read an image with a LOCAL Ollama vision model (~0 Claude vision tokens) instead of a native image Read, for STRUCTURED extraction — HUD/dashboard values, table contents, log/screenshot text, error messages, reading specific labeled fields, "what does this say/show". Use when you need known information out of an image, or when the user says "read/vision-recognize this image locally". Do NOT use for holistic visual judgment (layout, aesthetics, "does this look right") — read those natively.
---

Offload image reading to a local vision model when the task is **structured extraction**, so it costs ~0 Claude vision tokens instead of the ~1–2k a native image `Read` adds to context every turn.

## The decision boundary (read this first)

Image reading is **intent-dependent**. The prompt you pass carries the intent — a local model is only as good as the extraction instruction you hand it.

- **Structured / known extraction → use this skill.** HUD/dashboard values, table contents, log or screenshot text, error messages, specific labeled fields, "what does this text say".
- **Holistic visual judgment → read natively with the `Read` tool.** Layout/aesthetics, "does this look right", subtle or ambiguous scenes, dense unfamiliar UIs, "why does this look off". A small local model returns a generic caption that silently misses these.

## Usage

```bash
python3 vision_judge.py <image> --prompt "<the specific extraction intent>" [--json] [--models gemma4:e4b,gemma4:12b]
```

- Always pass the **specific** extraction intent as `--prompt` — never a generic "describe this image".
- Pass `--json` when you expect a structured shape; the engine validates the output is real JSON.
- Models are tried in tier order, cheap/fast first. Default `gemma4:e4b,gemma4:12b`.

On success it prints a header line `[local-vision OK] model=… <latency>` followed by the answer.

```bash
# Read HUD values out of a screenshot
python3 vision_judge.py /tmp/frame.png --prompt "Extract the SCORE and LIVES values."

# Force a structured shape
python3 vision_judge.py /tmp/dash.png --json \
  --prompt 'Return {"cpu_pct":int,"mem_pct":int} from this dashboard.'
```

## Fallback

If every local tier fails (Ollama down, model missing, empty/invalid output), the engine prints
`LOCAL_VISION_FAILED …` and exits non-zero. When that happens, **read the image natively with the
`Read` tool** — local-vision is an optimization, never a hard dependency.

Tier order: `gemma4:e4b` → `gemma4:12b` → native Claude.

## Prerequisites

- Ollama reachable at `http://localhost:11434` with the tier models pulled
  (`ollama pull gemma4:e4b`). Check: `curl -s localhost:11434/api/tags`.

## Policy

The authoritative local-vision-first policy lives in `AGENTS.md §9` — read by both Claude Code and
Codex, so the routing guidance reaches any agent by prompting (no hook).

## Tests

`tests/run-tests.sh` verifies the engine (success + failure paths). Run it after changing the engine.
