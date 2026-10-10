// grill.ts — pick and Send buttons for a grill-me-viz page. A classic script: the page loads it
// last as <script src="grill.js"> (the viz server strips the types; fallback mode pastes the
// generated grill.js, from `bun run sync:kit` in the viz skill).
//
// Answers go through the viz feedback widget (viz kit feedback.js, ADR 0021), which the viz
// server injects on every live page: every pick and every Send is one line in
// <viz>/.viz-data/feedback.jsonl, beside what the user said or typed. Markup contract (SKILL.md):
//   <section class="round" data-round="2"> … </section>
//   <div class="q"><h3>…</h3> … <button data-pick="Q3:B">…</button> … </div>
//   <button data-send="2">Send round 2</button>
// Picks restore from the widget's log on load, so they survive hot reloads (and, with no
// server, closing the tab). A round's Send and the
// widget's Send are the same action: either one waits for speech still being transcribed.

/** What this page uses of the viz feedback widget (kit feedback.ts declares the whole of it). */
type Feedback = {
  log(e: { type: string; [k: string]: unknown }): Promise<void>;
  send(extra?: { round?: number }): Promise<void>;
  ready: Promise<LogEntry[]>;
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kit's feedback.ts declares window.vizFeedback in full; this page types only the part it uses
const feedback = (): Feedback | undefined => (window as { vizFeedback?: Feedback }).vizFeedback;
declare global {
  interface Window {
    grill?: {
      log: (entry: { type: string; [k: string]: unknown }) => Promise<void>;
      tinyText: (min?: number) => { px: number; text: string }[];
    };
    /** A page can say a logged pick no longer stands (spec mode: the agent answered it), so restore skips it. */
    grillSkip?: (entry: LogEntry, all: LogEntry[]) => boolean;
  }
}
// A type-only export: it makes this file a module for the type checker and Oxlint, and is erased, so the page still loads it as a classic script.
export type IconKind = "attention" | "yours" | "waiting";
declare global {
  interface WindowEventMap {
    "viz-feedback:sent": CustomEvent<{ round?: number }>;
  }
}
type LogEntry = { type: string; at?: string; q?: string; opt?: string; round?: number | null };

const initGrill = (): void => {
  // Newest round at the bottom: jump to it once, the first time it appears, so
  // hot reloads of the same round keep the reader's scroll position.
  const rounds = document.querySelectorAll<HTMLElement>("[data-round]");
  const newest = [...rounds].at(-1);
  const seenKey = `grill-seen:${location.pathname}`;
  if (newest && sessionStorage.getItem(seenKey) !== newest.dataset["round"]) {
    sessionStorage.setItem(seenKey, newest.dataset["round"] ?? "");
    newest.scrollIntoView({ block: "start" });
    if (document.hidden || !document.hasFocus()) queueMicrotask(() => callForAttention());
  }

  // The favicon says whose turn it is: orange "?" = a round you haven't looked at,
  // blue = your turn, grey "…" = sent, Claude's turn. The title carries the same cue.
  const ICONS: Record<IconKind, [string, string]> = {
    attention: ["#ff8c1a", "?"],
    yours: ["#58a6ff", "✎"],
    waiting: ["#6e7681", "…"],
  };
  const baseTitle = document.title;
  function setIcon(kind: IconKind): void {
    const [fill, glyph] = ICONS[kind];
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = Object.assign(document.createElement("link"), { rel: "icon" });
      document.head.append(link);
    }
    link.href =
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='15' fill='${fill}'/><text x='16' y='23' font-size='20' font-weight='900' text-anchor='middle' fill='white' font-family='sans-serif'>${glyph}</text></svg>`,
      );
    document.title =
      (kind === "attention" ? "● Your turn · " : kind === "waiting" ? "… " : "") + baseTitle;
  }
  function callForAttention(): void {
    setIcon("attention");
    const seen = () => {
      if (document.hidden) return;
      setIcon("yours");
      removeEventListener("focus", seen);
      document.removeEventListener("visibilitychange", seen);
    };
    addEventListener("focus", seen);
    document.addEventListener("visibilitychange", seen);
  }
  const lastSend = [...document.querySelectorAll<HTMLButtonElement>("[data-send]")].pop();
  if (!document.title.startsWith("● ")) setIcon(lastSend?.disabled ? "waiting" : "yours");

  // A page that opted out of the widget (or fallback mode, with no kit) has nowhere to save:
  // the buttons still work visually but save nothing.
  const log = async (entry: { type: string; [k: string]: unknown }): Promise<void> => {
    await feedback()?.log(entry);
  };
  // Readability check for the agent: text in the newest round that renders under `min` px
  // tall on this screen. An SVG scaled down to fit a card is the usual culprit; a render
  // check passes it, a human can't read it. Must return [] before a round is handed over.
  const tinyText = (min = 11): { px: number; text: string }[] => {
    const out: { px: number; text: string }[] = [];
    for (const el of [...document.querySelectorAll("[data-round]")]
      .pop()
      ?.querySelectorAll("text, tspan, p, span, div, li, td, label, button") ?? []) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
      if (!own || el.closest(".original, [hidden]")) continue;
      // oxlint-disable-next-line unicorn/prefer-number-coercion -- parseFloat on purpose: "12px" must read as 12, where Number() gives NaN
      const px = Number.parseFloat(getComputedStyle(el).fontSize);
      const h = el instanceof SVGElement ? el.getBoundingClientRect().height : px;
      if (h && h < min)
        out.push({ px: +h.toFixed(1), text: (el.textContent ?? "").trim().slice(0, 40) });
    }
    return out;
  };
  window.grill = { log, tinyText };

  // Each question card is a feedback anchor, so a line said over it is tagged "Q3".
  document.querySelectorAll<HTMLElement>(".q:not(.original .q)").forEach((card) => {
    const n = card.querySelector("h3 .n")?.textContent?.trim();
    if (n && !card.dataset["vizId"]) card.dataset["vizId"] = n;
  });

  // Mark the pick among its siblings and fold its question down to "header → answer".
  const mark = (btn: HTMLElement): HTMLElement | undefined => {
    const q = (btn.dataset["pick"] ?? "").split(":")[0];
    document.querySelectorAll(`[data-pick^="${q}:"]`).forEach((b) => {
      b.classList.toggle("picked", b === btn);
    });
    const card = btn.closest<HTMLElement>(".q");
    if (!card) return undefined;
    let ans = card.querySelector<HTMLElement>("h3 .answer");
    if (!ans)
      card
        .querySelector("h3")
        ?.append((ans = Object.assign(document.createElement("span"), { className: "answer" })));
    if (ans) {
      // "Record, transcribe on Send  [A]": text, then the letter as a right-edge badge.
      const label = btn.querySelector(".opt-label");
      const letter =
        label?.querySelector(".k")?.textContent?.trim() ??
        (btn.dataset["pick"] ?? "").split(":")[1] ??
        "";
      const text = label
        ? [...label.childNodes]
            .filter((n) => !(n instanceof Element && n.classList.contains("k")))
            .map((n) => n.textContent)
            .join("")
            .trim()
        : "";
      ans.innerHTML = "<span class='t'></span><span class='k'></span>";
      ans.querySelector(".k")!.textContent = letter;
      ans.querySelector(".t")!.textContent = text;
    }
    return card;
  };
  // Wrap everything after the header in .body > div once, so the fold can animate its height.
  document.querySelectorAll(".q:not(.original .q)").forEach((card) => {
    const rest = [...card.children].filter((el) => el.tagName !== "H3");
    const body = Object.assign(document.createElement("div"), { className: "body" });
    const inner = document.createElement("div");
    inner.append(...rest);
    body.append(inner);
    card.append(body);
  });
  const fold = (card: HTMLElement | null | undefined, delay: number) =>
    card && setTimeout(() => card.classList.add("collapsed"), delay);

  // oxlint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return -- event handlers cannot be awaited; a rejection surfaces as an unhandled rejection, as it always did
  document.addEventListener("click", async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || e.altKey) return; // Alt-click belongs to the feedback widget
    if (target.closest(".original")) return; // an archived question: look, don't answer
    const folded = target.closest(".q.collapsed");
    if (folded) {
      folded.classList.remove("collapsed");
      return;
    }
    const pick = target.closest<HTMLElement>("[data-pick]");
    const send = target.closest<HTMLElement>("[data-send]");
    if (pick) {
      if (pick.classList.contains("picked")) {
        fold(pick.closest<HTMLElement>(".q"), 0); // same answer again: just fold
        return;
      }
      const [q, opt] = (pick.dataset["pick"] ?? "").split(":");
      fold(mark(pick), 450); // a beat to see the highlight before it folds
      await log({
        type: "pick",
        q,
        opt,
        round: +(pick.closest<HTMLElement>("[data-round]")?.dataset["round"] ?? "") || null,
      });
    } else if (send) {
      await feedback()?.send({ round: +(send.dataset["send"] ?? "") });
    }
  });

  // However the round was sent (its button or the widget's), show it as sent.
  const markSent = (round: number | null | undefined): void => {
    const sb = document.querySelector<HTMLButtonElement>(`[data-send="${round}"]`);
    if (sb) {
      sb.disabled = true;
      sb.textContent = "Sent ✓";
    }
    if (sb && sb === lastSend && !document.title.startsWith("● ")) setIcon("waiting");
  };
  window.addEventListener("viz-feedback:sent", (e) => {
    markSent(e.detail.round);
  });

  // Restore: replay picks oldest-first so the latest per question ends up marked,
  // and show already-sent rounds as sent. The widget holds the log wherever it keeps it
  // (the viz server live, the browser in a build); it may start before or after this script.
  const restore = (all: LogEntry[]): void => {
    for (const e of all) {
      if (window.grillSkip?.(e, all)) continue;
      const btn =
        e.type === "pick" && document.querySelector<HTMLElement>(`[data-pick="${e.q}:${e.opt}"]`);
      if (btn) {
        if (btn.closest(".original")) mark(btn);
        else fold(mark(btn), 0);
      }
      if (e.type === "send") markSent(e.round);
    }
  };
  const whenReady = (): void => {
    feedback()
      ?.ready.then(restore)
      .catch((e: unknown) => {
        console.warn("grill:", e);
      });
  };
  if (feedback()) whenReady();
  else addEventListener("viz-feedback:ready", whenReady, { once: true });
};
// A page that renders its cards after load (spec mode: <body data-grill-late>) starts this with a
// "grill:start" event once they exist.
addEventListener(
  Object.hasOwn(document.body.dataset, "grillLate") ? "grill:start" : "DOMContentLoaded",
  initGrill,
  { once: true },
);
