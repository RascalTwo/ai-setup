/*
 * mcp-recorder.js — record smooth video of the USER'S REAL Chrome tab, via the
 * claude-in-chrome MCP. Inject this with javascript_tool, then drive window.__cap.
 *
 * Why this route is the default: it records the user's actual browser — their real
 * logged-in session, their SSO, their data, at their real device pixel ratio. A
 * spawned puppeteer browser can't do any of that. It also needs no picker click.
 *
 * THE ONE CONSTRAINT (all three, only at __cap.arm() time):
 *   1. this tab is the SELECTED tab in its window
 *   2. the window is frontmost / not occluded by another app  (scripts/raise-chrome.sh)
 *   3. a TRUSTED click lands within ~5s  -> the MCP `computer` tool's clicks ARE trusted
 * Miss any one and getDisplayMedia rejects with InvalidStateError ("Invalid state").
 * AFTER capture starts, Chrome PINS the tab visible: the user can switch apps, cover the
 * window, and keep working, and capture continues at full frame rate. Verified.
 *
 * USAGE (from the agent side)
 *   1. javascript_tool: inject this file
 *   2. javascript_tool: window.__cap.armButton()        -> full-viewport click target
 *   3. bash: scripts/raise-chrome.sh <url-substring>
 *   4. computer: SCREENSHOT FIRST, then click the target's centre in THAT screenshot's
 *      coordinates. Screenshot dimensions change between calls (e.g. 1456x840 vs
 *      1502x818) — never reuse a previously computed scale factor, or you silently miss.
 *   5. javascript_tool: check window.__cap.state === 'RECORDING'
 *   6. drive the flow (javascript_tool / computer). Optionally inject walkthrough-kit.js
 *      first for a cursor + highlight + click pulse.
 *   7. javascript_tool: await window.__cap.stop()  -> downloads to ~/Downloads
 *   8. bash: ffmpeg/ffprobe to verify + convert (see SKILL.md)
 */
(() => {
  const cap = {
    state: 'idle',
    error: null,
    chunks: [],
    filename: 'capture.webm',
    bytes: 0,

    // Must be called from a TRUSTED click handler — user activation is required.
    async start(opts = {}) {
      const { fps = 30, filename = 'capture.webm', bitrate = 8000000 } = opts;
      cap.filename = filename;
      cap.chunks = [];
      cap.state = 'requesting';
      try {
        // preferCurrentTab is what removes the picker entirely: Chrome captures THIS tab
        // with no chooser dialog, so no human has to click anything.
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: fps },
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          audio: false,
        });
        cap.stream = stream;
        const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bitrate });
        mr.ondataavailable = (e) => { if (e.data && e.data.size) cap.chunks.push(e.data); };
        mr.onstop = () => {
          const blob = new Blob(cap.chunks, { type: 'video/webm' });
          cap.bytes = blob.size;
          // A real <a download> click is a genuine browser download and lands in ~/Downloads.
          // (The computer tool's save_to_disk flag is unreliable and writes nothing — don't.)
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = cap.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          cap.state = 'downloaded';
        };
        cap.mr = mr;
        mr.start(250); // timeslice: flush chunks as we go, so a crash doesn't lose everything
        document.getElementById('__cap_btn')?.remove(); // never let the target into the video
        const t = stream.getVideoTracks()[0];
        cap.state = 'RECORDING';
        cap.settings = t.getSettings();
        return cap.settings;
      } catch (e) {
        cap.state = 'ERR';
        cap.error = { name: e.name, msg: e.message };
        // InvalidStateError almost always means: tab not visible. Re-run raise-chrome.sh.
        return cap.error;
      }
    },

    async stop() {
      if (cap.mr && cap.mr.state !== 'inactive') cap.mr.stop();
      try { cap.stream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
      await new Promise((r) => setTimeout(r, 1500)); // let onstop assemble + download fire
      return { state: cap.state, bytes: cap.bytes, filename: cap.filename };
    },

    // A full-viewport target: the agent clicks blind through a screenshot, and a big target
    // is the difference between "worked" and "silently missed and you debug for ten minutes".
    armButton(label = '● CLICK TO START RECORDING', opts = {}) {
      document.getElementById('__cap_btn')?.remove();
      const b = document.createElement('div');
      b.id = '__cap_btn';
      b.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(255,45,85,.92);color:#fff;font:700 40px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;text-align:center';
      b.textContent = label;
      b.onclick = () => cap.start(opts);
      document.body.appendChild(b);
      return { armed: true, viewport: [innerWidth, innerHeight] };
    },

    // Diagnostics: call this when start() fails, and it tells you which precondition broke.
    diagnose() {
      return {
        state: cap.state,
        error: cap.error,
        visibilityState: document.visibilityState, // must be "visible" at start()
        hasFocus: document.hasFocus(),
        userActivation: navigator.userActivation?.hasBeenActive,
        hasDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
        hint: document.visibilityState !== 'visible'
          ? 'Tab is hidden -> run scripts/raise-chrome.sh (select the tab AND raise the window; macOS occlusion by another app also counts as hidden).'
          : 'Tab is visible. If start() still failed, the click was not trusted or activation expired — screenshot first, then click the target.',
      };
    },
  };
  window.__cap = cap;
  return '__cap ready';
})();
