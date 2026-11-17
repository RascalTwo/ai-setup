// Talking to this viz's own api/: reads (getJson) and the writes, which shell out to the viz CLI (mgmt).
import type { Mgmt } from "./dashboard-types.js";

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data: unknown = await res.json();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the shape is api.ts's contract
  return data as T;
}
const isMgmt = (v: unknown): v is Mgmt =>
  typeof v === "object" && v !== null && "ok" in v && typeof v.ok === "boolean";

/** A write's answer as the drawer's status line: the CLI's first line of output (`done` when it
 *  printed nothing), or why it failed. */
export const said = (r: Mgmt, done: string): string => {
  if (!r.ok) return r.err || "failed";
  /* c8 ignore next -- split always yields at least one entry; `?? ''` only satisfies noUncheckedIndexedAccess */
  const first = r.out.split("\n")[0] ?? "";
  return first === "" ? done : first;
};
export async function mgmt(route: string, body: object): Promise<Mgmt> {
  try {
    const res = await fetch("api/" + route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // A backend that THREW comes back as a plain-text 500 ("api error: ..."), not JSON, so
    // parsing blind reported every such failure as `Unexpected token 'a'` and buried the
    // real message. Read the body once, then fall back to showing it verbatim.
    const text = await res.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (isMgmt(parsed)) return parsed;
    } catch {
      /* not JSON: shown verbatim below */
    }
    return { ok: false, err: text.trim() || "HTTP " + res.status };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}
