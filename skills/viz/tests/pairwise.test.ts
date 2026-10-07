import { expect, test } from "bun:test";
// @ts-expect-error TS7016 — kit/pairwise.js is a generated bundle of a package that ships source, not declarations
import * as pairwiseBundle from "../kit/pairwise.js";

// The bundle ships no declarations, so type the slice these tests use once, here.
interface Item {
  title: string;
  url: string;
  key?: string;
}
type Log = [string, number][];
interface Engine {
  state: { log: Log };
  run: (ask: (a: number, b: number) => Promise<number>) => Promise<number[]>;
  ranking: (order: number[]) => Item[];
}
interface EngineOpts {
  items: Item[];
  priority?: string[];
  log?: Log;
}
interface PairwiseApi {
  item: (
    title: string,
    url: string,
    a?: unknown[],
    b?: string,
    tiers?: string[],
    key?: string,
  ) => Item;
  idOf: (it: Item) => string;
  pairKeyOf: (a: string, b: string) => string;
  migrateId: (log: Log, seen: Set<string>, from: string, to: string) => void;
  createEngine: (opts: EngineOpts) => Engine;
  budgetFor: (n: number) => number;
  SEP: string;
}
const bundle: unknown = pairwiseBundle;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one boundary cast: the bundle has no declarations, PairwiseApi is the shape it exports
const { item, idOf, pairKeyOf, migrateId, createEngine, budgetFor, SEP } = bundle as PairwiseApi;

// An answering function for the engine: async (promise-function-async) and awaiting (require-await).
const replying = (v: number, onAsk?: () => void) => async (): Promise<number> => {
  onAsk?.();
  await Promise.resolve();
  return v;
};

// The engine is @rascaltwo/pairwise-sorter and tested there; that kit/pairwise.js IS the pinned
// library is tests/kit-bundles.test.ts. These pin the behaviour the corpus ranking and the Rank
// tab rely on, through the file they actually load.

const items = ["e", "c", "a", "d", "b"].map((t) => item(t, "u" + t));

test("a known total order is recovered exactly, and replaying it asks nothing", async () => {
  const eng = createEngine({ items });
  const order = await eng.run(async (a: number, b: number) => {
    await Promise.resolve();
    return items[a]!.title < items[b]!.title ? -1 : 1;
  });
  expect(
    eng
      .ranking(order)
      .map((i) => i.title)
      .join(""),
  ).toBe("abcde");

  // Replaying costs ZERO new questions — the log must be authoritative.
  let asked = 0;
  const eng2 = createEngine({ items, log: eng.state.log });
  await eng2.run(
    replying(-1, () => {
      asked++;
    }),
  );
  expect(asked).toBe(0);
});

test("migrateId preserves the verdict across a sort-order swap", () => {
  // Build a pair where renaming inverts sort order, and check the verdict inverts too.
  const A = idOf(item("a", "")),
    B = idOf(item("b", ""));
  const log: Log = [[pairKeyOf(A, B), A < B ? -1 : 1]]; // "a beats b"
  migrateId(log, new Set(), A, idOf(item("z", ""))); // a -> z, now sorts AFTER b
  const Z = idOf(item("z", ""));
  const [k, v] = log[0]!;
  const [x] = k.split(SEP);
  // "a beats b" must still mean "z beats b" after the rename
  expect((x === Z && v === -1) || (x === B && v === 1)).toBe(true);
});

const tItems = [item("hi", "1", [], "", ["good"]), item("lo", "2", [], "", ["bad"])];

test("tiers answer cross-tier pairs without asking, and are never logged", async () => {
  const eng3 = createEngine({ items: tItems, priority: ["good", "bad"] });
  let tierAsked = 0;
  const o3 = await eng3.run(
    replying(1, () => {
      tierAsked++;
    }),
  );
  expect(tierAsked).toBe(0);
  expect(eng3.ranking(o3)[0]!.title).toBe("hi");
  expect(eng3.state.log.length).toBe(0);
});

test("a logged answer overrides the tier order (the documented escape hatch)", async () => {
  const eng4 = createEngine({ items: tItems, priority: ["good", "bad"] });
  const ia = idOf(tItems[0]!),
    ib = idOf(tItems[1]!);
  eng4.state.log.push([pairKeyOf(ia, ib), ia < ib ? 1 : -1]); // assert lo beats hi
  const eng4b = createEngine({ items: tItems, priority: ["good", "bad"], log: eng4.state.log });
  const o4 = await eng4b.run(async () => {
    await Promise.resolve();
    throw new Error("should not ask");
  });
  expect(eng4b.ranking(o4)[0]!.title).toBe("lo");
});

test("budget(5) is the binary-insertion worst case", () => {
  expect(budgetFor(5)).toBe(8);
});

test("an explicit key survives a retitle", async () => {
  const k1 = item("Old Title", "viz://v-abc", [], "", [], "viz://v-abc");
  const k2 = item("Other", "viz://v-def", [], "", [], "viz://v-def");
  const engK = createEngine({ items: [k1, k2] });
  await engK.run(replying(-1));
  expect(engK.state.log.length).toBe(1);
  const renamed = item("A Completely New Title", "viz://v-abc", [], "", [], "viz://v-abc");
  const engK2 = createEngine({ items: [renamed, k2], log: engK.state.log });
  let askedAfterRename = 0;
  await engK2.run(
    replying(1, () => {
      askedAfterRename++;
    }),
  );
  expect(askedAfterRename).toBe(0);
});

// Asserted so a future change to idOf cannot quietly alter the documented default.
test("without a key, a retitle orphans the answer (documented default)", async () => {
  const n1 = item("Old", "u1"),
    n2 = item("Other", "u2");
  const engN = createEngine({ items: [n1, n2] });
  await engN.run(replying(-1));
  const engN2 = createEngine({ items: [item("New", "u1"), n2], log: engN.state.log });
  let askedN = 0;
  await engN2.run(
    replying(1, () => {
      askedN++;
    }),
  );
  expect(askedN).toBe(1);
});
