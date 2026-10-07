// Exhibit 5: "How do you give a two-part answer?" A keyboard-driven review card. Click it, then use
// the arrow keys: step one is happened / didn't, step two is a follow-up whose answer keeps the
// "good" side on the right. Enter takes the default for the kind of thing; Z walks back.
// (Invented plan: a Monday with a meeting, some solo work, a retro.)
import { esc } from "@viz/kit";
import { at, q } from "./util.js";

type Fate = "open" | "carries" | "finished" | "kept" | "deleted";
interface Item {
  id: string;
  label: string;
  when: string;
  meeting: boolean;
  from: number;
  to: number;
  fate: Fate;
}
interface Act {
  key: "ArrowLeft" | "ArrowRight";
  label: string;
  good: boolean;
  def: boolean;
  next?: "yes" | "no";
  fate?: Fate;
}

const fresh = (): Item[] => [
  {
    id: "standup",
    label: "Team standup",
    when: "Mon 9:00–9:15",
    meeting: true,
    from: 9,
    to: 9.25,
    fate: "open",
  },
  {
    id: "readme",
    label: "Write the sync README",
    when: "Mon 10:00–12:00",
    meeting: false,
    from: 10,
    to: 12,
    fate: "open",
  },
  {
    id: "retro",
    label: "Sprint retro",
    when: "Mon 13:00–14:00",
    meeting: true,
    from: 13,
    to: 14,
    fate: "open",
  },
];
const SAY: Record<Fate, string> = {
  open: "",
  carries: "logged as a session; the task carries on",
  finished: "logged as a session; the task is finished",
  kept: "planned block removed; the task stays in the queue",
  deleted: "task deleted",
};

