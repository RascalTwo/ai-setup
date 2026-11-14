---
name: read-image-locally
description: "Reads an image with a local Ollama vision model (~0 Claude vision tokens) for structured extraction: dashboard values, tables, log or screenshot text, errors, labeled fields. Use for \"what does this say/show\". Not for layout or aesthetic judgment (read natively)."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    ollama: local vision model
  requires:
    commands: [ollama]
---

Offload image reading to a local vision model when the task is **structured extraction**, so it costs ~0 Claude vision tokens instead of the ~1–2k a native image `Read` adds to context every turn.

## The decision boundary (read this first)

Image reading is **intent-dependent**. The prompt you pass carries the intent — a local model is only as good as the extraction instruction you hand it.

- **Structured / known extraction → use this skill.** HUD/dashboard values, table contents, log or screenshot text, error messages, specific labeled fields, "what does this text say".
- **Holistic visual judgment → read natively with the `Read` tool.** Layout/aesthetics, "does this look right", subtle or ambiguous scenes, dense unfamiliar UIs, "why does this look off". A small local model returns a generic caption that silently misses these.

## Usage

```bash
python3 vision_judge.py <image> --prompt "<the specific extraction intent>" [--json] [--models lfm3-vl,gemma4:e4b,gemma4:12b] [--compare]
```

- Always pass the **specific** extraction intent as `--prompt` — never a generic "describe this image".
- Pass `--json` when you expect a structured shape; the engine validates the output is real JSON.
- Models are tried in tier order, cheap/fast first. Default `lfm3-vl,gemma4:e4b,gemma4:12b`.
- `--compare` asks every model instead (default `lfm3-vl,gemma4:e4b`), prints each answer under its own header, then `[read-image-locally COMPARE] agree` or `differ`. Use it when a wrong answer would cost more than the extra seconds.

## Which model is good at what

Measured on 114 questions (generated screenshots plus the user's own; `eval/`, results in `~/.agents/state/read-image-locally/vision-bench/`). Overall the two are even (`lfm3-vl` 90.0% vs `gemma4:e4b` 89.3% on real screenshots), and `lfm3-vl` is about 2.7x faster, so it goes first.

- **Charts, tables, code, absent-or-present questions:** `lfm3-vl`. It read every chart value; `e4b` missed all the hardest ones.
- **Exact long strings (hashes, UUIDs, timestamps, commit ids, product keys):** `lfm3-vl` drops characters (`T18:44:52` read as `T44:52`) and `e4b` is better (56% vs 33%), but neither is reliable. Use `--compare`; on `differ`, or when the value matters, read the image natively.
- The fallback only fires on an error, never on a wrong answer, so a confident wrong ID from the first tier comes back as `OK`.
- `gemma4:12b` stays as the last local tier but was not shown to be more accurate, and was 5-20x slower.

To score a new model: `python3 eval/run.py --models lfm3-vl,gemma4:e4b,<new>` (one command; it adds a row to the existing results).

On success it prints a header line `[read-image-locally OK] model=… <latency>` followed by the answer.

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
`Read` tool** — read-image-locally is an optimization, never a hard dependency.

Tier order: `lfm3-vl` → `gemma4:e4b` → `gemma4:12b` → native Claude.

## Prerequisites

- Ollama reachable at `http://localhost:11434` with the tier models pulled
  (`ollama pull lfm3-vl`, plus the gemma4 fallbacks). Check: `curl -s localhost:11434/api/tags`.

## Tests

`tests/run-tests.sh` verifies the engine (success + failure paths). Run it after changing the engine.
