// feedback-store.js — where the feedback log and its crops live: the viz server, this browser, or a hosting page.

import type { Entry } from "@viz/kit/feedback-text.js";
import type { FeedbackHost, Store } from "@viz/kit/feedback-types.js";

/** The viz server's page data route: <viz>/.viz-data/feedback.jsonl and files/. */
export function serverStore(vizId: string): Store {
  const LOG = `/${vizId}/_log/feedback`,
    FILES = `/${vizId}/_files/`;
  return {
    load: async () => {
      const r = await fetch(LOG);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: the log is this page's own feedback.jsonl
      return r.ok ? ((await r.json()) as Entry[]) : [];
    },
    append: async (e) => {
      await fetch(LOG, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(e),
      });
    },
    put: async (name, png) => {
      try {
        const r = await fetch(FILES + name, { method: "PUT", body: png });
        return r.ok ? name : null;
      } catch {
        return null;
      }
    },
    get: async (name) => {
      const r = await fetch(FILES + name);
      return r.ok ? r.blob() : null;
    },
  };
}
/** No server: this browser's IndexedDB, one log per page stamp, its crops beside it. */
export function localStore(stamp: string): Store {
  const db = new Promise<IDBDatabase>((done, fail) => {
    const req = indexedDB.open("viz-feedback", 1);
    req.addEventListener("upgradeneeded", () => {
      req.result.createObjectStore("log"); // stamp -> Entry[]
      req.result.createObjectStore("files"); // stamp/name -> Blob
    });
    req.addEventListener("success", () => done(req.result));
    req.addEventListener("error", () => fail(req.error ?? new Error("could not open IndexedDB")));
  });
  const run = async <T>(
    name: "log" | "files",
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const d = await db;
    return new Promise<T>((done, fail) => {
      const req = op(d.transaction(name, mode).objectStore(name));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- IndexedDB boundary: each key holds only what this store wrote
      req.addEventListener("success", () => done(req.result as T));
      req.addEventListener("error", () => fail(req.error ?? new Error("IndexedDB request failed")));
    });
  };
  let chain = Promise.resolve(); // appends read-modify-write the one array: one at a time
  return {
    load: async () =>
      (await run<Entry[] | undefined>("log", "readonly", (s) => s.get(stamp))) ?? [],
    append: async (e) => {
      chain = chain.then(async () => {
        const all = (await run<Entry[] | undefined>("log", "readonly", (s) => s.get(stamp))) ?? [];
        all.push(e);
        await run("log", "readwrite", (s) => s.put(all, stamp));
      });
      await chain;
    },
    put: async (name, png) => {
      await run("files", "readwrite", (s) => s.put(png, `${stamp}/${name}`));
      return name;
    },
    get: async (name) =>
      (await run<Blob | undefined>("files", "readonly", (s) => s.get(`${stamp}/${name}`))) ?? null,
  };
}
/** A hosting page keeps the log itself and draws its own crops. */
export function hostStore(host: FeedbackHost): Store {
  /* oxlint-disable typescript/promise-function-async -- these hand back an already-settled promise; an async arrow with no await is flagged by require-await instead */
  return {
    load: () => Promise.resolve([]),
    append: (e) => Promise.resolve(host.log(e)),
    put: () => Promise.resolve(null),
    get: () => Promise.resolve(null),
  };
  /* oxlint-enable typescript/promise-function-async */
}
