// A stand-in `overlay` for a page opened in a plain browser (viz verify, a screenshot, a review):
// it replays a snapshot the host saved with `show --save-snapshot FILE`, so the page draws the same
// picture without the host. Copy this file next to your page (or inline it) and start with:
//   const overlay = window.overlay ?? fromSnapshot(await (await fetch("snapshot.json")).json());
// Contract: ../reference/contract.md.

/** Same key for the same spec, whatever its key order. */
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const key = (spec) => JSON.stringify(canon(spec));
const GONE = { rect: null, window: null, shown: false, covered: false, gone: true, error: "not in the snapshot" };

export function fromSnapshot(snap) {
  const states = new Map((snap.tracks ?? []).map((t) => [key(t.spec), t.state ?? GONE]));
  const later = (cb, v) => queueMicrotask(() => cb(v));
  return {
    standalone: true,
    title: snap.title,
    origin: snap.origin,
    display: snap.display,
    visible: snap.visible,
    target: snap.target ?? null,
    shown: true,
    data: snap.data ?? null,
    track(spec, cb) { later(cb, states.get(key(spec)) ?? GONE); return () => {}; },
    async elements(app, opts = {}) {
      const same = (e) => e.app === app && (e.match ?? null) === (opts.match ?? null) && (e.role ?? null) === (opts.role ?? null) && Boolean(e.web) === Boolean(opts.web);
      return (snap.elements ?? []).find(same)?.result ?? [];
    },
    send(text) { console.log("[overlay.send]", text); },
    close() {},
    on(event, cb) {
      if (event === "target" && snap.target) later(cb, snap.target);
      if (event === "visibility") later(cb, { visible: true, reason: "standalone" });
      if (event === "display") later(cb, this);
      if (event === "data" && snap.data != null) later(cb, snap.data);
      return () => {};
    },
  };
}
