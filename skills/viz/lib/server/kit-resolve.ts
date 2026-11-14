// Calling `registerKitResolver()` makes `@viz/kit` (and the older `/_kit/…`) resolve at RUNTIME in this Bun
// process, to the skill's kit/. A backend imports the kit the way the page does — `import { z } from
// "@viz/kit/zod.js"` — and so does a test of one; Bun would otherwise look for a package or, for `/_kit/`, a
// file at the filesystem root. Types resolve it through verify's `paths`. Called by the server's api loader
// and by the tests' preload.
import path from "node:path";

const KIT = path.join(import.meta.dir, "../../kit");

export const registerKitResolver = (): void =>
  Bun.plugin({
    name: "viz-kit",
    setup(build) {
      build.onResolve({ filter: /^\/_kit\//u }, (args) => ({
        path: path.join(KIT, args.path.slice("/_kit/".length)),
      }));
      build.onResolve({ filter: /^@viz\/kit(?:\/|$)/u }, (args) => ({
        path: path.join(
          KIT,
          args.path === "@viz/kit" ? "viz.js" : args.path.slice("@viz/kit/".length),
        ),
      }));
    },
  });
