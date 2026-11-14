// What Send types into the build agent's pane: the decision, how far the human got, and everything
// they said since the last delivered Send, filed under the step that was on screen when they said it.
import { foldFeedback, type Entry } from "@viz/kit/feedback-text.js";
import type { Step, Walk } from "./walk.schema.ts";

export type Decision = "Accepted" | "Changes";

/** The step a feedback line was said at: the page keeps {"step":"S3"} in its URL hash. */
export function stepOf(e: { where?: { hash?: string } }): string | null {
  try {
    const h: unknown = JSON.parse(decodeURIComponent((e.where?.hash ?? "").slice(1)));
    return h && typeof h === "object" && "step" in h && typeof h.step === "string" ? h.step : null;
  } catch {
    return null;
  }
}

const plain = (html: string) => html.replaceAll(/<[^>]+>/gu, "").trim();
const short = (s: string) => (s.length > 70 ? `${s.slice(0, 69)}…` : s);

export function sendWords(
  walk: Walk,
  decision: Decision,
  reached: ReadonlySet<string>,
  log: Entry[],
  vizId: string,
): string {
  const { lines, sends } = foldFeedback(log);
  const since = sends.at(-1)?.at ?? "";
  const said = lines.filter((l) => !l.done && l.text && l.at > since);
  const order: (string | null)[] = walk.steps.map((s) => s.id);
  order.push(null); // what was said off any step goes last
  const groups = order.flatMap((id) => {
    const here = said.filter(
      (l) => stepOf(l) === id || (id === null && !order.includes(stepOf(l))),
    );
    if (here.length === 0) return [];
    const s = walk.steps.find((x) => x.id === id);
    const head = s
      ? `${s.id}${s.example ? ` (${s.example})` : ""} [${s.persona}], "${short(plain(s.say))}":`
      : "Before the first step:";
    return [head].concat(here.map((l) => `  - "${l.text}"`));
  });
  const verdict = decision === "Accepted" ? "Accepted" : "Changes";
  return [
    `Demo of ${walk.change.commit} "${walk.change.subject}": ${verdict}. Steps reached ${reached.size}/${walk.steps.length}.`,
    groups.length > 0
      ? `What they said, by step:\n${groups.join("\n")}`
      : "They said nothing along the way.",
    `Full detail: viz feedback ${vizId} --detail`,
  ].join("\n\n");
}

/** Terminal output as HTML, with the rows the step asks the human to read marked. */
export const highlight = (output: string, look: string[]): string =>
  output
    .split("\n")
    .map((l) => {
      const safe = l.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return look.some((k) => l.includes(k)) ? `<mark>${safe}</mark>` : safe;
    })
    .join("\n");

/** Why Send can't be pressed yet, or null when it can. */
export const sendBlocked = (decision: Decision | null): string | null =>
  decision ? null : "Pick Accept or Changes first: Send carries your decision.";

/** Paired bars for one measure row: each bar's length is its value, on the row's own scale (units differ by row). */
export function barWidths(m: { before: number; after: number }): { before: number; after: number } {
  const top = Math.max(m.before, m.after, Number.EPSILON);
  const pct = (v: number) => Math.round((Math.max(v, 0) / top) * 1000) / 10;
  return { before: pct(m.before), after: pct(m.after) };
}

/** The agent kind's two transcripts, up to and including step `upto`: each step's recording under its id. */
export function transcript(
  steps: Pick<Step, "id" | "clip">[],
  upto: number,
  side: "now" | "before",
  read: (src: string) => string,
): string {
  return steps
    .slice(0, upto + 1)
    .flatMap((s) => {
      const src = side === "now" ? s.clip?.src : s.clip?.before;
      return src ? [`── ${s.id} ──\n${read(src).trim()}`] : [];
    })
    .join("\n\n");
}
