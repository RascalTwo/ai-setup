---
name: extract-gdrive-transcript
version: 1.0.0
description: "Extracts the full transcript of a Google Meet or other video recording on Google Drive through the browser. Use for a Drive recording URL, Meet recordings, meeting captions, or speaker-attributed meeting text, even if the user never says \"transcript\"."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    google-drive: video player transcript panel
    chrome: browser automation
  requires:
    skills: [browser, transcribe-media]
    manual: [Chrome]
---

# Google Drive Video Transcript Extractor

If the recording is already in the steno catalog, use the `steno-transcripts` skill first instead of re-transcribing.

Extract full transcripts from video recordings on Google Drive using the `browser` skill (browse by default, so the tab carries the user's Google login). The transcript includes timestamps and speaker attribution, output as a WebVTT (.vtt) file.

This works because Google Drive's video player has a built-in Transcript panel that shows auto-generated captions with speaker names and timestamps. Rather than downloading the video and processing it offline, this skill reads the transcript directly from the browser — no OAuth, no FFmpeg, no video download.

**See also:** if the video file is already downloaded locally (not in the Drive browser player), use the `extract-video-subtitles` skill instead.

## Requirements

- A browser session from the `browser` skill (`browse session new gdrive`; delete it when done)
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

Write the steps below as browse scripts (`browse execute -s gdrive --timeout-ms 60000 --file <script.js>`), with `{ timeout: 5000 }` on every action. Drive's console noise is long: redirect each `browse execute` output to a file under `~/.agents/state/browser/gdrive/` and read the top.

```js
await page.goto("https://drive.google.com/file/d/{fileId}/view", { timeout: 25000, waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
return { url: page.url(), title: await page.title() };
```

A login or access-denied page (the title or URL says so; `screenshot` to look) means stop and tell the user they need to be logged into Google in Chrome (or `handoff()` for a login).

The Transcript button stays disabled until the video has started playing, so play first. Click the **play button** (`page.getByRole("button", { name: /^Play/ }).first().click({ timeout: 5000 })`), wait 5 seconds. Pausing is optional: the panel fills while playing. If the play button itself is disabled and the video area is black, Drive is still processing the recording: tell the user to retry later.

### 2. Check whether the Transcript button is enabled

After playback has started, the button can still be **disabled (greyed out)** — that means the recording has no captions/transcript at all and there is nothing to extract. A disabled button still exists in the DOM and the page may accept a click on it, so check its enabled state explicitly before opening the panel:

```js
return await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Transcript');
  return { found: !!t, disabled: t?.disabled, ariaDisabled: t?.getAttribute('aria-disabled') };
});
```

If `disabled === true` or `ariaDisabled === "true"` after 5 seconds of playback, there is **no Google transcript to extract** — stop the browser flow (do not attempt clicks, retry, or DOM discovery). But the recording can still be transcribed by speech: tell the user, and offer the **ASR fallback** —
download the recording from Drive, then run the `transcribe-media` skill on the file:

```bash
~/.agents/skills/transcribe-media/transcribe.sh <downloaded-file> --format vtt
```

That yields a `.vtt` from the audio (no Google speaker names, but the words are there). Only
fall through to this when Google's own captions are genuinely absent.

### 3. Open the transcript panel

Click the Transcript button: `page.getByRole("button", { name: "Transcript" }).click({ timeout: 5000 })`. A `getByText("Transcript")` locator matches a hidden duplicate span first and times out as "not visible". The click opens a panel on the right showing timestamped entries with speaker names.

Take a screenshot to confirm the panel is visible. If it doesn't open:
- Try clicking the chevron arrow on the right side of the Transcript bar
- Try playing the video a bit longer, then retry
- If there's no Transcript bar at all, the recording doesn't have captions — tell the user

### 4. Discover the DOM structure

Google uses obfuscated CSS class names that change periodically. Instead of hardcoding them, discover the current class names by inspecting the page.

The transcript panel contains repeating entries, each with: a **timestamp element** (like "0:08"), a **text element** (containing the speaker name in parentheses followed by the spoken text), and sometimes a "Copy link" element.

Find the class names by searching for timestamp-like content:

```javascript
return await page.evaluate(() => {
  const timestampEls = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length === 0 && /^\d{1,2}:\d{2}$/.test(el.textContent.trim())) {
      timestampEls.push({
        className: el.className,
        parentClassName: el.parentElement?.className,
        siblingClasses: Array.from(el.parentElement?.children || []).map(c => c.className)
      });
    }
  });
  return { found: timestampEls.length, samples: timestampEls.slice(0, 5) };
});
```

**Important:** Skip the first one or two results — they're the video player's time display, not transcript entries (the sample list above has them first; on a 2-hour recording 437 timestamp elements matched). The transcript entries are the ones where the parent class repeats consistently across many elements.

From the results, identify three class names:
- **ENTRY_CLASS** — the parent element that wraps each transcript entry
- **TIMESTAMP_CLASS** — the child element containing just the timestamp
- **TEXT_CLASS** — the sibling element containing speaker name + transcript text

The text element's content follows this pattern: `(Speaker Name)\nActual spoken text (Speaker Name)\nmore text`. The speaker name appears in parentheses and may repeat — it's a label, not part of the speech.

### 5. Extract and save

Using the discovered class names, extract all entries inside the page and convert to WebVTT. Write the file with `files.write` and copy it out, so the transcript never passes through the chat and no browser download is needed:

```javascript
const vtt = await page.evaluate(() => {
  const parsed = [];
  let lastSpeaker = '';
  document.querySelectorAll('.ENTRY_CLASS').forEach(entry => {
    const tsEl = entry.querySelector('.TIMESTAMP_CLASS');
    const textEl = entry.querySelector('.TEXT_CLASS');
    if (!tsEl || !textEl) return;
    const raw = textEl.textContent.trim();
    const speakerMatch = raw.match(/^\(([^)]+)\)/);
    const speaker = speakerMatch ? speakerMatch[1] : lastSpeaker;
    if (speaker) lastSpeaker = speaker;
    const text = raw.replace(/\([^)]+\)\n?/g, '').trim();
    if (text) parsed.push({ timestamp: tsEl.textContent.trim(), speaker, text });
  });

  const toVTTTime = ts => {
    const p = ts.split(':');
    if (p.length === 2) return '00:' + p[0].padStart(2, '0') + ':' + p[1].padStart(2, '0') + '.000';
    return p[0].padStart(2, '0') + ':' + p[1].padStart(2, '0') + ':' + p[2].padStart(2, '0') + '.000';
  };

  let v = 'WEBVTT\nKind: captions\n\n';
  parsed.forEach((e, i) => {
    const end = i + 1 < parsed.length ? toVTTTime(parsed[i + 1].timestamp) : toVTTTime('59:59');
    v += toVTTTime(e.timestamp) + ' --> ' + end + '\n<v ' + e.speaker + '>' + e.text + '\n\n';
  });
  return { v, entries: parsed.length, speakers: [...new Set(parsed.map(p => p.speaker))], first: parsed[0]?.timestamp, last: parsed[parsed.length - 1]?.timestamp };
});
const p = files.path('transcript.vtt');
await files.write(p, vtt.v);
return { p, entries: vtt.entries, speakers: vtt.speakers, first: vtt.first, last: vtt.last };
```

Replace `ENTRY_CLASS`, `TIMESTAMP_CLASS`, and `TEXT_CLASS` with the actual class names you discovered in step 4. Then `cp` the returned path (a temp folder) to `~/Downloads/<slug-of-title>.vtt`, the lowercase title with non-alphanumerics turned into dashes.

Only the summary object is returned, so a long meeting does not truncate. The same extraction run against a 2-hour recording returned 947 entries and 17 speakers.

### 6. Report

Tell the user:
- Where the file was saved (the path you copied it to)
- Number of entries extracted
- Speakers identified
- Time range covered (first to last timestamp)

## Troubleshooting

| Situation | What to do |
|-----------|-----------|
| No Transcript bar after playing | The recording may not have captions. Ask if captions were enabled during the meeting; if not, offer the `transcribe-media` ASR fallback (download the file, transcribe the audio). |
| Zero timestamp elements in discovery | The DOM structure may have changed significantly. Run `snapshot()` or a screenshot on the transcript panel to inspect it and adapt. |
| Play button disabled, black video | Drive is still processing the recording. Ask the user to retry later. |
| Transcript panel is empty | Captions may still be processing. Ask the user to try again later. |
| Very few entries for a long video | Scroll the transcript panel to trigger lazy loading, then re-extract. |
| Speaker names are wrong or missing | Google Meet's speaker detection isn't perfect. The user can correct names in the output file. |
