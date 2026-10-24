// The management drawer's behaviour (ADR 0009): every [data-act] button, and the loads that fill it.
import { $, closestTo, fire } from "./dashboard-dom.js";
import { chipHtml, drawerOf, mirrorEditHtml, renderJobs, renderLine } from "./dashboard-drawer.js";
import { refreshAfter } from "./dashboard-feed.js";
import { esc, fmtAgo } from "./dashboard-format.js";
import { renderSlugs } from "./dashboard-list.js";
import { getJson, mgmt, said } from "./dashboard-net.js";
import { state } from "./dashboard-state.js";
import type { Mirror } from "./dashboard-types.js";

// ---- Surface management (ADR 0009): drawer → api/{update,move,mirror,vendor,history,…} ----
// Reads are local; every write shells out to the viz CLI (one definition of the
// hard logic). The drawer is rendered inline by renderSlugs when its row is open.
let confirmKey: string | null = null; // destructive button armed for its 2nd (confirming) click

async function pollRender(id: string) {
  for (;;) {
    const j = renderJobs.get(id);
    const box = drawerOf(id)?.querySelector(".render-state");
    if (box) box.innerHTML = renderLine(id);
    if (!j || j.state !== "running") return;
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling: each wait must finish before the next status request
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1000);
    });
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling: the next round depends on this job's answer
    const r = await mgmt("render", { action: "status", job: j.id });
    if (r.job) renderJobs.set(id, r.job);
  }
}

function setStatus(id: string, msg: string, ok?: boolean) {
  state.drawerStatus = {
    id,
    msg,
    cls: "drawer-status" + (ok === true ? " ok" : ok === false ? " err" : ""),
  };
  const el = drawerOf(id)?.querySelector(".drawer-status");
  if (el) {
    el.textContent = msg;
    el.className = state.drawerStatus.cls;
  }
}

async function loadMirrors(id: string) {
  const list = async (route: string): Promise<Mirror[]> => {
    try {
      return await getJson<Mirror[]>(`api/${route}?id=` + encodeURIComponent(id));
    } catch {
      return [];
    }
  };
  const [rows, vrows] = await Promise.all([list("mirrors"), list("vendors")]);
  mirrorRows = new Map(rows.map((m) => [m.to, m]));
  // Looked up AFTER the fetch: a refresh may have rebuilt the drawer meanwhile, or the write
  // that called this may have taken its row out of the filtered list.
  const d = drawerOf(id);
  if (!d) return;
  d.querySelector(".mirror-list")!.innerHTML =
    rows.length === 0
      ? '<span class="mz">none</span>'
      : rows
          .map(
            (m) =>
              `<span class="mchip">${esc(m.to)} <i>[${esc(m.access)}]</i>${m.listed ? "" : " ·unlisted"}${m.overrides ? " ·overrides" : ""}<button class="mx" data-act="mirror-edit" data-to="${esc(m.to)}" title="edit listed / title / description / tags for this mirror">✎</button><button class="mx" data-act="mirror-rm" data-to="${esc(m.to)}" title="remove mirror">✕</button></span>`,
          )
          .join("");
  d.querySelector(".vendor-list")!.innerHTML =
    vrows.length === 0
      ? '<span class="mz">none</span>'
      : vrows
          .map(
            (v) =>
              `<span class="mchip">${esc(v.to)} <i>[${esc(v.access)}]</i><button class="mx" data-act="vendor-rm" data-to="${esc(v.to)}" title="undeclare — the copy is pruned on the next publish --push-vendors">✕</button></span>`,
          )
          .join("");
}
let mirrorRows = new Map<string, Mirror>(); // last /mirrors answer for the open drawer, to prefill the editor

async function loadHistory(id: string) {
  const box = drawerOf(id)?.querySelector(".hist-rows");
  if (!box) return;
  box.innerHTML = '<span class="mz">…</span>';
  type History = {
    ok: boolean;
    err?: string;
    commits: { hash: string; date: string; subject: string }[];
  };
  const r = await getJson<History>("api/history?id=" + encodeURIComponent(id)).catch(
    (): History => ({ ok: false, commits: [] }),
  );
  box.innerHTML = !r.ok
    ? `<span class="mz">${r.err ? esc(r.err) : "no history"}</span>`
    : r.commits.length === 0
      ? '<span class="mz">no commits touching this viz</span>'
      : r.commits
          .map(
            (c) =>
              `<div class="hist-row"><code title="${esc(c.hash)}">${esc(c.hash.slice(0, 7))}</code><span class="mz">${esc(fmtAgo(Date.parse(c.date)))}</span><span title="${esc(c.subject)}">${esc(c.subject)}</span>` +
              `<button class="dg-b warn" data-act="rollback" data-commit="${esc(c.hash)}" title="restore this viz's files to this commit (committed as a new change) — click twice">restore</button></div>`,
          )
          .join("");
}
function reopenRender() {
  renderSlugs(state.lastSlugs);
  if (state.openDrawerId) fire(loadMirrors(state.openDrawerId));
}

