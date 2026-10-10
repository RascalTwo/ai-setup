// lib/lint/config.ts — which lint rules are on, and why each one that is off is off.
//
// The plan is "every category on, with named exceptions" (static-analysis grill, 2026-10-01). Turning a
// rule off needs a written reason, so the list of exceptions IS a map from rule to reason: a rule cannot
// be switched off without one, and tests/lint.test.ts holds the reasons to non-empty. The `style` category
// is simply never enabled: the formatter owns style. Everything the grill asked to keep on (eqeqeq,
// no-eq-null, the readability rules, require-unicode-regexp, explicit-module-boundary-types) is in a
// category that is already on, so it needs no entry here.

/** Rule → why it is off. Names are Oxlint's, with the plugin prefix where it has one. */
export const OFF_RULES: Record<string, string> = {
  "oxc/no-async-await": "our ES2022 target supports async/await natively",
  "oxc/no-optional-chaining": "our ES2022 target supports optional chaining natively",
  "oxc/no-rest-spread-properties": "our ES2022 target supports rest and spread natively",
  "no-undefined": "TypeScript produces undefined; it is tested explicitly with ===",
  "import/no-default-export":
    "the default export is the toolchain's contract (api.ts, verify.interactions.ts)",
  "unicorn/no-array-for-each": "taste; no async-callback bugs exist in the corpus",
  "sort-vars": "taste; reordering can break dependent initializers",
  "no-plusplus": "idiomatic",
  "unicorn/consistent-function-scoping": "a local helper beside its use is clearer",
  "no-use-before-define": "tsc already catches the real cases (TS2448)",
  "typescript/explicit-function-return-type":
    "TypeScript infers it; exported functions are held by explicit-module-boundary-types",
  "no-inline-comments": "a trailing note is often the clearest place for it",
  "max-lines-per-function": "a functional rewrite, deferred (task viz-length-limits)",
  "max-lines": "a functional rewrite, deferred (task viz-length-limits)",
  "no-bitwise": "used on purpose (hashes, colour maths)",
  "no-negated-condition": "taste",
  "unicorn/no-negated-condition": "taste",
  "typescript/no-non-null-assertion":
    "deferred (task viz-nonnull-conquer: the kit's DOM helper first)",
  "no-underscore-dangle":
    "double-underscore names are the kit's window hooks; underscore properties are ad-hoc flags",
  "unicorn/no-array-callback-reference":
    "passing a named helper is idiomatic; the parseInt-style trap does not occur and the rule cannot tell safe helpers from unsafe ones",
  "unicorn/require-module-specifiers":
    "a bare `export {}` is the module marker the viz starter ships (it makes app.ts a module for coverage and types)",
  "no-console":
    "console output is how interaction scripts and backends report; verify already captures it",
  "typescript/prefer-readonly-parameter-types":
    "page elements cannot satisfy it: DOM types are mutable by design",
  "typescript/no-confusing-void-expression": "braces-only style change",
  "typescript/no-confusing-non-null-assertion":
    "the formatter owns the spelling: it drops the parentheses of (a!) === b, which this rule then reads as confusing",
  "typescript/strict-boolean-expressions":
    "borderline, off for now: most hits are the everyday a || b idiom (revisit)",
};

/** Rule → why it is off inside a viz's `tests/` only. */
export const TEST_OFF_RULES: Record<string, string> = {
  "import/no-relative-parent-imports":
    "a test imports the folder it tests: it is that folder's consumer, not a node of its tree",
};

/** Rule → why it is off when the skill lints its OWN source (a viz never is the skill's folder). */
export const SKILL_OFF_RULES: Record<string, string> = {
  "import/no-relative-parent-imports":
    "the skill's lib/ is a graph of cooperating folders (lib/library imports lib/publish); the rule keeps one viz a self-contained tree",
};

/** The Oxlint config, generated so the reasons above cannot drift from what is actually off. */
export function oxlintConfig(forSkill = false): Record<string, unknown> {
  return {
    plugins: ["typescript", "unicorn", "oxc", "import"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
      pedantic: "error",
      restriction: "error",
    },
    rules: Object.fromEntries(
      Object.keys(forSkill ? { ...OFF_RULES, ...SKILL_OFF_RULES } : OFF_RULES).map((r) => [
        r,
        "off",
      ]),
    ),
    overrides: [
      {
        files: ["**/tests/**"],
        rules: Object.fromEntries(Object.keys(TEST_OFF_RULES).map((r) => [r, "off"])),
      },
    ],
  };
}
