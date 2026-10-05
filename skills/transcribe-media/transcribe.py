#!/usr/bin/env python3
"""transcribe-media — speech to text from a local audio/video file.

Prints a success header to stderr, then the path to the transcript on the last
stdout line. On failure prints `TRANSCRIBE_FAILED ...` and exits non-zero.

Engine is chosen by probing for it at runtime, not by checking the platform —
the first of ENGINE_ORDER that is installed. Parakeet leads: more accurate on
meetings and trained to stay silent over silence, where Whisper loops. Whisper
stays as the fallback. Parakeet's own output is kept as `<stem>.parakeet.json`
(the source of truth); every other format is derived from it in Whisper's shape.
"""

import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_ORDER = ("parakeet-mlx", "mlx_whisper", "parakeet", "whisper.cpp")
DEFAULT_MODELS = {
    "parakeet-mlx": "mlx-community/parakeet-tdt-0.6b-v3",
    "mlx_whisper": "mlx-community/whisper-large-v3-turbo",
    "parakeet": "nemo-parakeet-tdt-0.6b-v3",  # onnx-asr's name for the same weights
}
# Parakeet v3 knows only these; anything else has to go to Whisper.
PARAKEET_LANGUAGES = set("bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk".split())
WHISPER_CPP_NAMES = ("whisper-cli", "main", "whisper")
FORMATS = ("txt", "vtt", "srt", "tsv", "json", "all")

# Whisper invents phrases over near-silent audio and loops on them. A looped
# transcript looks healthy by every structural measure, so the words are the
# only tell. Real transcripts here top out around 36 repeats; stuck ones start
# near 180.
STUCK_RUN = 50
STUCK_MIN_LINES = 20

# subprocess's text=True decodes with the *locale* encoding — cp1252 on Windows.
# One byte outside it raises inside the reader thread, which does not propagate:
# run() returns with that stream set to None, and the next line concatenating the
# two fails with "unsupported operand +: 'NoneType' and 'str'" a long way from the
# cause. Every tool here emits UTF-8, so say so. (Four catalogued recordings died
# on this, after their GPU time was already spent.)
CAPTURE = {"capture_output": True, "encoding": "utf-8", "errors": "replace"}


def fail(message, *extra):
    print(f"TRANSCRIBE_FAILED {message}", file=sys.stderr)
    for line in extra:
        print(line, file=sys.stderr)
    sys.exit(1)


# --- engines --------------------------------------------------------------


def find_whisper_cpp():
    """Locate a built whisper.cpp binary, or None."""
    explicit = os.environ.get("WHISPER_CPP_BIN")
    if explicit:
        return Path(explicit) if Path(explicit).is_file() else None
    for name in WHISPER_CPP_NAMES:
        found = shutil.which(name)
        if found:
            return Path(found)
    root = os.environ.get("WHISPER_CPP_DIR")
    if root:
        for name in WHISPER_CPP_NAMES:
            for candidate in Path(root).rglob(name + (".exe" if os.name == "nt" else "")):
                if candidate.is_file():
                    return candidate
    return None


def probe(engine):
    """The binary that runs `engine`, or None when it is not installed here."""
    if engine in ("parakeet-mlx", "mlx_whisper"):
        found = shutil.which(engine)
        return Path(found) if found and platform.machine() == "arm64" else None
    if engine == "parakeet":
        # Runs in-process, so it is available when this interpreter can import it.
        return Path(sys.executable) if importlib.util.find_spec("onnx_asr") else None
    return find_whisper_cpp()


INSTALL_HINTS = {
    "parakeet-mlx": "pip install parakeet-mlx (Apple Silicon)",
    "mlx_whisper": "brew install mlx_whisper (Apple Silicon)",
    "parakeet": 'pip install "onnx-asr[hub]" plus onnxruntime-gpu[cuda,cudnn] or onnxruntime',
    "whisper.cpp": "set WHISPER_CPP_BIN=<path to whisper-cli>, or WHISPER_CPP_DIR=<build tree>",
}


