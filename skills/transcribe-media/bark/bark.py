"""Bark 3.0 Pro, run by bark/build.sh's venv (not by transcribe.py's interpreter).

  bark.py convert <pro-snapshot-dir> <base-mlx-dir> <out-dir>   macOS: safetensors -> mlx-audio Parakeet folder
  bark.py run <model-dir> <in.wav> <out.json>                    chunked decode -> parakeet-mlx-shaped json

`run` uses MLX on macOS and the vendor's PyTorch/transformers path elsewhere (CUDA on the PC); both
chunk, shift and cut cues identically so the two machines produce matching transcripts.

The renames are those of the vendor's bark_mlx.py (ConwayResearch/Underdog-Bark-3.0, CC-BY-4.0).
"""
import json
import re
import shutil
import sys

import numpy as np

PAD_S = 0.25                  # the model was evaluated with 0.25 s of leading silence; timestamps shift by it
CHUNK_S, OVERLAP_S = 120.0, 15.0   # whole-file decode needs 18.7 GB for 10 min; chunked stays near 3.4 GB
CUE_S, CUE_MAX_S = 15.0, 25.0      # Bark leaves minutes of unpunctuated speech in one "sentence"; cut cues here

RENAMES = [
    (r"encoder\.subsampling\.layers\.", "encoder.pre_encode.conv."), (r"encoder\.subsampling\.linear\.", "encoder.pre_encode.out."),
    (r"\.conv\.norm\.", ".conv.batch_norm."), (r"\.q_proj\.", ".linear_q."), (r"\.k_proj\.", ".linear_k."),
    (r"\.v_proj\.", ".linear_v."), (r"\.o_proj\.", ".linear_out."), (r"\.relative_k_proj\.", ".linear_pos."),
    (r"\.bias_u$", ".pos_bias_u"), (r"\.bias_v$", ".pos_bias_v"), (r"^decoder\.embedding\.", "decoder.prediction.embed."),
    (r"^encoder_projector\.", "joint.enc."), (r"^decoder\.decoder_projector\.", "joint.pred."), (r"^joint\.head\.", "joint.joint_net.2."),
]


def to_mlx_names(sd):
    out = {}
    for k, v in sd.items():
        if k.endswith("num_batches_tracked") or k.startswith("vad_head"):
            continue
        m = re.match(r"decoder\.lstm\.(weight_ih|weight_hh|bias_ih|bias_hh)_l(\d)", k)
        if m:
            kind, i = m.groups()
            base = f"decoder.prediction.dec_rnn.lstm.{i}"
            if kind == "weight_ih":
                out[f"{base}.Wx"] = v
            elif kind == "weight_hh":
                out[f"{base}.Wh"] = v
            else:
                out[f"{base}.bias"] = out.get(f"{base}.bias", 0) + v
            continue
        if re.search(r"encoder\.subsampling\.layers\.\d+\.weight$", k):
            v = v.transpose(0, 2, 3, 1)
        if re.search(r"conv\.(depthwise_conv|pointwise_conv[12])\.weight$", k):
            v = v.transpose(0, 2, 1)
        for pat, rep in RENAMES:
            k = re.sub(pat, rep, k)
        out[k] = v
    return out


def convert(src, base_mlx, out):
    import mlx.core as mx
    shutil.copytree(base_mlx, out, dirs_exist_ok=True)   # config.json + tokenizer files; Pro ships only config.json
    sd = {k: np.array(v.astype(mx.float32)) for k, v in mx.load(f"{src}/model.safetensors").items()}
    mx.save_safetensors(f"{out}/model.safetensors",
                        {k: mx.array(v).astype(mx.float16) for k, v in to_mlx_names(sd).items()})


def cues(tokens):
    """Cut one run of tokens into cues of at most CUE_MAX_S, preferably at a comma or a pause after CUE_S."""
    groups, cur = [], []
    for t in tokens:
        if cur and t["text"].startswith(" ") and t["start"] - cur[0]["start"] >= CUE_S and (
                t["start"] - cur[-1]["end"] >= 0.3 or cur[-1]["text"].rstrip().endswith(",")
                or t["start"] - cur[0]["start"] >= CUE_MAX_S):
            groups.append(cur)
            cur = []
        cur.append(t)
    return groups + [cur]


