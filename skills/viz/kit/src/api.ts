// api.ts — the contract between a viz's backend (api.ts) and its page: written once, checked on both ends.
//
//   contract.ts   export interface Routes {
//                   "/run":    { body: { stage: string }; reply: { jobId: string } };
//                   "/status": { body: null;              reply: { done: boolean } };   // null body = GET
//                   "/step":   { body: null; method: "POST"; query: { id: string }; reply: { ok: true } };
//                 }
//   api.ts        import type { Handlers } from "/_kit/api.js";        // types only: erased, nothing to resolve
//                 export default {
//                   "/run": async (req) => { const { stage } = await req.json(); return { jobId: start(stage) }; },
//                 } satisfies Handlers<Routes>;      // a wrong or missing field in what is RETURNED is a compile error
//   app.ts        import { api } from "/_kit/api.js";  import type { Routes } from "./contract.js";
//                 const { get, post } = api<Routes>();
//                 const { jobId } = await post("/run", { body: { stage: "drafts" } });   // a route with a body
//                 const { done } = await get("/status");                                 // no body, no query
//                 await post("/step", { query: { id: "a" } });                           // POST with a query, no body
//
// What is and isn't checked: the reply a handler returns is checked against the contract (`satisfies`
// compares the value; it does not assert like `as`). The request body is DECLARED, not validated —
// `req.json()` is typed as the contract says, and a query is typed for the page only (the server reads
// `new URL(req.url).searchParams`) — and the page's read of a reply is the one assertion, made here once. A non-2xx answer throws an ApiError with `status` and the parsed `body` (a page that treats a 400
// or 502 as data reads it from the exception), and `timeout`, `signal` and `cache` pass through. A handler that needs a status, headers or a stream returns a Response instead, which
// the compiler cannot look inside.

/** One route. `body`: what the page sends as JSON (null = nothing). `query`: URL parameters the page adds.
 *  `method`: only to say POST for a route with no body; a route with a body is POST, one without is GET. */
export interface Route { body: unknown; reply: unknown; query?: Record<string, string | number | boolean | undefined>; method?: "POST" }
/** What a contract must look like. Self-referential rather than `Record<string, Route>`, which an
 *  `interface Routes { … }` does not satisfy (interfaces have no implicit index signature). */
export type Contract<C> = { [K in keyof C]: Route };

/** A request whose `json()` is the body the contract declares for this route. */
export interface TypedRequest<B> extends Request { json(): Promise<B> }

/** A backend's default export: one handler per route in the contract, none missing, none extra.
 *  Return the reply itself (the server sends it as JSON) or a Response for anything more. */
export type Handlers<C extends Contract<C>> = {
  [K in keyof C & string]: (req: TypedRequest<C[K]["body"]>) => C[K]["reply"] | Response | Promise<C[K]["reply"] | Response>;
};

/** A non-2xx answer. `body` is the parsed JSON when the server sent JSON, else the text. */
export class ApiError extends Error {
  constructor(readonly route: string, readonly status: number, readonly body: unknown, message: string) { super(message); this.name = "ApiError"; }
}

/** What any call may add. `timeout` is milliseconds; if `signal` is also given, either one aborts. */
export interface CallOptions { timeout?: number; signal?: AbortSignal; cache?: RequestCache }

type PostRoutes<C> = { [K in keyof C & string]: C[K] extends { method: "POST" } ? K : C[K] extends { body: null } ? never : K }[keyof C & string];
type GetRoutes<C> = Exclude<keyof C & string, PostRoutes<C>>;
/** What the page passes for a route: its body and/or query, only those the contract declares, plus CallOptions. */
type Input<R> = (R extends { body: null } ? unknown : { body: R extends { body: infer B } ? B : never })
  & (R extends { query: infer Q } ? { query: Q } : unknown) & CallOptions;
/** The argument is optional exactly when nothing in it is required. */
type Args<R> = {} extends Input<R> ? [input?: Input<R>] : [input: Input<R>];

/** The page's side. `base` is relative on purpose (`api/…` resolves under the viz's own slug). `get`
 *  takes the GET routes and `post` the POST ones, so the wrong verb is a type error. A non-2xx answer
 *  throws an ApiError (message: the server's `error` field when it sent one). */
export function api<C extends Contract<C>>(base = "api") {
  async function send<K extends keyof C & string>(method: "GET" | "POST", route: K, input: { body?: unknown; query?: Record<string, unknown> } & CallOptions = {}): Promise<C[K]["reply"]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(input.query ?? {})) if (v !== undefined) params.set(k, String(v));
    const qs = params.size ? `?${params}` : "";
    const signals = [input.signal, input.timeout === undefined ? undefined : AbortSignal.timeout(input.timeout)].filter((x): x is AbortSignal => !!x);
    const init: RequestInit = {
      ...(method === "POST" && { method: "POST" }),
      ...(method === "POST" && input.body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) }),
      ...(input.cache && { cache: input.cache }),
      ...(signals.length && { signal: signals.length === 1 ? signals[0]! : AbortSignal.any(signals) }),
    };
    const res = await fetch(`${base}${route}${qs}`, init);
    if (!res.ok) {
      const text = await res.text();
      let body: unknown = text, msg = text;
      try { body = JSON.parse(text); msg = (body as { error?: string } | null)?.error ?? text; } catch { /* not JSON: the text will do */ }
      throw new ApiError(route, res.status, body, msg || `${route}: ${res.status}`);
    }
    return await res.json() as C[K]["reply"];
  }
  return {
    get: <K extends GetRoutes<C>>(route: K, ...input: Args<C[K]>): Promise<C[K]["reply"]> => send("GET", route, input[0]),
    post: <K extends PostRoutes<C>>(route: K, ...input: Args<C[K]>): Promise<C[K]["reply"]> => send("POST", route, input[0]),
  };
}
