// lib/testing/scope.ts — which pages, and which films, belong to the test running right now.
//
// runner.ts runs every test inside its own scope and closes it when the test ends; preload.ts adds to the current one.
// The scope also says which test it is (`id`, names.ts testKey), so a step's time is recorded against its own test even
// when a loop's iterations run at once.
// A page opened outside a test (a beforeAll) has no scope and lives to the end of its file. Both files are loaded by
// vitest separately, so the one instance lives on globalThis.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Page } from "puppeteer-core";

export type Film = { stop: () => Promise<unknown>; path: string };
export type Scope = { id: string; pages: Set<Page>; films: Film[]; ended: boolean };
type Shared = { als: AsyncLocalStorage<Scope>; running: number };

const KEY = Symbol.for("viz.testing.scope");
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one place globalThis is read as the object this file wrote to it
const holder = globalThis as unknown as { [KEY]?: Shared };
export const shared: Shared = (holder[KEY] ??= { als: new AsyncLocalStorage<Scope>(), running: 0 });

/** The scope of the test this code runs in, if it is still running. */
export const currentScope = (): Scope | undefined => {
  const s = shared.als.getStore();
  return s && !s.ended ? s : undefined;
};
