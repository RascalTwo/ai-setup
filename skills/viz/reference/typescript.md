# Types in a viz

A viz is written in TypeScript, and `viz verify` holds it to the strictest settings TypeScript has. The
browser still only ever runs JavaScript: types are removed before it sees the file, and the
**check** is where the protection comes from — so a typed viz is only as safe as its last
verify.

## Full mode: write TypeScript

- Write the module as **`app.ts`** and refer to it as **`./app.js`** — in the `<script
  type="module" src>`, and in imports (`import { items } from "./content.js"` for
  `content.ts`). `.js` is the name the file has once published.
- The server answers `app.js` from `app.ts` with the types removed and a source map naming the
  `.ts`, so devtools and coverage show your source. Publish and export bundle it to plain JS like
  any other module. No build step, nothing to install.
- Import types with `import type` / `import { type Item }`: each file is stripped alone, so a
  type imported as if it were a value is an error.
- **Verify by id, not `file://`** — a file URL has no server to strip anything, so the page
  loads a `.js` that isn't there.
- Code goes in `.ts` files, not inline `<script>` blocks: nothing checks inline code.
  `viz create` starts you with `app.ts`.
- `/_kit/*` imports resolve to the kit's own TypeScript, so a wrong call into it — or a wrong
  use of what it returns — fails verify. `$()` can return `null`: write `$("#out")!` for an
  element that is in your HTML.
- `https://` CDN imports are typed as their package when the skill has its types installed
  (d3, three, marked, mermaid, elkjs, js-yaml, diff, ts-fsrs, highlight.js, dagre); anything
  else types as `any`. A library loaded by `<script src>` is a global: declare it,
  `declare const dagre: typeof import("dagre");`.
- The rare line the checker can't be told about gets `// @ts-expect-error <why>` — an escape
  hatch, never `any` or `@ts-nocheck`.

## Fallback mode: types in comments

One HTML file and no Bun, so nothing can strip TypeScript. Write plain JS, put
`// @ts-check` on the first line of the script, and type it with JSDoc:

```js
// @ts-check
/** @typedef {{ label: string, n: number }} Item */
/** @param {Item[]} xs @returns {number} */
const total = (xs) => xs.reduce((s, x) => s + x.n, 0);
```

The browser runs it as-is. The same checker, at the same strictness, applies the first time
the file meets `viz verify` or an editor.

## What verify turns on

`strict`, plus `noUncheckedIndexedAccess` (an index may be `undefined`),
`exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature` (page only), `noUnusedLocals`,
`noUnusedParameters`, no unreachable code or unused labels, and `isolatedModules` +
`verbatimModuleSyntax` — the two that match how the server strips one file at a time.
A type error fails verify the way a failed test does.

Three programs are checked, each against its own environment: the **page** against the DOM, an
`api.ts` **backend** against Bun's types (`reference/backend.md`), and the viz's own `tests/*.ts`
against Bun, puppeteer and the DOM (`reference/testing.md`). A `*.interactions.ts` is not checked.