def select_engine(requested, language="", model=""):
    """Return (engine_name, binary): the first installed engine in ENGINE_ORDER.

    A --model names its family: callers that ask for Whisper weights (e.g.
    read-video-locally) must get a Whisper engine, not Parakeet.
    """
    if requested not in (None, "auto"):
        binary = probe(requested)
        if not binary:
            fail(f"{requested} not found ({INSTALL_HINTS[requested]})")
        if requested.startswith("parakeet") and language and language not in PARAKEET_LANGUAGES:
            fail(f"{requested} cannot transcribe language '{language}' (Parakeet v3 knows 25 European languages)")
        return requested, binary
    for engine in ENGINE_ORDER:
        if engine.startswith("parakeet") and language and language not in PARAKEET_LANGUAGES:
            continue
        if model and engine.startswith("parakeet") != ("parakeet" in model.lower()):
            continue
        binary = probe(engine)
        if binary:
            return engine, binary
    fail("no transcription engine available", *(f"  {e}: {INSTALL_HINTS[e]}" for e in ENGINE_ORDER))


def model_tag(model):
    """Short, stable folder suffix derived from the model name."""
    tag = Path(model).name
    for suffix in (".bin", ".gguf"):
        if tag.endswith(suffix):
            tag = tag[: -len(suffix)]
    for prefix in ("nemo-", "ggml-", "whisper-", "large-v3-"):
        if tag.startswith(prefix):
            tag = tag[len(prefix):]
    return tag or "model"


# --- audio ----------------------------------------------------------------


def extract_wav(media, wav, log):
    """Normalize any input to 16k mono wav, mixing every audio track.

    Screen recorders split mic/system/room across tracks and ffmpeg's default
    stream pick silently takes only one, so tracks are mixed explicitly. The mix
    is levelled to broadcast loudness because Whisper hallucinates repetition
    loops on far-field audio recorded far below -30 dB.
    """
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=index", "-of", "csv=p=0", str(media)],
        **CAPTURE)
    tracks = [line for line in probe.stdout.splitlines() if line.strip()]
    if not tracks:
        fail(f"no audio stream in {media.name}")

    labels = "".join(f"[0:a:{i}]" for i in range(len(tracks)))
    print(f"[transcribe-media] extracting 16k mono wav from {media.name} "
          f"(mixing {len(tracks)} audio track(s), normalizing loudness) ...", file=sys.stderr)
    result = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(media),
         "-filter_complex",
         f"{labels}amix=inputs={len(tracks)}:duration=longest:normalize=0,"
         f"loudnorm=I=-16:TP=-1.5:LRA=11[a]",
         "-map", "[a]", "-ac", "1", "-ar", "16000", str(wav)],
        **CAPTURE)
    if result.returncode != 0:
        log.write_text(result.stderr, encoding="utf-8")
        fail(f"ffmpeg could not decode audio from {media.name}", result.stderr.strip()[-500:])


# --- engine output -> whisper-shaped json ---------------------------------


def merge_words(pieces):
    """Merge (text, start, end) subword tokens into Whisper-style words.

    Both whisper.cpp and Parakeet emit tokens, not words; a token that does not
    begin with a space continues the previous word (so punctuation stays
    attached, as in Whisper's own " Hello,").
    """
    words = []
    for text, start, end in pieces:
        if not text.strip() or text.startswith("[_"):
            continue
        if words and not text.startswith(" "):
            words[-1]["word"] += text
            words[-1]["end"] = end
        else:
            words.append({"word": text, "start": start, "end": end})
    return words


def words_from_tokens(tokens):
    """whisper.cpp tokens (millisecond offsets) -> words."""
    return merge_words((t.get("text", ""), (t.get("offsets") or {}).get("from", 0) / 1000.0,
                        (t.get("offsets") or {}).get("to", 0) / 1000.0) for t in tokens)


def parakeet_to_result(raw, language):
    """Adapt Parakeet's {text, sentences[{text,start,end,tokens}]} to Whisper's shape.

    Parakeet does not report the language it detected, so `language` is what the
    caller asked for, or None when it was left to auto-detect.
    """
    segments = []
    for i, sentence in enumerate(raw.get("sentences", [])):
        segments.append({
            "id": i,
            "start": sentence["start"],
            "end": sentence["end"],
            "text": sentence["text"],
            "words": merge_words((t["text"], t["start"], t["end"]) for t in sentence.get("tokens", [])),
        })
    return {"text": "".join(seg["text"] for seg in segments), "segments": segments,
            "language": language or None}


def clock(seconds, separator):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{separator}{ms % 1000:03d}"


