// GENERATED from kit/src/api.ts by `bun run sync:kit` — edit that file, not this one.
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
/** A non-2xx answer. `body` is the parsed JSON when the server sent JSON, else the text. */
export class ApiError extends Error {
    route;
    status;
    body;
    constructor(route, status, body, message) {
        super(message);
        this.route = route;
        this.status = status;
        this.body = body;
        this.name = "ApiError";
    }
}
/** The page's side. `base` is relative on purpose (`api/…` resolves under the viz's own slug). `get`
 *  takes the GET routes and `post` the POST ones, so the wrong verb is a type error. A non-2xx answer
 *  throws an ApiError (message: the server's `error` field when it sent one). */
export function api(base = "api") {
    async function send(method, route, input = {}) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(input.query ?? {}))
            if (v !== undefined)
                params.set(k, String(v));
        const qs = params.size ? `?${params}` : "";
        const signals = [input.signal, input.timeout === undefined ? undefined : AbortSignal.timeout(input.timeout)].filter((x) => !!x);
        const init = {
            ...(method === "POST" && { method: "POST" }),
            ...(method === "POST" && input.body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) }),
            ...(input.cache && { cache: input.cache }),
            ...(signals.length && { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }),
        };
        const res = await fetch(`${base}${route}${qs}`, init);
        if (!res.ok) {
            const text = await res.text();
            let body = text, msg = text;
            try {
                body = JSON.parse(text);
                msg = body?.error ?? text;
            }
            catch { /* not JSON: the text will do */ }
            throw new ApiError(route, res.status, body, msg || `${route}: ${res.status}`);
        }
        return await res.json();
    }
    return {
        get: (route, ...input) => send("GET", route, input[0]),
        post: (route, ...input) => send("POST", route, input[0]),
    };
}