/** What every [data-act] handler gets: its button, the viz id of its row or drawer, the open
 *  drawer, and the two-step confirm for destructive actions. */
interface ActCtx {
  btn: HTMLElement;
  id: string;
  act: string;
  drawer: Element;
  arm: (key: string) => boolean;
}
type Act = (c: ActCtx) => Promise<void> | void;

// Two-step confirm for destructive actions: first click arms, second within 2.5s commits.
function makeArm(btn: HTMLElement, id: string): (key: string) => boolean {
  return (key) => {
    if (confirmKey === key) {
      confirmKey = null;
      return true;
    }
    confirmKey = key;
    btn.classList.add("armed");
    const was = btn.textContent;
    if (btn.classList.contains("dg-b")) btn.textContent = "confirm?";
    // Unanswered: disarm, so a click long after still needs its confirming second one. The
    // button is put back in place, not by a re-render, which would reset the drawer's inputs
    // (the move destination picked before the first click among them).
    setTimeout(() => {
      if (confirmKey !== key) return;
      confirmKey = null;
      btn.classList.remove("armed");
      btn.textContent = was;
      setStatus(id, "");
    }, 2500);
    return false;
  };
}

/** A write that refreshes the lists and the drawer's mirrors when it succeeds. */
const refreshAndMirrors = async (id: string): Promise<void> => {
  await refreshAfter();
  fire(loadMirrors(id));
};

