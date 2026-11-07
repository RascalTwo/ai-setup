// grill-expand.js — "Expand all / Collapse all" for a grill-me-viz page. A classic script, plain JS,
// self-contained (own styles, no dependency on the grill.js version), so it drops onto any grill page
// with one <script src="grill-expand.js"></script> after grill.js.
// Expand: every <details> (decisions and their "Show what you were asked") opens, every folded
// question card unfolds. Collapse: back to one line per decision; answered cards fold again.
const initExpand = () => {
  const style = document.createElement("style");
  style.textContent = `#grill-expand{position:fixed;top:12px;right:16px;z-index:50;font:600 13px/1 system-ui,sans-serif;
    background:var(--panel,#161b22);color:var(--text,#e6edf3);border:1px solid var(--border,#30363d);border-radius:8px;padding:8px 14px;cursor:pointer}
    #grill-expand:hover{border-color:var(--muted,#8b949e)}`;
  document.head.append(style);

  const btn = Object.assign(document.createElement("button"), { id: "grill-expand", type: "button" });
  document.body.append(btn);

  // Cards outside an archived .original; only those can be folded by picking.
  const cards = () => [...document.querySelectorAll(".q")].filter((c) => !c.closest(".original"));
  const allOpen = () => [...document.querySelectorAll("details")].every((d) => d.open) && !document.querySelector(".q.collapsed");
  const sync = () => (btn.textContent = allOpen() ? "Collapse all" : "Expand all");

  btn.addEventListener("click", () => {
    const open = !allOpen();
    document.querySelectorAll("details").forEach((d) => (d.open = open));
    cards().forEach((c) => c.classList.toggle("collapsed", !open && !!c.querySelector(".picked")));
    sync();
  });
  document.addEventListener("toggle", sync, true); // toggle doesn't bubble; capture it
  new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  sync();
};
// A page that renders its cards after load (spec mode: <body data-grill-late>) starts this with a
// "grill:start" event once they exist.
addEventListener(document.body.hasAttribute("data-grill-late") ? "grill:start" : "DOMContentLoaded", initExpand, { once: true });
