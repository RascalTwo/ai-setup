#!/usr/bin/env python3
"""transcribe-media — speech to text from a local audio/video file.

Prints a success header to stderr, then the path to the transcript on the last
stdout line. On failure prints `TRANSCRIBE_FAILED ...` and exits non-zero.

Engine is chosen by probing for it at runtime, not by checking the platform:
mlx_whisper when it is present (Apple Silicon), else whisper.cpp. Both load the
same Whisper weights, so quality tracks the model rather than the engine.
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

MLX_DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo"
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


def select_engine(requested):
    """Return (engine_name, binary). Probes capability rather than platform."""
    if requested in (None, "auto", "mlx_whisper"):
        mlx = shutil.which("mlx_whisper")
        if mlx and platform.machine() == "arm64":
            return "mlx_whisper", Path(mlx)
        if requested == "mlx_whisper":
            fail("mlx_whisper not found (brew install mlx_whisper)")
    if requested in (None, "auto", "whisper.cpp"):
        binary = find_whisper_cpp()
        if binary:
            return "whisper.cpp", binary
        if requested == "whisper.cpp":
            fail("whisper.cpp binary not found",
                 "  set WHISPER_CPP_BIN=<path to whisper-cli>, or WHISPER_CPP_DIR=<build tree>")
    fail("no transcription engine available",
         "  install mlx_whisper (Apple Silicon) or build/download whisper.cpp,",
         "  then set WHISPER_CPP_BIN if it is not on PATH")


def model_tag(model):
    """Short, stable folder suffix derived from the model name."""
    tag = Path(model).name
    for suffix in (".bin", ".gguf"):
        if tag.endswith(suffix):
            tag = tag[: -len(suffix)]
    for prefix in ("ggml-", "whisper-", "large-v3-"):
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


# --- whisper.cpp -> whisper-shaped json -----------------------------------


def words_from_tokens(tokens):
    """Merge whisper.cpp's subword tokens into words with timings.

    whisper.cpp emits tokens, not words; a token that does not begin with a
    space continues the previous word.
    """
    words = []
    for token in tokens:
        text = token.get("text", "")
        if not text.strip() or text.startswith("[_"):
            continue
        offsets = token.get("offsets") or {}
        start = offsets.get("from", 0) / 1000.0
        end = offsets.get("to", 0) / 1000.0
        if words and not text.startswith(" "):
            words[-1]["word"] += text
            words[-1]["end"] = end
        else:
            words.append({"word": text, "start": start, "end": end})
    return words


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
    if fmt in ("all", "tsv"):
        command.append("--output-csv")
    if language:
        command += ["-l", language]
    command += extra
    result = subprocess.run(command, **CAPTURE)
    log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        fail(f"whisper.cpp errored — see {log}", *(result.stderr.strip().splitlines()[-3:]))

    # Rewrite whisper.cpp's json in Whisper's own shape, so every consumer sees
    # one schema regardless of which engine produced it.
    json_path = out_base.with_suffix(".json")
    if json_path.is_file():
        raw = json.loads(json_path.read_text(encoding="utf-8"))
        if "transcription" in raw:
            result_json = whisper_cpp_to_result(raw)
            json_path.write_text(json.dumps(result_json, ensure_ascii=False), encoding="utf-8")
            if fmt in ("all", "txt") and not out_base.with_suffix(".txt").is_file():
                out_base.with_suffix(".txt").write_text(
                    "".join(seg["text"].strip() + "\n" for seg in result_json["segments"]),
                    encoding="utf-8")


ENGINES = {"mlx_whisper": run_mlx, "whisper.cpp": run_whisper_cpp}


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
    parser = argparse.ArgumentParser(
        prog="transcribe.py",
        description="Transcribe a local audio/video file to text.",
        epilog="Anything after -- is forwarded verbatim to the engine.")
    parser.add_argument("media", type=Path)
    parser.add_argument("--model", help="engine model (HF repo for mlx_whisper, ggml file for whisper.cpp)")
    parser.add_argument("--output-dir")
    parser.add_argument("--format", default="all", choices=FORMATS)
    parser.add_argument("--language", default="", help="e.g. en. Omit to auto-detect.")
    parser.add_argument("--keep-wav", action="store_true")
    parser.add_argument("--engine", choices=("auto", "mlx_whisper", "whisper.cpp"), default="auto")
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

    engine, binary = select_engine(args.engine)
    model = args.model or (MLX_DEFAULT_MODEL if engine == "mlx_whisper"
                           else os.environ.get("WHISPER_CPP_MODEL", ""))

    media = args.media.resolve()
    stem = media.stem
    outdir = Path(args.output_dir) if args.output_dir else media.parent / f"{stem}.transcript-{model_tag(model)}"
    outdir.mkdir(parents=True, exist_ok=True)
    wav = outdir / "audio.wav"
    log = outdir / "whisper.log"

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