def write_outputs(result, outdir, stem, fmt):
    """Write the Whisper-shaped result in the requested format(s), as Whisper lays them out."""
    segments = [seg for seg in result["segments"] if seg["text"].strip()]
    writers = {
        "json": lambda: json.dumps(result, ensure_ascii=False),
        "txt": lambda: "".join(seg["text"].strip() + "\n" for seg in segments),
        "srt": lambda: "".join(f"{i}\n{clock(s['start'], ',')} --> {clock(s['end'], ',')}\n{s['text'].strip()}\n\n"
                               for i, s in enumerate(segments, start=1)),
        "vtt": lambda: "WEBVTT\n\n" + "".join(f"{clock(s['start'], '.')} --> {clock(s['end'], '.')}\n{s['text'].strip()}\n\n"
                                              for s in segments),
        "tsv": lambda: "start\tend\ttext\n" + "".join(
            f"{round(s['start'] * 1000)}\t{round(s['end'] * 1000)}\t{s['text'].strip().replace(chr(9), ' ')}\n"
            for s in segments),
    }
    for name, render in writers.items():
        if fmt in ("all", name):
            (outdir / f"{stem}.{name}").write_text(render(), encoding="utf-8")


def whisper_cpp_to_result(raw):
    """Adapt whisper.cpp's --output-json-full to OpenAI Whisper's result shape."""
    segments = []
    for i, item in enumerate(raw.get("transcription", [])):
        offsets = item.get("offsets") or {}
        segments.append({
            "id": i,
            "start": offsets.get("from", 0) / 1000.0,
            "end": offsets.get("to", 0) / 1000.0,
            "text": item.get("text", ""),
            "words": words_from_tokens(item.get("tokens") or []),
        })
    return {
        "text": "".join(seg["text"] for seg in segments),
        "segments": segments,
        "language": (raw.get("result") or {}).get("language", "en"),
    }


# --- transcription --------------------------------------------------------


def run_mlx(binary, wav, outdir, stem, model, fmt, language, extra, log):
    command = [str(binary), str(wav), "--model", model,
               "--output-dir", str(outdir), "--output-name", stem,
               "--output-format", fmt, "--word-timestamps", "True",
               # Whisper feeds each window's output back as the next window's
               # prompt, which is what lets a repetition loop sustain itself.
               "--condition-on-previous-text", "False"]
    if language:
        command += ["--language", language]
    command += extra
    result = subprocess.run(command, **CAPTURE)
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        fail(f"mlx_whisper errored — see {log}", *(result.stderr.strip().splitlines()[-3:]))


def run_whisper_cpp(binary, wav, outdir, stem, model, fmt, language, extra, log):
    if not model:
        fail("whisper.cpp needs a model file",
             "  pass --model <path to ggml-*.bin> or set WHISPER_CPP_MODEL")
    if not Path(model).is_file():
        fail(f"model file not found: {model}")

    out_base = outdir / stem
    command = [str(binary), "-m", str(model), "-f", str(wav), "-of", str(out_base),
               "--output-json", "--output-json-full"]
    if fmt in ("all", "txt"):
        command.append("--output-txt")
    if fmt in ("all", "srt"):
        command.append("--output-srt")
    if fmt in ("all", "vtt"):
        command.append("--output-vtt")
    if language:
        command += ["-l", language]
    command += extra
    result = subprocess.run(command, **CAPTURE)
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        fail(f"whisper.cpp errored — see {log}", *(result.stderr.strip().splitlines()[-3:]))

    # Rewrite whisper.cpp's json in Whisper's own shape, so every consumer sees
    # one schema regardless of which engine produced it.
    # Not with_suffix: a stem like "10.30 standup" would lose everything after its dot.
    json_path = outdir / f"{stem}.json"
    if json_path.is_file():
        raw = json.loads(json_path.read_text(encoding="utf-8"))
        if "transcription" in raw:
            result_json = whisper_cpp_to_result(raw)
            json_path.write_text(json.dumps(result_json, ensure_ascii=False), encoding="utf-8")
            # whisper.cpp has no tsv (its --output-csv is a different layout),
            # and txt can be missing; derive whatever was asked for and is absent.
            for name in ("txt", "srt", "vtt", "tsv"):
                if fmt in ("all", name) and not (outdir / f"{stem}.{name}").is_file():
                    write_outputs(result_json, outdir, stem, name)


