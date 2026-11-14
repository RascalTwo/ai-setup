export interface Routes {
  "/stage": { body: null; reply: { now: string; before: string | null } };
  "/reset": { body: null; method: "POST"; reply: { ok: boolean; message: string } };
  "/cmd": {
    body: { side: "now" | "before"; args: string[] };
    reply: { ok: boolean; output: string };
  };
  // ui-narration's cursor script (the skill's one file), for the page's own ▶ Play over the guided terminal
  "/narrate": { body: null; reply: string };
  "/sent": {
    body: { words: string; decision: "Accepted" | "Changes" };
    // the kit relay's Relayed (kit/server/kelpie-relay.ts) or approve.ts's Approved, spelled out:
    // page code can't import a server file
    reply: {
      outcome: "approved" | "delivered" | "saved" | "failed" | "no-run" | "refused";
      ok: boolean;
      message: string;
    };
  };
}
