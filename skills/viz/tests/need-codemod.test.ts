// tests/need-codemod.test.ts — which asserted DOM lookups maintainer/codemods/need.ts rewrites onto need, and how.
import { expect, test } from "bun:test";
import { dropUnusedDollar, rewrite } from "../maintainer/codemods/need.ts";

const to = (expr: string, kitDollar = true) => {
  const r = rewrite(expr, kitDollar);
  return "to" in r ? r.to : null;
};

test("Given a kit $ lookup, when rewritten, then it is need with the same selector, root and element type", () => {
  expect(to('$("#stage")')).toBe('need("#stage")');
  expect(to('$<SVGSVGElement>("svg.links", pipe)')).toBe('need<SVGSVGElement>("svg.links", pipe)');
  expect(to("$(`#row${i}`)")).toBe("need(`#row${i}`)");
});

test("Given querySelector and getElementById, when rewritten, then the receiver becomes need's root and an id a #selector", () => {
  expect(to('document.querySelector<HTMLInputElement>("#q")')).toBe('need<HTMLInputElement>("#q")');
  expect(to('card.querySelector(".k")')).toBe('need(".k", card)');
  expect(to('document.getElementById("out")')).toBe('need("#out")');
});

test("Given <HTMLElement>, when rewritten, then it is dropped as need's default unless a tag name would pick another type", () => {
  expect(to('document.querySelector<HTMLElement>("#a")')).toBe('need("#a")');
  expect(to('document.querySelector<HTMLElement>("svg")')).toBe('need<HTMLElement>("svg")');
});

test("Given what the codemod cannot prove, when asked, then it declines", () => {
  expect(to('$("#a")', false)).toBeNull(); // a $ that is not the kit's
  expect(to("x.querySelector(f())")).toBeNull(); // a computed selector
  expect(to("document.getElementById(id)")).toBeNull(); // a non-literal id
  expect(to('a.b().querySelector("#x")')).toBeNull(); // a receiver that is not a plain name
});

test("Given a kit import whose $ lost its last call, when tidied, then $ leaves the import and $$ stays", () => {
  const src =
    'import { $, $$, need } from "@viz/kit";\nneed("#a");\n$$(".b");\nconst re = /x$/u;\n';
  expect(dropUnusedDollar(src, "/v/app.ts")).toStartWith('import { $$, need } from "@viz/kit";');
  const used = 'import { $, need } from "@viz/kit";\nif ($("#a")) need("#b");\n';
  expect(dropUnusedDollar(used, "/v/app.ts")).toBe(used);
});

test("Given a kit import quoted in a code sample, when tidied, then only the real import statement is read", () => {
  // The self-portrait shows `import { … } from "@viz/kit"` as text; the codemod once edited that string.
  const src =
    'const art = `import { $, stepper } from "@viz/kit";`;\n  import { $, need } from "@viz/kit";\nneed("#a");\n';
  expect(dropUnusedDollar(src, "/v/app.ts")).toBe(
    'const art = `import { $, stepper } from "@viz/kit";`;\n  import { need } from "@viz/kit";\nneed("#a");\n',
  );
});
