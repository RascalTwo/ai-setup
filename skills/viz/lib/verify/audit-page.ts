// lib/verify/audit-page.ts — the mechanical layout audit verify runs against whatever is on screen.
import type { Page } from "puppeteer-core";

import { errMessage } from "./capture.ts";

/** Mechanical layout findings (overflow, clipping, blank render) + a mark census, surfaced on stdout so the agent can fix layout without paying vision tokens to read the screenshot. */
export type Layout = { findings: string[]; census: string; words: number; graphical: number };

// ---------------------------------------------------------------------------
// Layout audit. Runs on EVERY verify, against whatever is on screen — no opt-in,
// no import required by the viz.
//
// Why it's here and not left to kit/viz.js's vizAudit(): layout is the single
// largest rework class in the viz git history (overflowing labels, crammed nodes,
// content past the edge), and the only signal for it used to be "read latest.png
// and squint" — which costs ~1-2k vision tokens per iteration AND still missed
// things. These checks are mechanical, so they belong in the tool, reported as
// text naming the exact selector. Eyes are still needed for AESTHETIC judgment
// (spacing, hierarchy, does-it-read) — this only covers what's measurable.
export const auditPage = async (page: Page): Promise<Layout> => {
  const result = await page
    // oxlint-disable-next-line complexity -- the audit runs in the page as one function (it cannot call back into this file); each numbered check reads the same DOM
    .evaluate(() => {
      const out: string[] = [];
      // Readable, clickable-ish identifier for an element.
      const sel = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        const vid = el.getAttribute("data-viz-id"); // oxlint-disable-line unicorn/prefer-dom-node-dataset -- sel() takes any Element, which has no .dataset
        if (vid) return `[data-viz-id="${vid}"]`;
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing, unicorn/prefer-dom-node-dataset -- the || is on purpose (an empty data-label falls through to aria-label), and Element has no .dataset
        const label = el.getAttribute("data-label") || el.getAttribute("aria-label");
        const cls = [...el.classList]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join("");
        return `${el.tagName.toLowerCase()}${cls}${label ? ` "${label.slice(0, 30)}"` : ""}`;
      };
      const txt = (el: Element) =>
        (el.textContent || "").trim().replaceAll(/\s+/gu, " ").slice(0, 40);
      const cap = (arr: string[], n: number, what: string) =>
        arr.length > n ? [...arr.slice(0, n), `…and ${arr.length - n} more ${what}`] : arr;

      // 1. SVG <text> spilling past ITS OWN box.
      //    Attribution matters more than the overflow math here: a <g> often groups
      //    several box+label pairs, so "first <rect> in the closest <g>" (the old
      //    vizAudit heuristic) measures a label against a sibling's box and reports a
      //    huge phantom spill. Instead, pick the rect whose bounds contain the text's
      //    CENTRE. If no rect owns the label, we can't attribute it — skip rather than
      //    guess, because a false positive here costs more than a missed one.
      const spills: string[] = [];
      for (const t of document.querySelectorAll<SVGGraphicsElement>("svg text")) {
        let tb: DOMRect;
        try {
          tb = t.getBBox();
        } catch {
          continue;
        }
        if (!tb.width) continue;
        // Attribute by the text's ANCHOR point (its x/y attributes — where the author
        // placed it), not its rendered centre. A badly overflowing label has its centre
        // outside its own box, so centre-matching would silently skip the very case we
        // most want to catch; the anchor stays put no matter how far the glyphs spill.
        const num = (v: string | null, fb: number) => {
          // oxlint-disable-next-line unicorn/prefer-number-coercion -- parseFloat on purpose: "12px" must read as 12, where Number() gives NaN
          const n = Number.parseFloat((v ?? "").trim().split(/[\s,]+/u)[0] ?? "");
          return Number.isFinite(n) ? n : fb;
        };
        const cx = num(t.getAttribute("x"), tb.x + tb.width / 2);
        const cy = num(t.getAttribute("y"), tb.y + tb.height / 2);
        let own: DOMRect | null = null;
        for (const r of t.closest("g")?.querySelectorAll<SVGGraphicsElement>("rect") ?? []) {
          let rb: DOMRect;
          try {
            rb = r.getBBox();
          } catch {
            continue;
          }
          // Innermost wins if boxes nest (e.g. a card inside a panel).
          if (
            cx >= rb.x &&
            cx <= rb.x + rb.width &&
            cy >= rb.y &&
            cy <= rb.y + rb.height &&
            (!own || rb.width * rb.height < own.width * own.height)
          )
            own = rb;
        }
        if (!own) continue;
        const over = Math.max(
          own.x - tb.x,
          tb.x + tb.width - (own.x + own.width),
          own.y - tb.y,
          tb.y + tb.height - (own.y + own.height),
        );
        // 5px tolerance: <text> doesn't clip, it just draws outside, so a 2-4px
        // overhang is invisible in practice. Verified against the real corpus —
        // at 1px this reported cosmetic noise; at 5px the survivors were all
        // genuinely visible overflows.
        if (over > 5)
          spills.push(`${sel(t)} "${txt(t)}" spills ${Math.round(over)}px past its box`);
      }
      out.push(...cap(spills, 8, "text overflows").map((s) => `text-overflow: ${s}`));

      // 2. Content clipped by an overflow:hidden/clip ancestor — the SILENT failure.
      //    labelBox() deliberately clips rather than spills, so a too-long label looks
      //    fine in a screenshot while missing words. Nothing else catches this.
      const clipped: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const cs = getComputedStyle(el);
        if (
          !/hidden|clip/u.test(cs.overflow) &&
          !/hidden|clip/u.test(cs.overflowY) &&
          !/hidden|clip/u.test(cs.overflowX)
        )
          continue;
        if (!el.clientHeight && !el.clientWidth) continue;
        // A 1×1 clipped box is the screen-reader-only pattern (reveal's .aria-status
        // in every deck) — hidden on purpose, not cut off.
        if (el.clientHeight <= 1 && el.clientWidth <= 1) continue;
        // Cut off on purpose (a scrolling ticker, art that bleeds past its frame): the author says so
        // with data-verify-clip-ok on the box or any ancestor, and owns that claim.
        if (el.closest("[data-verify-clip-ok]")) continue;
        let dy = el.scrollHeight - el.clientHeight;
        let dx = el.scrollWidth - el.clientWidth;
        if (dy > 2 || dx > 2) {
          // Parked content (a deck's off-stage slides: visibility:hidden, nudged past the edge) pads the scroll size but
          // cuts nothing off the screen: measure again with it out of layout.
          const parked = [...el.querySelectorAll<HTMLElement>("*")].filter(
            (c) => getComputedStyle(c).visibility === "hidden",
          );
          const css = parked.map((c) => c.style.cssText);
          for (const c of parked) c.style.setProperty("display", "none", "important");
          dy = el.scrollHeight - el.clientHeight;
          dx = el.scrollWidth - el.clientWidth;
          parked.forEach((c, i) => {
            c.style.cssText = css[i] ?? "";
          });
        }
        if (dy > 2 || dx > 2) {
          const dir = dy > 2 ? `${dy}px vertically` : `${dx}px horizontally`;
          clipped.push(`${sel(el)}${txt(el) ? ` "${txt(el)}"` : ""} is cut off by ${dir}`);
        }
      }
      out.push(...cap(clipped, 8, "clipped elements").map((s) => `clipped: ${s}`));

      // 3. Anything wider than the viewport — "the Nth element blew past the edge".
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 2) {
        const wide = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 2)
          .slice(0, 4)
          .map(sel);
        out.push(
          `viewport-overflow: page scrolls horizontally (${de.scrollWidth}px > ${de.clientWidth}px viewport)` +
            (wide.length > 0 ? ` — widest: ${wide.join(", ")}` : ""),
        );
      }

      // 4. Content escaping a fixed OG/poster frame. A 1200×630 card that overflows is
      //    silently cropped at publish, so this must fail loudly before it ships.
      for (const card of document.querySelectorAll<HTMLElement>(".og-card, .card.og-card")) {
        const cb = card.getBoundingClientRect();
        const out2 = [...card.querySelectorAll<HTMLElement>("*")].filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width &&
            r.height &&
            (r.right > cb.right + 1 ||
              r.bottom > cb.bottom + 1 ||
              r.left < cb.left - 1 ||
              r.top < cb.top - 1)
          );
        });
        if (out2.length > 0)
          out.push(
            `og-card-overflow: ${out2.length} element(s) escape the card frame — ${out2.slice(0, 3).map(sel).join(", ")}`,
          );
      }

      // 5. Did anything actually render? A 404'd CDN import yields a blank page that
      //    otherwise passes clean (no failed request, no exception).
      const count = (k: string) => document.querySelectorAll(k).length;
      const marks = {
        rect: count("rect"),
        path: count("path"),
        circle: count("circle"),
        line: count("line"),
        text: count("text"),
        canvas: count("canvas"),
        img: count("img"),
      };
      const total = Object.values(marks).reduce((a, b) => a + b, 0);
      const words = (document.body.innerText || "").trim().length;
      if (!total && words < 10)
        out.push(
          "blank-render: page has no SVG/canvas marks and almost no text — did a script or import fail?",
        );
      const census = Object.entries(marks)
        .filter(([, v]) => v)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      // Graphical marks = the ones that can encode a variable in space. <text> and <img>
      // deliberately excluded: a label is not an encoding, and an image is somebody
      // else's. This feeds the visual-density line below — NOT the findings list.
      const graphical = marks.rect + marks.path + marks.circle + marks.line + marks.canvas;
      return { findings: out, census: census || "nothing", words, graphical };
    })
    .catch((e: unknown) => ({
      findings: [`layout audit failed: ${errMessage(e)}`],
      census: "?",
      words: 0,
      graphical: 0,
    }));
  return result;
};