export function initKeys(): void {
  const root = q<HTMLElement>(document, "#ex5-stage");
  root.innerHTML = `
    <div class="kcard" id="kcard" tabindex="0" role="group" aria-label="Review card: use the left and right arrow keys" data-viz-id="kcard" data-label="the review card">
      <div class="when" id="kwhen"></div>
      <div class="what" id="kwhat"></div>
      <div class="ask" id="kask"></div>
      <div class="keys" id="kkeys"></div>
      <div class="daystrip"><svg id="kday" viewBox="0 0 700 150" role="img" aria-label="Monday as the plan sees it"></svg></div>
      <div class="trail" id="ktrail"></div>
    </div>`;
  const card = q<HTMLElement>(root, "#kcard");
  let items = fresh();
  let step: "yes" | "no" | null = null;
  const path: string[] = [];
  const undo: { id: string }[] = [];
  let note = "Click the card, then press ← or →. Keys, not buttons, are the point.";
  let focused = false;

  const current = (): Item | undefined => items.find((i) => i.fate === "open");

  function actions(it: Item): Act[] {
    if (step === "yes")
      return [
        { key: "ArrowLeft", label: "carries on", good: false, def: !it.meeting, fate: "carries" },
        { key: "ArrowRight", label: "finished", good: true, def: it.meeting, fate: "finished" },
      ];
    if (step === "no")
      return [
        {
          key: "ArrowLeft",
          label: "delete the task",
          good: false,
          def: it.meeting,
          fate: "deleted",
        },
        { key: "ArrowRight", label: "keep the task", good: true, def: !it.meeting, fate: "kept" },
      ];
    return [
      { key: "ArrowLeft", label: "it didn't happen", good: false, def: false, next: "no" },
      { key: "ArrowRight", label: "it happened", good: true, def: false, next: "yes" },
    ];
  }

  function draw(): void {
    const it = current();
    q<HTMLElement>(card, "#kwhen").textContent = it ? it.when : "";
    q<HTMLElement>(card, "#kwhat").textContent = it ? it.label : "All caught up.";
    q<HTMLElement>(card, "#kask").textContent = !it
      ? "Reset to play again."
      : step === "yes"
        ? "Finished?"
        : step === "no"
          ? "Keep the task?"
          : "Did it happen?";
    const acts = it ? actions(it) : [];
    q<HTMLElement>(card, "#kkeys").innerHTML = !it
      ? `<button class="key" data-reset data-viz-id="key-reset" data-label="replay Monday"><span class="cap-k">↺</span><span>replay Monday</span></button>`
      : acts
          .map(
            (a, i) =>
              `<button class="key ${a.good ? "good" : "bad"}" data-i="${i}" data-viz-id="key-${a.key === "ArrowLeft" ? "left" : "right"}" data-label="${a.key === "ArrowLeft" ? "left arrow" : "right arrow"}: ${esc(a.label)}"><span class="cap-k">${a.key === "ArrowLeft" ? "←" : "→"}</span><span>${esc(a.label)}${a.def ? `<small><span class="def">Enter</span> takes this for a ${it?.meeting ? "meeting" : "solo task"}</small>` : ""}</span></button>`,
          )
          .join("");
    q<HTMLElement>(card, "#ktrail").innerHTML =
      (path.length > 0 ? `<b style="color:var(--text)">${esc(path.join("  ▸  "))}</b> ` : "") +
      esc(note) +
      (undo.length > 0 ? `  ·  Z undoes (${undo.length})` : "");
    // the day strip
    const x = (h: number): number => 150 + (h - 8) * 62;
    let s = "";
    for (let h = 8; h <= 16; h += 2)
      s += `<line x1="${x(h)}" y1="6" x2="${x(h)}" y2="116" stroke="var(--border)"/><text x="${x(h)}" y="136" text-anchor="middle" font-size="12" fill="var(--faint)">${h}:00</text>`;
    items.forEach((t, k) => {
      const y = 12 + k * 34;
      const st =
        t.fate === "open"
          ? `fill="color-mix(in srgb, var(--warn) 30%, transparent)" stroke="var(--warn)" stroke-dasharray="5 3"`
          : t.fate === "carries"
            ? `fill="color-mix(in srgb, var(--good) 55%, transparent)" stroke="none"`
            : t.fate === "finished"
              ? `fill="var(--faint)" stroke="none"`
              : t.fate === "kept"
                ? `fill="none" stroke="var(--muted)" stroke-dasharray="4 3"`
                : `fill="none" stroke="var(--danger)" stroke-dasharray="4 3"`;
      s += `<rect x="${x(t.from)}" y="${y}" width="${Math.max(10, x(t.to) - x(t.from))}" height="26" rx="5" ${st} data-viz-id="strip-${t.id}" data-label="${esc(t.label)}: ${t.fate}"/>`;
      s += `<text x="6" y="${y + 18}" font-size="13" fill="${t.fate === "deleted" ? "var(--faint)" : "var(--text)"}" ${t.fate === "deleted" ? 'text-decoration="line-through"' : ""}>${esc(t.label)}</text>`;
      if (t.fate !== "open")
        s += `<text x="${x(t.to) + 8}" y="${y + 18}" font-size="12" fill="var(--muted)">${t.fate}</text>`;
    });
    q<SVGSVGElement>(card, "#kday").innerHTML = s;
    card.classList.toggle("focus", focused);
  }

  function act(a: Act): void {
    const it = current();
    if (!it) return;
    if (a.next) {
      step = a.next;
      path.push(`${a.key === "ArrowLeft" ? "←" : "→"} ${a.label}`);
      note = "";
    } else if (a.fate) {
      undo.push({ id: it.id });
      it.fate = a.fate;
      step = null;
      path.length = 0;
      note = `${it.label}: ${SAY[a.fate]}.`;
    }
    draw();
  }
  function back(): void {
    if (step) {
      step = null;
      path.length = 0;
      note = "";
      draw();
      return;
    }
    const u = undo.pop();
    const it = u && items.find((i) => i.id === u.id);
    if (!it) return;
    it.fate = "open";
    note = `Undone: ${it.label} is unconfirmed again.`;
    draw();
  }
  function press(key: string): void {
    const btn = card.querySelector<HTMLElement>(
      `[data-viz-id="key-${key === "ArrowLeft" ? "left" : "right"}"]`,
    );
    btn?.classList.add("press");
    window.setTimeout(() => btn?.classList.remove("press"), 140);
  }

  card.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const it = current();
    if (e.key === "z" || e.key === "Z" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      back();
      return;
    }
    if (!it) return;
    const acts = actions(it);
    const a =
      e.key === "Enter" && step ? acts.find((x) => x.def) : acts.find((x) => x.key === e.key);
    if (!a) return;
    e.preventDefault();
    e.stopPropagation(); // the page's other steppers also listen for arrows
    press(a.key);
    act(a);
  });
  card.addEventListener("click", (e) => {
    card.focus();
    const b =
      e.target instanceof Element ? e.target.closest<HTMLElement>("[data-i], [data-reset]") : null;
    const it = current();
    if (b?.dataset["reset"] !== undefined) {
      items = fresh();
      undo.length = 0;
      note = "A fresh Monday.";
      draw();
    } else if (b && it) act(at(actions(it), Number(b.dataset["i"])));
  });
  card.addEventListener("focus", () => {
    focused = true;
    card.classList.add("focus");
    if (path.length === 0 && undo.length === 0) {
      note = "Keys are live: ← or →.";
      draw();
    }
  });
  card.addEventListener("blur", () => {
    focused = false;
    card.classList.remove("focus");
  });
  draw();
}
