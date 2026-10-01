// tests/api-contract.test.ts — the runtime half of the backend/page contract (kit/src/api.ts).
// The type half (a wrong reply, body or route is a compile error) is in typescript.test.ts.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { handleApi } from "../lib/server/api.ts";
import { api, ApiError } from "../kit/src/api.ts";

const TMP = path.join(import.meta.dir, ".tmp-api-contract");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function backend(name: string, body: string): string {
  const dir = path.join(TMP, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "api.ts"), body);
  return dir;
}
const post = (route: string, body: unknown) => new Request(`http://x/${route}`, { method: "POST", body: JSON.stringify(body) });

describe("the server sends what a handler returns", () => {
  test("Given a handler that returns a plain value, when it is called, then the server answers it as JSON", async () => {
    const dir = backend("plain", `export default { "/run": async (req: Request) => { const { stage } = await req.json() as { stage: string }; return { jobId: stage + "-1" }; } };\n`);
    const res = await handleApi(dir, "run", post("run", { stage: "a" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ jobId: "a-1" });
  });

  test("Given a handler that returns a Response, when it is called, then it is sent untouched (status, headers, streams)", async () => {
    const dir = backend("response", `export default { "/gone": () => new Response("no", { status: 410, headers: { "x-k": "v" } }) };\n`);
    const res = await handleApi(dir, "gone", new Request("http://x/gone"));
    expect([res.status, res.headers.get("x-k"), await res.text()]).toEqual([410, "v", "no"]);
  });

  test("Given a handler that returns nothing, when it is called, then the answer is JSON null, not an error", async () => {
    const dir = backend("nothing", `export default { "/ping": () => undefined };\n`);
    const res = await handleApi(dir, "ping", new Request("http://x/ping"));
    expect([res.status, await res.json()]).toEqual([200, null]);
  });
});

describe("a backend can use the kit's Zod", () => {
  test("Given a backend that imports /_kit/zod.js, when it is called, then a valid upstream reply parses and an invalid one fails loudly", async () => {
    const dir = backend("zod", `import { z } from "/_kit/zod.js";\nconst Reply = z.object({ access_token: z.string(), expires_in: z.number() });\nexport default {\n  "/ok": () => Reply.parse({ access_token: "a", expires_in: 3 }),\n  "/bad": () => Reply.parse({ access_token: 1 }),\n};\n`);
    const ok = await handleApi(dir, "ok", new Request("http://x/ok"));
    expect([ok.status, await ok.json()]).toEqual([200, { access_token: "a", expires_in: 3 }]);
    const bad = await handleApi(dir, "bad", new Request("http://x/bad"));
    expect(bad.status).toBe(500);
    expect(await bad.text()).toContain("Expected string, received number");
  });
});

describe("the page's typed caller", () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; });
  const stub = (res: Response) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return res; }) as unknown as typeof fetch;
    return calls;
  };
  interface Routes {
    "/run": { body: { stage: string }; reply: { jobId: string } };
    "/status": { body: null; reply: { done: boolean } };
    "/step": { body: null; method: "POST"; query: { id: string; strict?: boolean | undefined }; reply: { ok: true } };
    "/find": { body: null; query: { q: string }; reply: string[] };
  }

  test("Given a route with a body, when posted, then it sends the JSON to a relative URL and returns the reply", async () => {
    const calls = stub(Response.json({ jobId: "j" }));
    expect(await api<Routes>().post("/run", { body: { stage: "s" } })).toEqual({ jobId: "j" });
    expect(calls[0]!.url).toBe("api/run");
    expect(calls[0]!.init).toMatchObject({ method: "POST", body: '{"stage":"s"}', headers: { "content-type": "application/json" } });
  });

  test("Given a GET route, when fetched, then no body and no method are sent", async () => {
    const calls = stub(Response.json({ done: true }));
    await api<Routes>().get("/status");
    expect(calls[0]).toEqual({ url: "api/status", init: {} });
  });

  test("Given a POST route with a query and no body, when posted, then the query is encoded, undefined values are left out and no body is sent", async () => {
    const calls = stub(Response.json({ ok: true }));
    await api<Routes>().post("/step", { query: { id: "a b&c", strict: undefined } });
    expect(calls[0]).toEqual({ url: "api/step?id=a+b%26c", init: { method: "POST" } });
  });

  test("Given a GET route with a query, when fetched, then the query is on the URL", async () => {
    const calls = stub(Response.json(["x"]));
    expect(await api<Routes>().get("/find", { query: { q: "é" } })).toEqual(["x"]);
    expect(calls[0]!.url).toBe("api/find?q=%C3%A9");
  });

  test("Given a timeout, a signal and a cache mode, when called, then all three reach fetch, and a timeout aborts a slow answer", async () => {
    const calls = stub(Response.json({ done: true }));
    const ac = new AbortController();
    await api<Routes>().get("/status", { timeout: 5000, cache: "no-store", signal: ac.signal });
    const init = calls[0]!.init!;
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    ac.abort();
    expect(init.signal!.aborted).toBe(true); // the caller's signal is part of it
    globalThis.fetch = ((_u: string, i?: RequestInit) => new Promise((_res, rej) => i!.signal!.addEventListener("abort", () => rej(i!.signal!.reason)))) as unknown as typeof fetch;
    await expect(api<Routes>().get("/status", { timeout: 20 })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  test("Given a route with nothing required, when called with only options, then that is accepted", async () => {
    const calls = stub(Response.json({ done: true }));
    await api<Routes>().get("/status", { cache: "no-store" });
    expect(calls[0]).toEqual({ url: "api/status", init: { cache: "no-store" } });
  });

  test("Given a non-2xx answer with a JSON body, when called, then the ApiError carries the status and the parsed body", async () => {
    stub(Response.json({ error: "picker failed", detail: "no display" }, { status: 502 }));
    const err = await api<Routes>().get("/status").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.route, err.message, err.body]).toEqual([502, "/status", "picker failed", { error: "picker failed", detail: "no display" }]);
    stub(new Response("upstream down", { status: 500 }));
    const plain = await api<Routes>().get("/status").catch((e) => e);
    expect([plain.status, plain.body]).toEqual([500, "upstream down"]);
  });

  test("Given a non-2xx answer, when called, then it throws the server's error field, or the text when it is not JSON", async () => {
    stub(Response.json({ error: "stage unknown" }, { status: 400 }));
    await expect(api<Routes>().post("/run", { body: { stage: "x" } })).rejects.toThrow("stage unknown");
    stub(new Response("upstream down", { status: 502 }));
    await expect(api<Routes>().get("/status")).rejects.toThrow("upstream down");
  });
});