def finish_parakeet(raw, outdir, stem, fmt, language):
    """Keep Parakeet's own output as the source of truth; derive the rest from it."""
    (outdir / f"{stem}.parakeet.json").write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    write_outputs(parakeet_to_result(raw, language), outdir, stem, fmt)


def run_parakeet_mlx(binary, wav, outdir, stem, model, fmt, language, extra, log):
    # Long audio is chunked by parakeet-mlx itself (120 s windows, 15 s overlap).
    command = [str(binary), str(wav), "--model", model, "--output-dir", str(outdir),
               "--output-format", "json"] + extra
    result = subprocess.run(command, **CAPTURE)
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    produced = outdir / f"{wav.stem}.json"
    if result.returncode != 0 or not produced.is_file():
        fail(f"parakeet-mlx errored — see {log}", *(result.stderr.strip().splitlines()[-3:]))
    raw = json.loads(produced.read_text(encoding="utf-8"))
    produced.unlink()
    finish_parakeet(raw, outdir, stem, fmt, language)


def split_sentences(tokens):
    """Group tokens into sentences ending at . ? !, as parakeet-mlx does, so a
    60 s chunk does not become one 60 s subtitle cue."""
    sentences, current = [], []
    for token in tokens:
        current.append(token)
        if token["text"].rstrip().endswith((".", "?", "!")):
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return [{"text": "".join(t["text"] for t in group), "start": group[0]["start"],
             "end": group[-1]["end"], "tokens": group} for group in sentences]


def run_parakeet_onnx(binary, wav, outdir, stem, model, fmt, language, extra, log):
    """Parakeet without MLX (the PC): onnx-asr, on CUDA when onnxruntime has it.

    Parakeet only takes ~20-30 s at a time, so a voice-activity detector cuts the
    audio into speech segments first. Results are rewritten into parakeet-mlx's
    shape so both Parakeet engines share one source-of-truth format.
    """
    if extra:
        fail("the onnx parakeet engine takes no extra engine flags", f"  got: {' '.join(extra)}")
    import onnx_asr
    import onnxruntime

    if hasattr(onnxruntime, "preload_dlls"):
        onnxruntime.preload_dlls()  # CUDA/cuDNN installed as pip wheels are not on the DLL path otherwise
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                 if p in onnxruntime.get_available_providers()]
    # Plain files in our own folder, not the Hugging Face cache: its snapshot is
    # symlinks into blobs/, and onnxruntime refuses external weights that resolve
    # outside the model's directory. onnx-asr downloads into a missing folder but
    # treats an existing one as complete, so `.complete` marks a finished download
    # and a folder without it (an interrupted download) is started over.
    cache = Path(os.environ.get("TRANSCRIBE_MEDIA_MODELS", Path.home() / ".cache" / "transcribe-media"))

    def load(loader, name):
        folder = cache / name.replace("/", "--")
        if not (folder / ".complete").is_file():
            shutil.rmtree(folder, ignore_errors=True)
        loaded = loader(name, folder, providers=providers)
        (folder / ".complete").touch()
        return loaded

    try:
        # Long chunks cut only at pauses. onnx-asr's defaults (20 s, split on any
        # 100 ms gap) hand Parakeet fragments so short it loses context — one
        # 4 s fragment of English came back as Russian. Measured on a 6 min
        # meeting against parakeet-mlx: defaults 85% word agreement, these 93%,
        # while parakeet-mlx against itself at other chunk sizes agrees 94%.
        asr = (load(onnx_asr.load_model, model)
               .with_vad(load(onnx_asr.load_vad, "silero"),
                         max_speech_duration_s=60, min_silence_duration_ms=10_000)
               .with_timestamps())
        sentences = []
        for seg in asr.recognize(str(wav)):
            # Token times are offsets into the chunk and mark each token's
            # start; a token ends where the next begins.
            starts = [seg.start + t for t in seg.timestamps or []]
            ends = starts[1:] + [seg.end]
            tokens = [{"text": tok, "start": s, "end": e} for tok, s, e in zip(seg.tokens or [], starts, ends)]
            sentences += split_sentences(tokens)
    except Exception as error:  # onnxruntime raises bare RuntimeErrors with the useful part inside
        log.write_text(repr(error), encoding="utf-8")
        fail(f"parakeet (onnx) errored: {error}")
    log.write_text(f"providers={providers}\n", encoding="utf-8")
    finish_parakeet({"text": "".join(s["text"] for s in sentences), "sentences": sentences},
                    outdir, stem, fmt, language)


