// The Timeline Studio side of the Tracker interface. The only code that knows the plan's API:
// a second tracker is a second file like this one. Schema: <base>/api/openapi.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Review, TaskView, Tracker } from "./dispatcher.ts";

export const BY = "kelpie"; // sent as x-timeline-by: how our comments are told apart from the human's
const WAS = "agent-dispatcher"; // its name before the rename: comments written then still carry it
const LABELS: Record<Exclude<Review, "none">, string> = { needs: "Needs review", changes: "Changes requested", approved: "Approved" };
export const AGENT = "Agent"; // the For (shapes) value that hands a task to agents

// `by` is who the plan credits: the dispatcher writes as BY, so `mine` tells its comments apart.
// Bumped by every write from any tracker in this process, so a second tracker never reads a stale snapshot.
let writes = 0;

export function timelineStudio(configFile = join(process.env.HOME!, ".config/timeline-studio/config.json"), by = BY): Tracker {
  const cfg = JSON.parse(readFileSync(configFile, "utf8"));
  const base = (cfg.base ?? "https://timeline-studio.rascaltwo.com").replace(/\/$/, "");
  // The token is the whole credential: header only, never in a URL or a message.
  const headers = { "x-timeline-token": cfg.token, "x-timeline-by": by, "content-type": "application/json" };
  let snap: Promise<{ doc: any; ready: Map<string, any> }> | null = null, snapAt = -1; // one read per process, until anyone writes

  async function call(path: string, body?: object) {
    const res = await fetch(base + path, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Timeline Studio ${path}: ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }
  const read = () => {
    if (snapAt !== writes) { snap = null; snapAt = writes; }
    return snap ??= Promise.all([call("/api/plan"), call("/api/ready?all=1")])
      .then(([plan, ready]) => ({ doc: plan.doc, ready: new Map((ready as any[]).map(r => [r.id, r])) }));
  };
  const cmd = async (c: object) => { await call("/api/commands", { cmd: { ...c, at: new Date().toISOString() } }); writes++; };

  return {
    async listTasks(color) {
      const { doc, ready } = await read();
      const agent = doc.shapes.find((s: any) => s.label === AGENT)?.id;
      if (!agent) throw new Error(`the plan has no For value labelled "${AGENT}": run the one-time plan setup`);
      const reviewOf = (border: string): Review => {
        const label = doc.borders.find((b: any) => b.id === border)?.label;
        return (Object.keys(LABELS) as (keyof typeof LABELS)[]).find(k => LABELS[k] === label) ?? "none";
      };
      return doc.tasks.filter((t: any) => t.shape === agent && (t.color ?? []).includes(color)).map((t: any): TaskView => {
        const r = ready.get(t.id);
        return {
          id: t.id, label: t.label, desc: t.desc ?? "", ready: r?.ready === true, rank: r?.rank ?? r?.suggestedRank ?? null, // your rank; until you rank it, the suggestion
          status: t.done ? "done" : (r?.status ?? "todo"), review: reviewOf(t.border),
          refined: t.refinedAt != null, noQueue: t.noQueue === true, waitingOn: r?.waitingOn ?? null,
          comments: (t.comments ?? []).map((c: any) => ({ text: c.text, at: c.at, mine: c.by === BY || c.by === WAS })),
        };
      });
    },
    start: id => cmd({ type: "startTask", id }),
    stop: id => cmd({ type: "stopTask", id }),
    finish: id => cmd({ type: "finishTask", id }),
    comment: (id, text) => cmd({ type: "addComment", id, comment: { text } }),
    setDesc: (id, desc) => cmd({ type: "setTaskDesc", id, desc }),
    setNoQueue: id => cmd({ type: "setNoQueue", id, noQueue: true }),
    signOff: id => cmd({ type: "setRefined", id, refinedAt: new Date().toISOString() }),
    async setReview(id, v) {
      const { doc } = await read();
      const label = v === "none" ? "—" : LABELS[v];
      const b = doc.borders.find((b: any) => b.label === label);
      if (!b) throw new Error(`the plan has no border value labelled "${label}": run the one-time plan setup`);
      await cmd({ type: "setTaskChannel", id, channel: "border", value: b.id });
    },
  };
}
