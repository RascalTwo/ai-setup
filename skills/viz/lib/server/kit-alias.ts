// lib/server/kit-alias.ts — the kit's import alias. A viz writes `import { $ } from "@viz/kit"` (kit/viz.js) or
// `from "@viz/kit/zod.js"` (any other kit file); the page's import map points both at the served /_kit/.
// One definition, used by the server (live), export (inline.ts), the type-check paths, the backend loader
// and `viz lint --fix` — so the spelling cannot drift between them.

/** The alias as an import map: the bare name is viz.js, the slash form is any file in the kit. */
export const KIT_ALIAS = { "@viz/kit": "/_kit/viz.js", "@viz/kit/": "/_kit/" } as const;

/** `/_kit/<file>.js` in an import position → the alias. `/_kit/viz.js` → `@viz/kit`. */
const KIT_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])\/_kit\/([A-Za-z0-9._-]+\.js)\2/gu;

/** Rewrite the kit imports in TypeScript/JavaScript source to the alias (`<script src>` and `<link>` are not imports; left alone). */
export const aliasKitImports = (source: string): string =>
  source.replaceAll(
    KIT_IMPORT,
    (_m, lead: string, q: string, file: string) =>
      `${lead}${q}${file === "viz.js" ? "@viz/kit" : `@viz/kit/${file}`}${q}`,
  );

const IMPORT_MAP = /(<script\b[^>]*\btype=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/iu;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * `html` with the alias in its import map: merged into the page's own map when it has one (two maps in
 * one page are not honoured by every browser), else a new map first in <head> — it must precede any module.
 */
export function withKitAlias(html: string): string {
  const own = IMPORT_MAP.exec(html);
  if (own) {
    try {
      const parsed: unknown = JSON.parse(own[2]!);
      const map = isObject(parsed) ? parsed : {};
      const imports = isObject(map["imports"]) ? map["imports"] : {};
      const merged = JSON.stringify({ ...map, imports: { ...KIT_ALIAS, ...imports } });
      return html.replace(
        IMPORT_MAP,
        (_m, open: string, _body: string, close: string) => open + merged + close,
      );
    } catch {
      return html; // not JSON: the page's own business
    }
  }
  const tag = `<script type="importmap">${JSON.stringify({ imports: KIT_ALIAS })}</script>`;
  const head = /<head\b[^>]*>/iu.exec(html);
  return head ? html.replace(head[0], () => head[0] + tag) : tag + html;
}