const ACTS: Record<string, Act> = {
  toggle: ({ id }) => {
    state.openDrawerId = state.openDrawerId === id ? null : id;
    confirmKey = null;
    setStatus(id, "");
    reopenRender();
  },
  "chip-rm": ({ btn }) => {
    btn.closest(".chip")!.remove();
  },
  // The template badge opens the drawer at its "new from this" row — the drawer, not the
  // row, because the 5s poll leaves an open drawer's inputs alone.
  "from-open": ({ id }) => {
    if (state.openDrawerId !== id) {
      state.openDrawerId = id;
      confirmKey = null;
      setStatus(id, "");
      reopenRender();
    }
    drawerOf(id)!.querySelector<HTMLInputElement>('[data-fld="newSlug"]')!.focus();
  },
  "copy-uid": async ({ id, btn }) => {
    try {
      await navigator.clipboard.writeText(btn.dataset["uid"]!);
      setStatus(id, "uid copied", true);
    } catch {
      setStatus(id, "copy failed", false);
    }
  },
  history: ({ id, btn }) => {
    const details = btn.parentElement;
    if (!(details instanceof HTMLDetailsElement && details.open)) fire(loadHistory(id)); // clicked while closed = opening
  },

  // Every act below is a button inside the open drawer.
  axis: async ({ id, btn }) => {
    const body = { id, [btn.dataset["axis"]!]: btn.dataset["val"] };
    setStatus(id, "saving…");
    const r = await mgmt("update", body);
    setStatus(id, said(r, "updated"), r.ok);
    if (r.ok) await refreshAndMirrors(id);
  },
  "meta-save": async ({ id, drawer }) => {
    const val = (f: string) =>
      drawer.querySelector<HTMLInputElement>(`input[data-fld="${f}"]`)!.value.trim();
    const chips = [...drawer.querySelectorAll<HTMLElement>('[data-fld="tags"] .chip')].map(
      (c) => c.dataset["tag"]!,
    );
    const pend = drawer.querySelector<HTMLInputElement>(".tag-input")!.value.trim(); // commit an un-entered tag too
    if (pend && !chips.some((t) => t.toLowerCase() === pend.toLowerCase())) chips.push(pend);
    setStatus(id, "saving…");
    const r = await mgmt("update", {
      id,
      title: val("title"),
      description: val("description"),
      tags: chips.join(", "),
    });
    setStatus(id, said(r, "saved"), r.ok);
    if (r.ok) await refreshAndMirrors(id);
  },
  link: linkAct,
  unlink: linkAct,
  rename: async ({ id, drawer }) => {
    const name = drawer.querySelector<HTMLInputElement>('[data-fld="name"]')!.value.trim();
    if (!name) return setStatus(id, "name required", false);
    setStatus(id, "renaming…");
    const r = await mgmt("move", { id, name });
    if (r.ok) {
      state.openDrawerId = null;
      await refreshAfter();
    } else setStatus(id, said(r, ""), false);
  },
  move: async ({ id, drawer, arm }) => {
    const to = drawer.querySelector<HTMLSelectElement>('[data-fld="toContainer"]')!.value;
    if (!to) return setStatus(id, "no destination container", false);
    if (!arm("move")) return setStatus(id, "click move again to confirm");
    setStatus(id, "moving…");
    const r = await mgmt("move", { id, toContainer: to });
    if (r.ok) {
      state.openDrawerId = null;
      await refreshAfter();
    } else setStatus(id, said(r, ""), false);
  },
  "mirror-add": async ({ id, drawer }) => {
    const to = drawer.querySelector<HTMLSelectElement>('[data-fld="to"]')!.value;
    if (!to) return setStatus(id, "no sink container", false);
    setStatus(id, "mirroring…");
    const r = await mgmt("mirror", {
      id,
      sub: "add",
      to,
      access: drawer.querySelector<HTMLSelectElement>('[data-fld="access"]')!.value,
    });
    setStatus(id, said(r, "mirror added"), r.ok);
    if (r.ok) fire(loadMirrors(id));
  },
  "mirror-rm": async ({ id, btn, arm }) => {
    if (!arm("rm:" + btn.dataset["to"])) {
      btn.textContent = "✓?";
      return setStatus(id, "click ✕ again to confirm");
    }
    setStatus(id, "removing…");
    const r = await mgmt("mirror", { id, sub: "rm", to: btn.dataset["to"] });
    setStatus(id, said(r, "mirror removed"), r.ok);
    if (r.ok) fire(loadMirrors(id));
  },
  "vendor-add": async ({ id, drawer, arm }) => {
    const to = drawer.querySelector<HTMLSelectElement>('[data-fld="vto"]')!.value;
    if (!to) return setStatus(id, "no sink container", false);
    const posture = state.lastSlugs.find((x) => x.id === id)?.posture;
    if (!arm("vendor:" + to))
      return setStatus(
        id,
        `click again to copy as ${posture} — writes a full copy + a pre-commit guard into the sink repo`,
      );
    setStatus(id, "vendoring…");
    const r = await mgmt("vendor", { id, to });
    setStatus(id, said(r, "vendored"), r.ok);
    if (r.ok) await refreshAndMirrors(id);
  },
  "vendor-rm": async ({ id, btn, arm }) => {
    if (!arm("vrm:" + btn.dataset["to"])) {
      btn.textContent = "✓?";
      return setStatus(
        id,
        "click ✕ again to confirm — undeclares the copy; it is pruned on the next publish --push-vendors",
      );
    }
    setStatus(id, "removing…");
    const r = await mgmt("vendor-rm", { id, to: btn.dataset["to"] });
    setStatus(id, said(r, "vendor removed"), r.ok);
    if (r.ok) fire(loadMirrors(id));
  },
  "mirror-edit": ({ btn, drawer }) => {
    drawer.querySelector(".mirror-edit")!.innerHTML = mirrorEditHtml(
      mirrorRows.get(btn.dataset["to"]!)!,
    );
  },
  "mirror-save": async ({ id, btn, drawer }) => {
    const box = drawer.querySelector(".mirror-edit")!;
    const val = (f: string) =>
      box.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-fld="m-${f}"]`)!.value.trim();
    setStatus(id, "saving…");
    const r = await mgmt("mirror", {
      id,
      sub: "update",
      to: btn.dataset["to"],
      listed: val("listed"),
      title: val("title"),
      description: val("description"),
      tags: val("tags"),
    });
    setStatus(id, said(r, "mirror updated"), r.ok);
    if (r.ok) {
      box.innerHTML = "";
      fire(loadMirrors(id));
    }
  },
  render: async ({ id }) => {
    if (renderJobs.get(id)?.state === "running") return;
    setStatus(id, "starting render…");
    const r = await mgmt("render", { action: "start", id });
    setStatus(id, r.ok ? "" : said(r, ""), r.ok ? undefined : false);
    if (r.job) {
      renderJobs.set(id, r.job);
      fire(pollRender(id));
    }
  },
  "render-cancel": async ({ id }) => {
    const r = await mgmt("render", { action: "cancel", job: renderJobs.get(id)!.id }); // ✕ shows only for a running job
    if (r.job) renderJobs.set(id, r.job);
  },
  rollback: async ({ id, btn, arm }) => {
    const commit = btn.dataset["commit"];
    if (!arm("rollback:" + commit))
      return setStatus(id, `click restore again to roll this viz back to ${commit}`);
    setStatus(id, "restoring…");
    const r = await mgmt("rollback", { id, commit });
    setStatus(id, said(r, "restored"), r.ok);
    if (r.ok) {
      await refreshAfter();
      fire(loadHistory(id));
    }
  },
  "create-from": async ({ id, drawer }) => {
    const slug = drawer.querySelector<HTMLInputElement>('[data-fld="newSlug"]')!.value.trim();
    if (!slug) return setStatus(id, "slug required", false);
    // Opened NOW, inside the click, so no popup blocker objects; pointed at the viz once it exists.
    const tab = window.open("", "_blank");
    setStatus(id, "creating…");
    const r = await mgmt("create", { from: id, slug });
    if (r.ok && r.id) {
      if (tab) tab.location = "/" + r.id.split("/").map(encodeURIComponent).join("/") + "/";
      state.openDrawerId = null;
      await refreshAfter();
    } else {
      tab?.close();
      setStatus(id, said(r, ""), false);
    }
  },
  "vendor-sync": async ({ id, arm }) => {
    if (!arm("vsync:" + id))
      return setStatus(id, "click re-sync again to confirm — overwrites this copy from its origin");
    setStatus(id, "re-syncing…");
    const r = await mgmt("vendor-sync", { id });
    setStatus(id, said(r, "re-synced"), r.ok);
    if (r.ok) await refreshAfter();
  },
  delete: async ({ id, arm }) => {
    if (!arm("delete:" + id))
      return setStatus(id, "click delete again to confirm — this removes the folder");
    setStatus(id, "deleting…");
    const r = await mgmt("delete", { id });
    if (r.ok) {
      state.openDrawerId = null;
      await refreshAfter();
    } else setStatus(id, said(r, ""), false);
  },
};

/** "link" and "unlink" are one write: the entry typed, or the one chip removed. */
async function linkAct({ id, act, btn, drawer }: ActCtx): Promise<void> {
  const body =
    act === "link"
      ? {
          id,
          "linked-from": drawer
            .querySelector<HTMLInputElement>('[data-fld="linkedFrom"]')!
            .value.trim(),
        }
      : { id, "unlinked-from": btn.dataset["link"] };
  if (!body["linked-from"] && !body["unlinked-from"]) return setStatus(id, "entry required", false);
  setStatus(id, "saving…");
  const r = await mgmt("update", body);
  if (r.ok) {
    await refreshAfter();
    reopenRender();
  } // the open drawer is not re-rendered by the poll
  setStatus(id, said(r, "saved"), r.ok);
}

async function onSlugsClick(e: MouseEvent): Promise<void> {
  const btn = closestTo(e, "[data-act]");
  if (!btn) return;
  const act = btn.dataset["act"];
  const id = btn.closest<HTMLElement>(".slug, .slug-drawer")!.dataset["id"]!; // every [data-act] is in a row or its drawer
  /* c8 ignore next -- every delegated [data-act] button carries a data-act; the undefined arm only narrows the type for the ACTS lookup */
  const handler = act === undefined ? undefined : ACTS[act];
  if (act !== undefined && handler)
    await handler({ btn, id, act, drawer: drawerOf(id)!, arm: makeArm(btn, id) });
}
$("#slugs").addEventListener("click", (e) => {
  fire(onSlugsClick(e));
});

// Tag chip entry: Enter/comma commits the typed tag (datalist suggests existing
// ones as you type); Backspace on an empty input removes the last chip.
$("#slugs").addEventListener("keydown", (e) => {
  const input = closestTo(e, ".tag-input");
  if (!(input instanceof HTMLInputElement)) return;
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const v = input.value.trim().replace(/,+$/u, "");
    if (!v) return;
    const chips = input.closest(".chips");
    if (
      ![...chips!.querySelectorAll<HTMLElement>(".chip")].some(
        (c) => c.dataset["tag"]!.toLowerCase() === v.toLowerCase(),
      )
    )
      input.insertAdjacentHTML("beforebegin", chipHtml(v));
    input.value = "";
  } else if (e.key === "Backspace" && !input.value) {
    input.closest(".chips")?.querySelector(".chip:last-of-type")?.remove();
  }
});