def run_mlx(model_dir, wav, out):
    import mlx.core as mx
    import soundfile as sf
    from mlx_audio.stt import load
    mx.set_cache_limit(512 * 2**20)  # unbounded, MLX keeps every freed chunk buffer: 6 GB footprint on 60 min
    model = load(model_dir, strict=True, model_type="parakeet")
    mx.eval(model.parameters())
    data, rate = sf.read(wav, dtype="float32")  # transcribe.py hands over 16 kHz mono
    assert rate == 16000 and data.ndim == 1, f"{wav} is not 16 kHz mono"
    audio = mx.array(np.concatenate([np.zeros(int(PAD_S * 16000), np.float32), data]))
    del data
    result = model.generate(audio, dtype=mx.bfloat16, chunk_duration=CHUNK_S,
                            overlap_duration=OVERLAP_S, verbose=False)
    sentences = []
    for s in result.sentences:
        toks = [{"text": t.text, "start": max(0.0, t.start - PAD_S), "end": max(0.0, t.end - PAD_S)} for t in s.tokens]
        for g in cues(toks) if toks else []:
            sentences.append({"text": "".join(t["text"] for t in g), "start": g[0]["start"],
                              "end": g[-1]["end"], "tokens": g})
    json.dump({"text": "".join(s["text"] for s in sentences), "sentences": sentences}, open(out, "w"))


FRAME_S = 0.08   # one encoder frame: 8x subsampling of 10 ms


def sentences(tokens):
    """Group tokens into sentences ending at . ? !, then cut long ones into cues."""
    out, cur = [], []
    for t in tokens + [None]:
        if t is not None:
            cur.append(t)
        if cur and (t is None or t["text"].rstrip().endswith((".", "?", "!"))):
            for g in cues(cur):
                out.append({"text": "".join(x["text"] for x in g), "start": g[0]["start"],
                            "end": g[-1]["end"], "tokens": g})
            cur = []
    return out


def merge(acc, new, edge):
    """Join two chunks' tokens at the quietest gap near the middle of their overlap (edge = overlap start)."""
    lo, hi = edge + OVERLAP_S / 2 - 4, edge + OVERLAP_S / 2 + 4
    gaps = [((a["end"] + b["start"]) / 2, b["start"] - a["end"]) for a, b in zip(acc, acc[1:])
            if lo <= a["end"] <= hi]
    cut = max(gaps, key=lambda g: g[1])[0] if gaps else edge + OVERLAP_S / 2
    return [t for t in acc if t["start"] < cut] + [t for t in new if t["start"] >= cut]


def run_torch(model_dir, wav, out):
    import soundfile as sf
    import torch
    from transformers import AutoProcessor, ParakeetForTDT
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    proc = AutoProcessor.from_pretrained(model_dir, local_files_only=True)
    model = ParakeetForTDT.from_pretrained(model_dir, dtype=dtype, local_files_only=True).to(device).eval()
    blank = proc.tokenizer.convert_tokens_to_ids("<blank>")
    data, rate = sf.read(wav, dtype="float32")  # transcribe.py hands over 16 kHz mono
    assert rate == 16000 and data.ndim == 1, f"{wav} is not 16 kHz mono"
    pad, step = np.zeros(int(PAD_S * 16000), np.float32), CHUNK_S - OVERLAP_S
    acc, start = [], 0.0
    while True:
        chunk = np.concatenate([pad, data[int(start * 16000):int((start + CHUNK_S) * 16000)]])
        inputs = proc(chunk, sampling_rate=16000, return_tensors="pt").to(device, dtype)
        with torch.inference_mode():
            gen = model.generate(**inputs)
        ids, dur = gen.sequences[0].tolist(), gen.durations[0].tolist()
        frame, toks = 0, []
        for i, d in zip(ids, dur):
            piece = proc.tokenizer.convert_ids_to_tokens(i) if i < blank else "<"  # blank and the start id sit above the vocab
            if not piece.startswith("<"):
                piece = piece.replace("\u2581", " ")
                t0 = start - PAD_S + frame * FRAME_S
                toks.append({"text": piece, "start": round(max(0.0, t0), 3), "end": round(max(0.0, t0 + d * FRAME_S), 3)})
            frame += d
        acc = toks if not acc else merge(acc, toks, start)
        if start + CHUNK_S >= len(data) / 16000:
            break
        start += step
    out_s = sentences(acc)
    json.dump({"text": "".join(s["text"] for s in out_s), "sentences": out_s}, open(out, "w"))


def run(*args):
    (run_mlx if sys.platform == "darwin" else run_torch)(*args)


if __name__ == "__main__":
    {"convert": convert, "run": run, "run_torch": run_torch}[sys.argv[1]](*sys.argv[2:])