ENGINES = {"parakeet-mlx": run_parakeet_mlx, "mlx_whisper": run_mlx,
           "parakeet": run_parakeet_onnx, "whisper.cpp": run_whisper_cpp}


def check_not_stuck(txt, keep_wav):
    """Fail rather than hand back a loop that reads as success."""
    if not txt.is_file():
        return
    longest, culprit, run, previous, lines = 0, "", 0, None, 0
    for line in txt.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        lines += 1
        run = run + 1 if line == previous else 1
        previous = line
        if run > longest:
            longest, culprit = run, line
    if lines >= STUCK_MIN_LINES and longest >= STUCK_RUN:
        fail(f'transcript is stuck repeating itself: "{culprit}" x{longest} in a row',
             "  Whisper looped instead of transcribing — usually near-silent or unintelligible audio.",
             "  Audio was already track-mixed and loudness-normalized, so try in order:",
             "    1. a more robust model (mlx-community/whisper-large-v3)",
             "    2. check the recording actually has audible speech",
             f"  Partial output kept for inspection: {txt}"
             + ("" if keep_wav else "  (add --keep-wav to also keep the audio)"))


def main(argv=None):
    # Piped stdio on Windows is cp1252, so printing a filename like "Team Venture：…"
    # raised UnicodeEncodeError before any work began. Callers read UTF-8 (see CAPTURE).
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        prog="transcribe.py",
        description="Transcribe a local audio/video file to text.",
        epilog="Anything after -- is forwarded verbatim to the engine.")
    parser.add_argument("media", type=Path)
    parser.add_argument("--model", help="engine model (HF repo for parakeet-mlx/mlx_whisper, onnx-asr name for "
                        "parakeet, ggml file for whisper.cpp). Naming one also picks its engine family.")
    parser.add_argument("--output-dir")
    parser.add_argument("--format", default="all", choices=FORMATS)
    parser.add_argument("--language", default="", help="e.g. en. Omit to auto-detect.")
    parser.add_argument("--keep-wav", action="store_true")
    parser.add_argument("--engine", choices=("auto",) + ENGINE_ORDER, default="auto")
    args, extra = parser.parse_known_args(argv)
    if extra and extra[0] == "--":
        extra = extra[1:]
    elif extra:
        parser.error(f"unknown option: {extra[0]}")

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            fail(f"{tool} not found (brew install ffmpeg / choco install ffmpeg)")
    if not args.media.is_file():
        fail(f"no such file: {args.media}")

    engine, binary = select_engine(args.engine, args.language, args.model or "")
    model = args.model or DEFAULT_MODELS.get(engine) or os.environ.get("WHISPER_CPP_MODEL", "")

    media = args.media.resolve()
    stem = media.stem
    outdir = Path(args.output_dir) if args.output_dir else media.parent / f"{stem}.transcript-{model_tag(model)}"
    outdir.mkdir(parents=True, exist_ok=True)
    wav = outdir / "audio.wav"
    log = outdir / "engine.log"

    try:
        if not wav.is_file() or media.stat().st_mtime > wav.stat().st_mtime:
            extract_wav(media, wav, log)

        print(f"[transcribe-media] transcribing with {model or engine} ...", file=sys.stderr)
        ENGINES[engine](binary, wav, outdir, stem, model, args.format, args.language, extra, log)
    finally:
        # The wav is ~100 MB per hour of audio. Remove it on every exit —
        # success, failure, or interrupt — since the failure paths are exactly
        # the ones that used to strand it.
        if not args.keep_wav:
            wav.unlink(missing_ok=True)

    extension = "txt" if args.format in ("all", "txt") else args.format
    out = outdir / f"{stem}.{extension}"
    if not out.is_file():
        candidates = [p for p in sorted(outdir.glob(f"{stem}.*"))
                      if p.suffix not in (".wav", ".log")]
        if not candidates:
            fail(f"no transcript produced — see {log}")
        out = candidates[0]

    txt = outdir / f"{stem}.txt"
    check_not_stuck(txt, args.keep_wav)

    words = len(txt.read_text(encoding="utf-8", errors="replace").split()) if txt.is_file() else "?"
    print(f"[transcribe-media OK] engine={engine} model={model} words={words} "
          f"format={args.format} -> {out.name}", file=sys.stderr)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
