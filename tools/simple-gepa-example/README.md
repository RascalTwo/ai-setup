---
rascaltwo-ai-setup:
  kind: tool
  state: false
  requires:
    commands: [uv, docker, ollama]
---

# simple-gepa-example

A minimal [GEPA](https://dspy.ai/api/optimizers/GEPA/overview/) run in DSPy on a toy sentiment task: a signature with no instructions and badly named fields, a judge that writes feedback on each wrong answer, and GEPA rewriting the prompt from that feedback. Every call is traced into a local [Phoenix](https://phoenix.arize.com/) so you can watch the optimizer read its own mistakes.

It is a worked example to read and run, not something the installer wires up.

## Run

```sh
cd ~/.agents/ai-setup/tools/simple-gepa-example
docker compose up -d --wait    # Phoenix on http://localhost:6006
uv run simple_gepa_example.py
```

Knobs at the top of `simple_gepa_example.py`:

- `LM_KIND`: `ollama` (default, `qwen3:8b` on `localhost:11434`) or `bedrock` (needs AWS credentials in the environment).
- `JUDGE_KIND`: `llm` has a model explain each miss; `rules` explains it from fixed sentiment word lists.
- `TOTAL_EXAMPLES`: how many of the built-in labelled sentences to use.

Pinned to `dspy==3.0.3`; `uv.lock` holds the rest.
