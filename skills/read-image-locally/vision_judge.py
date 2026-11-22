#!/usr/bin/env python3
"""Tiered read-image-locally reader: try local Ollama vision models first; signal fallback to native Claude.

Lets an agent offload image reading (expensive in vision tokens) to a local model when a local
model can do the job, and fall back to native image reading when it can't.

Usage:
  vision_judge.py <image> [--prompt "what to extract"] [--models lfm3-vl,gemma4:e4b,gemma4:12b] [--json] [--compare]

Prints a header line ([read-image-locally OK] model=... <latency>) then the model's answer.
On total local failure prints 'LOCAL_VISION_FAILED ...' and exits non-zero — the caller should
then read the image natively. Tiers are tried in order (cheap/fast first).
--compare asks every model instead (default lfm3-vl,gemma4:e4b), prints each answer under its own
header, then '[read-image-locally COMPARE] agree' or 'differ'.
"""
import argparse, base64, json, sys, time, urllib.request

OLLAMA = "http://localhost:11434/api/generate"
DEFAULT_PROMPT = (
    "Describe this image's key content. If it is a UI / HUD / dashboard / screenshot, extract the "
    "visible text labels with their values and any prominent colors, concisely."
)


def call(model: str, b64: str, prompt: str, want_json: bool):
    body = {"model": model, "prompt": prompt, "images": [b64], "stream": False,
            "keep_alive": "30m", "options": {"temperature": 0}}
    if want_json:
        body["format"] = "json"
    # Qwen3 reasoning models hide their answer in `thinking` under format:json — disable thinking
    # and let them emit the answer in `response` instead.
    if "qwen" in model.lower():
        body["think"] = False
        body.pop("format", None)
    req = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    txt = (r.get("response") or "").strip() or (r.get("thinking") or "").strip()
    if not txt:
        raise ValueError("empty response")
    if want_json:
        json.loads(txt)  # validate it really is JSON
    return txt, time.time() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    ap.add_argument("--models", default=None,
                    help="comma-separated tier order, cheap/fast first (default lfm3-vl,gemma4:e4b,gemma4:12b)")
    ap.add_argument("--compare", action="store_true",
                    help="ask every model and print all answers (default models lfm3-vl,gemma4:e4b)")
    ap.add_argument("--json", action="store_true", help="require valid JSON output")
    a = ap.parse_args()

    try:
        b64 = base64.b64encode(open(a.image, "rb").read()).decode()
    except OSError as e:
        print(f"LOCAL_VISION_FAILED: cannot read image: {e}")
        sys.exit(2)

    models = a.models or ("lfm3-vl,gemma4:e4b" if a.compare else "lfm3-vl,gemma4:e4b,gemma4:12b")
    answers = []
    for model in [m.strip() for m in models.split(",") if m.strip()]:
        try:
            txt, dt = call(model, b64, a.prompt, a.json)
            print(f"[read-image-locally OK] model={model} {dt:.1f}s")
            print(txt)
            if not a.compare:
                return
            answers.append(" ".join(txt.lower().split()))
        except Exception as e:
            print(f"[read-image-locally tier failed] model={model}: {e}", file=sys.stderr)

    if answers:
        verdict = "agree" if len(set(answers)) == 1 else "differ"
        print(f"[read-image-locally COMPARE] {verdict} ({len(answers)} answered)")
        return

    print("LOCAL_VISION_FAILED: all local tiers failed — fall back to native image reading")
    sys.exit(3)


if __name__ == "__main__":
    main()
