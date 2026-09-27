// grill.js — pick and Send buttons for a grill-me-viz page.
//
// Answers go through the viz feedback widget (viz kit feedback.js, ADR 0021), which the viz
// server injects on every live page: every pick and every Send is one line in
// <viz>/.viz-data/feedback.jsonl, beside what the user said or typed. Markup contract (SKILL.md):
//   <section class="round" data-round="2"> … </section>
//   <div class="q"><h3>…</h3> … <button data-pick="Q3:B">…</button> … </div>
//   <button data-send="2">Send round 2</button>
// Picks restore from the log on load, so they survive hot reloads. A round's Send and the
// widget's Send are the same action: either one waits for speech still being transcribed.

addEventListener("DOMContentLoaded", () => {
  // Newest round at the bottom: jump to it once, the first time it appears, so
  // hot reloads of the same round keep the reader's scroll position.
  const rounds = document.querySelectorAll("[data-round]");
  const newest = rounds[rounds.length - 1];
  const seenKey = `grill-seen:${location.pathname}`;
  if (newest && sessionStorage.getItem(seenKey) !== newest.dataset.round) {
    sessionStorage.setItem(seenKey, newest.dataset.round);
    newest.scrollIntoView({ block: "start" });
    if (document.hidden || !document.hasFocus()) queueMicrotask(() => callForAttention());
  }

  // The favicon says whose turn it is: orange "?" = a round you haven't looked at,
  // blue = your turn, grey "…" = sent, Claude's turn. The title carries the same cue.
  const ICONS = { attention: ["#ff8c1a", "?"], yours: ["#58a6ff", "✎"], waiting: ["#6e7681", "…"] };
  const baseTitle = document.title;
  function setIcon(kind) {
    const [fill, glyph] = ICONS[kind];
    const link = document.querySelector("link[rel~='icon']") ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    link.href = "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='15' fill='${fill}'/><text x='16' y='23' font-size='20' font-weight='900' text-anchor='middle' fill='white' font-family='sans-serif'>${glyph}</text></svg>`);
    document.title = (kind === "attention" ? "● Your turn · " : kind === "waiting" ? "… " : "") + baseTitle;
  }
  function callForAttention() {
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
  const lastSend = [...document.querySelectorAll("[data-send]")].pop();
  if (!document.title.startsWith("● ")) setIcon(lastSend?.disabled ? "waiting" : "yours");

  // The route is relative to the page, like api/. Served from a file or a frozen run there
  // is no widget and no route: the buttons still work visually but save nothing.
  const LOG = "_log/feedback";
  const log = (entry) => window.vizFeedback?.log(entry);
  // Readability check for the agent: text in the newest round that renders under `min` px
  // tall on this screen. An SVG scaled down to fit a card is the usual culprit; a render
  // check passes it, a human can't read it. Must return [] before a round is handed over.
  const tinyText = (min = 11) => {
    const out = [];
    for (const el of [...document.querySelectorAll("[data-round]")].pop()?.querySelectorAll("text, tspan, p, span, div, li, td, label, button") ?? []) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || el.closest(".original, [hidden]")) continue;
      const h = el instanceof SVGElement ? el.getBoundingClientRect().height : parseFloat(getComputedStyle(el).fontSize);
      if (h && h < min) out.push({ px: +h.toFixed(1), text: el.textContent.trim().slice(0, 40) });
    }
    return out;
  };
  window.grill = { log, tinyText };

  // Each question card is a feedback anchor, so a line said over it is tagged "Q3".
  document.querySelectorAll(".q:not(.original .q)").forEach((card) => {
    const n = card.querySelector("h3 .n")?.textContent.trim();
    if (n && !card.dataset.vizId) card.dataset.vizId = n;
  });

  // Mark the pick among its siblings and fold its question down to "header → answer".
  const mark = (btn) => {
    const q = btn.dataset.pick.split(":")[0];
    document.querySelectorAll(`[data-pick^="${q}:"]`).forEach((b) => b.classList.toggle("picked", b === btn));
    const card = btn.closest(".q");
    if (!card) return;
    let ans = card.querySelector("h3 .answer");
    if (!ans) card.querySelector("h3")?.append((ans = Object.assign(document.createElement("span"), { className: "answer" })));
    if (ans) {
      // "Record, transcribe on Send  [A]": text, then the letter as a right-edge badge.
      const label = btn.querySelector(".opt-label");
      const letter = label?.querySelector(".k")?.textContent.trim() ?? btn.dataset.pick.split(":")[1];
      const text = label ? [...label.childNodes].filter((n) => !n.classList?.contains("k")).map((n) => n.textContent).join("").trim() : "";
      ans.innerHTML = "<span class='t'></span><span class='k'></span>";
      ans.querySelector(".k").textContent = letter;
      ans.querySelector(".t").textContent = text;
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
  const fold = (card, delay) => card && setTimeout(() => card.classList.add("collapsed"), delay);

  document.addEventListener("click", async (e) => {
    if (e.altKey) return; // Alt-click belongs to the comment overlay
    if (e.target.closest(".original")) return; // an archived question: look, don't answer
    const folded = e.target.closest(".q.collapsed");
    if (folded) return folded.classList.remove("collapsed");
    const pick = e.target.closest("[data-pick]");
    const send = e.target.closest("[data-send]");
    if (pick) {
      if (pick.classList.contains("picked")) return fold(pick.closest(".q"), 0); // same answer again: just fold
      const [q, opt] = pick.dataset.pick.split(":");
      fold(mark(pick), 450); // a beat to see the highlight before it folds
      await log({ type: "pick", q, opt, round: +pick.closest("[data-round]")?.dataset.round || null });
    } else if (send) {
      await window.vizFeedback?.send({ round: +send.dataset.send });
    }
  });

  // However the round was sent (its button or the widget's), show it as sent.
  const markSent = (round) => {
    const sb = document.querySelector(`[data-send="${round}"]`);
    if (sb) (sb.disabled = true), (sb.textContent = "Sent ✓");
    if (sb && sb === lastSend && !document.title.startsWith("● ")) setIcon("waiting");
  };
  addEventListener("viz-feedback:sent", (e) => markSent(e.detail.round));

  // Restore: replay picks oldest-first so the latest per question ends up marked,
  // and show already-sent rounds as sent.
  fetch(LOG)
    .then((r) => (r.ok ? r.json() : []))
    .then((all) => {
      for (const e of all) {
        const btn = e.type === "pick" && document.querySelector(`[data-pick="${e.q}:${e.opt}"]`);
        if (btn) btn.closest(".original") ? mark(btn) : fold(mark(btn), 0);
        if (e.type === "send") markSent(e.round);
      }
    })
    .catch(() => {});
});
