// The live preview of a container, its lobby key, and the deployed-URL lookup.
import { $, byKind, closestTo, fire } from "./dashboard-dom.js";
import { esc, ICONS } from "./dashboard-format.js";
import { mgmt } from "./dashboard-net.js";
import type { Lobby } from "./dashboard-types.js";

// ---- Live preview ------------------------------------------------------
const previewBtn = byKind("#preview-btn", HTMLButtonElement);
const previewStop = byKind("#preview-stop", HTMLButtonElement);
const previewScope = byKind("#f-scope", HTMLSelectElement); // preview builds whatever the scope filter is pinned to
const previewResult = $("#preview-result");
document.querySelector("#preview-icon")!.innerHTML = ICONS.refresh;
function setPreviewResult(html: string, isErr?: boolean) {
  previewResult.innerHTML = html;
  previewResult.className = "preview-result" + (isErr ? " err" : "");
}
// "preview" needs a specific container — disabled while scope is "all". So does base-url.
const syncPreviewEnabled = () => {
  previewBtn.disabled = !previewScope.value;
  byKind("#baseurl-btn", HTMLButtonElement).disabled = !previewScope.value;
};
previewScope.addEventListener("change", syncPreviewEnabled);
syncPreviewEnabled();
previewBtn.addEventListener("click", () => {
  fire(runPreview());
});
async function runPreview(): Promise<void> {
  const container = previewScope.value; // never empty: the button is disabled while scope is "all"
  previewBtn.disabled = true;
  previewBtn.classList.add("scanning");
  document.querySelector("#preview-label")!.textContent = "building…";
  setPreviewResult("building the publishable tree — this can take a bit…");
  const r = await mgmt("preview", { container }); // POST blocks until the build serves
  previewBtn.classList.remove("scanning");
  document.querySelector("#preview-label")!.textContent = "preview";
  syncPreviewEnabled();
  if (r.ok) {
    // api/preview and api/base-url answer ok only with a url
    setPreviewResult(
      `serving → <a href="${esc(r.url!)}" target="_blank" rel="noopener">${esc(r.url!)}</a>`,
    );
    previewStop.hidden = false;
    lobbyContainer = container;
    renderLobbyKey(r.lobby);
  } else {
    setPreviewResult("preview failed: " + esc(r.err || "unknown error"), true);
    previewStop.hidden = true;
    renderLobbyKey(null);
  }
}

// ---- Lobby key ---------------------------------------------------------
// Shown only for a container with a _private-lobby marker. The shim links are the
// hashtag-free form: a sealed page's <head> is encrypted and can't carry an OG card, so the
// shim is the only URL that unfurls. Their /<hash>/ segment depends solely on passphrase+salt,
// never the host, so swapping the 127.0.0.1 origin for the deployed one gives the real
// shareable link — that portability is why the localhost origin is not a dead end.
const lobbyKeyEl = $("#lobby-key");
// Remembered so "deployed url" can re-render the shims against the deployed origin without
// paying for another preview build. A shim's /<hash>/ segment is host-independent, so
// swapping the origin yields the real shareable link rather than an approximation of one.
let lastLobby: Lobby | null | undefined = null,
  deployedBase: string | null = null,
  lobbyContainer: string | null = null;
