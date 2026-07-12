---
name: extract-gdrive-transcript
version: 1.0.0
description: "Extract the full transcript from a Google Meet (or other) video recording hosted on Google Drive, using Chrome MCP. Use this skill when the user wants to get a transcript from a Google Drive recording URL, extract meeting captions, download meeting notes as text, or convert a recorded meeting to a readable transcript. Also use this when the user mentions Google Meet recordings, Drive video links, or wants speaker-attributed text from a recorded meeting — even if they don't say 'transcript' explicitly."
---

# Google Drive Video Transcript Extractor

Extract full transcripts from video recordings on Google Drive using Chrome MCP. The transcript includes timestamps and speaker attribution, output as a WebVTT (.vtt) file.

This works because Google Drive's video player has a built-in Transcript panel that shows auto-generated captions with speaker names and timestamps. Rather than downloading the video and processing it offline, this skill reads the transcript directly from the browser — no OAuth, no FFmpeg, no video download.

**See also:** if the video file is already downloaded locally (not in the Drive browser player), use the `extract-video-subtitles` skill instead.

## Requirements

- **Chrome MCP** (Claude in Chrome) must be connected
- The user must be **logged into Google** in Chrome with access to the recording
- The recording must have **captions/subtitles** (Google Meet recordings have these by default)

## Input

A Google Drive recording URL. The user provides this as an argument:

```
$ARGUMENTS
```

If no URL is provided, ask the user for one. The URL looks like:
```
https://drive.google.com/file/d/{fileId}/view
```

## Workflow

### 1. Navigate and start playback

Navigate to the URL. Wait for the page to load and take a screenshot.

If you see a login or access denied screen, stop and tell the user they need to be logged into Google in Chrome.

The transcript panel often doesn't appear or populate until the video has started playing. Click the **play button** on the video player to start playback. Wait 3-5 seconds, then pause the video.

Take a screenshot. You should now see a "Transcript" bar near the top of the page.

### 2. Check whether the Transcript button is enabled

Even when a Transcript bar appears, it can be **disabled (greyed out)** — that means the recording has no captions/transcript at all and there is nothing to extract. Critically, the disabled button still satisfies a `find` query and can still be `left_click`'d, so you must check its enabled state explicitly. Visually, the disabled state shows muted/grey text instead of normal contrast; a screenshot alone is the human cue.

Programmatically, check via JavaScript before attempting to open the panel:

```javascript
const allButtons = Array.from(document.querySelectorAll('button'));
const t = allButtons.find(b => b.textContent.trim() === 'Transcript');
JSON.stringify({
  found: !!t,
  disabled: t?.disabled,
  ariaDisabled: t?.getAttribute('aria-disabled'),
  // any of these "true"/true means no transcript exists for this recording
});
```

If `disabled === true` or `ariaDisabled === "true"`, **stop immediately** and report failure: "No transcript available — Transcript button is disabled. Recording has no captions." Do not attempt clicks, do not retry, do not fall through to DOM discovery — there is nothing to extract.

### 3. Open the transcript panel

Click the **"Transcript" text** near the top-left of the page. This opens a panel on the right side showing timestamped entries with speaker names.

Take a screenshot to confirm the panel is visible. If it doesn't open:
- Try clicking the chevron arrow on the right side of the Transcript bar
- Try playing the video a bit longer, then retry
- If there's no Transcript bar at all, the recording doesn't have captions — tell the user

### 4. Discover the DOM structure

Google uses obfuscated CSS class names that change periodically. Instead of hardcoding them, discover the current class names by inspecting the page.

The transcript panel contains repeating entries, each with: a **timestamp element** (like "0:08"), a **text element** (containing the speaker name in parentheses followed by the spoken text), and sometimes a "Copy link" element.

Find the class names by searching for timestamp-like content:

```javascript
const allElements = document.querySelectorAll('*');
const timestampEls = [];

allElements.forEach(el => {
  if (el.children.length === 0 && /^\d{1,2}:\d{2}$/.test(el.textContent.trim())) {
    timestampEls.push({
      className: el.className,
      parentClassName: el.parentElement?.className,
      siblingClasses: Array.from(el.parentElement?.children || []).map(c => c.className)
    });
  }
});

JSON.stringify({
  found: timestampEls.length,
  samples: timestampEls.slice(2, 5)
}, null, 2);
```

**Important:** Skip the first two results — they're usually the video player's time display, not transcript entries. The transcript entries are the ones where the parent class repeats consistently across many elements.

From the results, identify three class names:
- **ENTRY_CLASS** — the parent element that wraps each transcript entry
- **TIMESTAMP_CLASS** — the child element containing just the timestamp
- **TEXT_CLASS** — the sibling element containing speaker name + transcript text

The text element's content follows this pattern: `(Speaker Name)\nActual spoken text (Speaker Name)\nmore text`. The speaker name appears in parentheses and may repeat — it's a label, not part of the speech.

### 5. Extract and download

Using the discovered class names, extract all entries, convert to WebVTT, and trigger a browser download:

```javascript
const entries = document.querySelectorAll('.ENTRY_CLASS');
const parsed = [];
let lastSpeaker = '';

entries.forEach((entry) => {
  const tsEl = entry.querySelector('.TIMESTAMP_CLASS');
  const textEl = entry.querySelector('.TEXT_CLASS');
  if (!tsEl || !textEl) return;
  const timestamp = tsEl.textContent.trim();
  let raw = textEl.textContent.trim();
  const speakerMatch = raw.match(/^\(([^)]+)\)/);
  const speaker = speakerMatch ? speakerMatch[1] : lastSpeaker;
  if (speaker) lastSpeaker = speaker;
  const cleanText = raw.replace(/\([^)]+\)\n?/g, '').trim();
  if (cleanText) parsed.push({ timestamp, speaker, text: cleanText });
});

function toVTTTime(ts) {
  const parts = ts.split(':');
  if (parts.length === 2) return '00:' + parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0') + '.000';
  return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0') + ':' + parts[2].padStart(2, '0') + '.000';
}

let vtt = 'WEBVTT\nKind: captions\n\n';
for (let i = 0; i < parsed.length; i++) {
  const start = toVTTTime(parsed[i].timestamp);
  const end = i + 1 < parsed.length ? toVTTTime(parsed[i + 1].timestamp) : toVTTTime('59:59');
  vtt += start + ' --> ' + end + '\n<v ' + parsed[i].speaker + '>' + parsed[i].text + '\n\n';
}

const blob = new Blob([vtt], { type: 'text/vtt' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = document.title.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().replace(/-+/g, '-') + '.vtt';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

JSON.stringify({
  entries: parsed.length,
  speakers: [...new Set(parsed.map(p => p.speaker))],
  file: a.download
});
```

Replace `ENTRY_CLASS`, `TIMESTAMP_CLASS`, and `TEXT_CLASS` with the actual class names you discovered in step 3.

If the JavaScript output is truncated due to size, store it in `window.__transcript` and read in chunks, or use the Blob download approach above (which avoids the truncation issue entirely).

### 6. Report

Tell the user:
- The file was downloaded (name and where to find it — typically the Downloads folder)
- Number of entries extracted
- Speakers identified
- Time range covered (first to last timestamp)

## Troubleshooting

| Situation | What to do |
|-----------|-----------|
| No Transcript bar after playing | The recording may not have captions. Ask if captions were enabled during the meeting. |
| Zero timestamp elements in discovery | The DOM structure may have changed significantly. Use `read_page` on the transcript panel to visually inspect and adapt. |
| Transcript panel is empty | Captions may still be processing. Ask the user to try again later. |
| Very few entries for a long video | Scroll the transcript panel to trigger lazy loading, then re-extract. |
| Speaker names are wrong or missing | Google Meet's speaker detection isn't perfect. The user can correct names in the output file. |
