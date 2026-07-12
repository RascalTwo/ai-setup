---
name: extract-video-subtitles
version: 1.0.0
description: "Extract embedded subtitle/caption tracks from a local video or audio file using FFmpeg. Use this skill when the user has a video file (MP4, MKV, WebM, etc.) and wants to extract the subtitles or captions as a separate text file (WebVTT, SRT). Common use case: extracting auto-generated captions from a downloaded Google Meet recording. Also use when the user mentions 'get subtitles from video', 'extract captions', 'rip subs', or has a recording with embedded closed captions they want as text."
---

# Video Subtitle Extractor

Extract embedded subtitle or caption tracks from local video/audio files using FFmpeg. Outputs WebVTT (.vtt) or SRT (.srt) format.

This is useful when someone has already downloaded a video file that contains embedded captions — like a Google Meet recording downloaded from Google Drive, or any video with baked-in subtitles.

## Requirements

- **FFmpeg** must be installed (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux)
- A local video/audio file with embedded subtitle tracks

## Input

The user provides a file path:

```
$ARGUMENTS
```

If no path is provided, ask the user for the path to their video file.

## Workflow

### 1. Probe for subtitle streams

Use `ffprobe` to check what subtitle tracks exist in the file:

```bash
ffprobe -v quiet -print_format json -show_streams -select_streams s "$FILE_PATH"
```

This returns JSON with all subtitle streams. Each stream has:
- `index` — stream number
- `codec_name` — format (e.g., `webvtt`, `subrip`, `ass`, `mov_text`)
- `tags.language` — language code if available
- `tags.title` — description if available

If no subtitle streams are found, tell the user the file doesn't have embedded captions. Suggest they try the `extract-gdrive-transcript` skill instead if it's a Google Meet recording they haven't downloaded yet.

### 2. Show available tracks

If there are multiple subtitle streams, show the user what's available and ask which one to extract:

```
Found 2 subtitle streams:
  Stream 0: webvtt (English)
  Stream 1: subrip (Spanish)
Which stream would you like to extract? (default: 0)
```

If there's only one stream, use it automatically.

### 3. Extract the subtitle track

Extract as WebVTT (preferred, supports voice/speaker tags) with SRT as fallback:

**Try WebVTT first:**
```bash
ffmpeg -i "$FILE_PATH" -map 0:s:$STREAM_INDEX -c:s webvtt -f webvtt pipe:1 2>/dev/null
```

If the codec doesn't support WebVTT conversion, fall back to SRT:
```bash
ffmpeg -i "$FILE_PATH" -map 0:s:$STREAM_INDEX -c:s srt -f srt pipe:1 2>/dev/null
```

### 4. Save the output

Save the extracted subtitles to a file alongside the input video, or to a user-specified location:

- Default name: same as input file but with `.vtt` or `.srt` extension
- Example: `recording.mp4` → `recording.vtt`

```bash
ffmpeg -i "$FILE_PATH" -map 0:s:$STREAM_INDEX -c:s webvtt "$OUTPUT_PATH" -y 2>/dev/null
```

### 5. Report

Tell the user:
- Where the file was saved
- The format (WebVTT or SRT)
- The file size
- A preview of the first few entries so they can verify it looks correct

## Notes

- WebVTT is preferred over SRT because it supports `<v Speaker>` voice tags for speaker attribution. Google Meet captions use WebVTT internally, so extracting from Meet recordings preserves speaker names.
- If the extracted subtitles look garbled or empty, the subtitle track might be in a format FFmpeg can't convert. Try extracting as-is with `-c:s copy` to see the raw format.
- Some video files have subtitles burned into the video frames (hardcoded) rather than as a separate track. FFmpeg can't extract those — they require OCR, which is a different problem.