function renderLobbyKey(lobby: Lobby | null | undefined) {
  lastLobby = lobby;
  if (!lobby) {
    lobbyKeyEl.hidden = true;
    lobbyKeyEl.innerHTML = "";
    return;
  }
  const copy = (v: string) => `<button class="copy" data-copy="${esc(v)}">copy</button>`;
  const row = (label: string, value: string, isLink?: boolean) =>
    `<dt>${esc(label)}</dt><dd>${
      isLink
        ? `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>`
        : esc(value)
    }${copy(value)}</dd>`;
  lobbyKeyEl.innerHTML =
    `<h4>🔑 lobby key — this container is sealed behind one password` +
    `<button class="rot" title="viz rotate <container> --lobby — mints a new key; every existing lobby link and passphrase dies. Click twice.">rotate key</button></h4><dl>` +
    row("passphrase", lobby.passphrase) +
    row("hash", lobby.hash) +
    lobby.shims.map((u, i) => row(i ? "" : "shim link", u, true)).join("") +
    // Once the deployed base is known, show the SHAREABLE form too — same hash, real origin.
    (deployedBase
      ? lobby.shims
          .map((u) => deployedBase + new URL(u).pathname)
          .map((u, i) => row(i ? "" : "deployed", u, true))
          .join("")
      : "") +
    `</dl>` +
    (lobby.shims.length === 0
      ? `<p class="note">No shim links in this build. The hash above is host-independent, so it works against any origin.</p>`
      : deployedBase
        ? `<p class="note">Deployed links are the shareable ones — a sealed page can't unfurl, so the shim carries the card. They 404 until you actually deploy.</p>`
        : `<p class="note">Shim links open the site already unlocked, with no <code>#</code> fragment. Hit <b>deployed url</b> for the shareable form.</p>`);
  lobbyKeyEl.hidden = false;
}
// Explicit click, never automatic on scope change: this executes base-url.sh out of the
// selected repo, and its answer becomes a link that carries the lobby key.
const baseurlBtn = byKind("#baseurl-btn", HTMLButtonElement);
baseurlBtn.addEventListener("click", () => {
  fire(askBaseUrl());
});
async function askBaseUrl(): Promise<void> {
  const container = previewScope.value; // never empty, as for preview
  baseurlBtn.disabled = true;
  baseurlBtn.textContent = "asking…";
  const r = await mgmt("base-url", { container });
  baseurlBtn.textContent = "deployed url";
  syncPreviewEnabled();
  if (r.ok) {
    // api/preview and api/base-url answer ok only with a url
    deployedBase = r.url!;
    // Card-public share pages (ADR 0018) — the one URL of a gated public viz that unfurls.
    // A _private-lobby container emits none: its lobby shims carry the card instead.
    // The list is computed server-side (lib/publish/base-url.ts) — the same one `viz urls` prints.
    const shares = r.shares!; // always sent with a url
    setPreviewResult(
      `deploys to → <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` +
        shares
          .map(
            (u) =>
              `<br>🪪 share → <a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a> <button class="copy" data-copy="${esc(u)}">copy</button>`,
          )
          .join(""),
    );
    if (lastLobby) renderLobbyKey(lastLobby); // re-render with the deployed shim links
  } else {
    deployedBase = null;
    setPreviewResult(esc(r.err || "base-url.sh failed"), true);
  }
}
// Scope change invalidates a base URL read from a different container.
previewScope.addEventListener("change", () => {
  deployedBase = null;
});

// Delegated: the rows are re-rendered on every preview, so per-button listeners would die.
async function copyButton(e: MouseEvent): Promise<void> {
  const btn = closestTo(e, "button.copy");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset["copy"]!);
    btn.textContent = "copied";
    setTimeout(() => {
      btn.textContent = "copy";
    }, 1200);
  } catch {
    btn.textContent = "copy failed";
  }
}
const copyClick = (e: MouseEvent): void => {
  fire(copyButton(e));
};
lobbyKeyEl.addEventListener("click", copyClick);
// Rotate the lobby key: two clicks (like the drawer's arm()), then rebuild the preview so
// the NEW passphrase shows — rotate itself only mints the key; the build prints it.
async function rotateKey(e: MouseEvent): Promise<void> {
  const btn = closestTo(e, "button.rot");
  if (!(btn instanceof HTMLButtonElement)) return;
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.textContent = "confirm? kills every lobby link";
    setTimeout(() => {
      btn.classList.remove("armed");
      btn.textContent = "rotate key";
    }, 2500);
    return;
  }
  btn.disabled = true;
  btn.textContent = "rotating…";
  const r = await mgmt("rotate", { container: lobbyContainer! }); // set by the preview that showed this key
  if (!r.ok) {
    btn.disabled = false;
    btn.classList.remove("armed");
    btn.textContent = "rotate key";
    return setPreviewResult("rotate failed: " + esc(r.err || "unknown error"), true);
  }
  renderLobbyKey(null); // the shown key is dead now
  if (previewScope.value === lobbyContainer) previewBtn.click();
  else setPreviewResult(esc(r.out) + "<br>preview this container again to see the new key.");
}
lobbyKeyEl.addEventListener("click", (e) => {
  fire(rotateKey(e));
});
previewResult.addEventListener("click", copyClick);
previewStop.addEventListener("click", () => {
  fire(stopPreview());
});
async function stopPreview(): Promise<void> {
  previewStop.disabled = true;
  await mgmt("preview-stop", {});
  previewStop.disabled = false;
  previewStop.hidden = true;
  setPreviewResult("preview stopped");
}
