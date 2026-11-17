// The house tour: driver.js draws it, this file makes each step move on when the user does it.
// Pass in driver.js's `driver` (from npm in an app, or ./vendor/driver.js.mjs when injected), so one
// file serves both. A step: { id, say, target, done? }, where done is one of
//   { sel, value }  the element's value becomes this (a select, an input)
//   { sel, text }   the element's text changes to include this
//   { sel }         the element appears
// A step with no done shows "Next ›"; a step with one shows "skip ›" and moves on by itself.
export function startTour(driver, steps, { onStep, onDone, doneText = "Done" } = {}) {
  let stop = () => {};
  const d = driver({
    allowClose: false,
    overlayClickBehavior: "none",
    overlayOpacity: 0.45,
    popoverClass: "tour",
    stagePadding: 6,
    stageRadius: 8,
    duration: 450,
    steps: steps.map((s, i) => ({
      element: s.target,
      data: { id: s.id },
      popover: {
        title: `Step ${i + 1} of ${steps.length}`,
        description: s.say + (s.done ? '<br><small style="opacity:.7">moves on when you do it</small>' : ""),
        showButtons: i === 0 ? ["next"] : ["previous", "next"],
        prevBtnText: "‹ Back",
        nextBtnText: i === steps.length - 1 ? doneText : s.done ? "skip ›" : "Next ›",
      },
    })),
    onHighlighted: (_el, step, { state }) => {
      stop();
      const i = state.activeIndex ?? 0;
      onStep?.({ id: step.data.id, n: i + 1, of: steps.length });
      stop = watch(steps[i], () => d.moveNext());
    },
    onDestroyed: () => {
      stop();
      onDone?.();
    },
  });
  d.drive();
  return d;
}

function watch(step, next) {
  const want = step.done;
  if (!want) return () => {};
  const before = "text" in want ? (document.querySelector(want.sel)?.textContent ?? null) : null;
  const met = () => {
    const el = document.querySelector(want.sel);
    if (!el) return false;
    if ("value" in want) return el.value === want.value;
    if ("text" in want) return (el.textContent || "").includes(want.text) && el.textContent !== before;
    return true;
  };
  const t = setInterval(() => {
    if (met()) {
      clearInterval(t);
      next();
    }
  }, 300);
  return () => clearInterval(t);
}
