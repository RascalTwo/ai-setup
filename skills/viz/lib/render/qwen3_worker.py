"""Batch local Qwen3-TTS reference-clone requests for PR Viz."""
import json
import pathlib
import sys
from contextlib import redirect_stdout

from mlx_audio.tts.generate import generate_audio
from mlx_audio.tts.utils import load_model

model_id, reference, transcript = sys.argv[1:4]
requests = json.load(sys.stdin)
model = load_model(model_id)
for request in requests:
    target = pathlib.Path(request["out"])
    target.parent.mkdir(parents=True, exist_ok=True)
    with redirect_stdout(sys.stderr):
        generate_audio(
            text=request["text"], model=model, max_tokens=512, voice="af_heart",
            speed=request["speed"], lang_code="English", ref_audio=reference,
            ref_text=transcript, output_path=str(target.parent),
            file_prefix=target.stem, audio_format="wav", join_audio=True,
            verbose=False, stt_model=None, temperature=0.0,
        )
    generated = target.parent / f"{target.stem}.wav"
    if generated != target:
        generated.replace(target)
    if not target.exists() or target.stat().st_size < 1000:
        raise RuntimeError(f"Qwen3 produced no audio for {target}")
    print(f"✓ {target}", file=sys.stderr, flush=True)
