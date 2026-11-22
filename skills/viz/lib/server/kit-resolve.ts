// Calling `registerKitResolver()` makes `@viz/kit` (and the older `/_kit/…`) resolve at RUNTIME in this
// Node process, to the skill's kit/. A backend imports the kit the way the page does — `import { z } from
// "@viz/kit/zod.js"` — and so does a test of one; Node would otherwise look for a package or, for `/_kit/`,
// a file at the filesystem root. Types resolve it through verify's `paths`. Called by the server's api
// loader and by the tests' preload.
//
// It also answers a relative `./x.js` with `x.ts` when only that exists, from a .ts file: the same rule
// the dev server applies to the page (ADR 0023), so a backend can share a module with its page.
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const KIT = path.join(import.meta.dirname, "../../kit");

const kitFile = (specifier: string): string | undefined => {
  if (specifier.startsWith("/_kit/")) return specifier.slice("/_kit/".length);
  if (specifier === "@viz/kit") return "viz.js";
  if (specifier.startsWith("@viz/kit/")) return specifier.slice("@viz/kit/".length);
  return undefined;
};

let registered = false;
export const registerKitResolver = (): void => {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, next) {
      const kit = kitFile(specifier);
      if (kit) return { url: pathToFileURL(path.join(KIT, kit)).href, shortCircuit: true };
      try {
        return next(specifier, context);
      } catch (e) {
        if (!/^\.\.?\/.*\.js$/u.test(specifier) || !/\.ts(?:[?#]|$)/u.test(context.parentURL ?? ""))
          throw e;
        try {
          return next(specifier.replace(/\.js$/u, ".ts"), context);
        } catch {
          throw e; // the original error names what the author wrote
        }
      }
    },
  });
};
