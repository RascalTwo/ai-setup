// tests/cli-parser.test.ts — unit tests for the shared flag parser.
//
// cli.ts is new code that every entry point is about to depend on, so it gets tested
// directly rather than only through the commands. The cases below are drawn from what
// the four hand-rolled parsers it replaces actually did, including the disagreements
// between them — `--flag value` must work everywhere now, not just in manage.ts.

import { describe, expect, test } from "bun:test";
import { parseFlags, str, num, bool, emit } from "../cli.ts";

describe("parseFlags", () => {
  test("Given a bare flag, when parsed, then it is true", () => {
    expect(parseFlags(["--full"]).flags.full).toBe(true);
  });

  test("Given --flag=value, when parsed, then the value is captured", () => {
    expect(parseFlags(["--size=800x600"]).flags.size).toBe("800x600");
  });

  test("Given --flag value on a declared value flag, then the value is captured", () => {
    const { flags } = parseFlags(["--size", "800x600"], { value: ["size"] });
    expect(flags.size).toBe("800x600");
  });

  // The exact bug this module exists to kill: verify.ts accepted only the `=` form and
  // silently dropped the other, so `--size 800x600` did nothing and said nothing.
  test("Given both spellings of a value flag, when parsed, then they agree", () => {
    const eq = parseFlags(["--size=800x600"], { value: ["size"] });
    const sp = parseFlags(["--size", "800x600"], { value: ["size"] });
    expect(eq.flags.size).toBe(sp.flags.size);
  });

  test("Given a value flag with no value, when parsed, then it is a usage error not a silent drop", () => {
    const proc = Bun.spawnSync(["bun", "-e", `
      import { parseFlags } from "${import.meta.dir}/../cli.ts";
      parseFlags(["--out"], { value: ["out"] });
    `]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("--out needs a value");
  });

  test("Given positionals and flags mixed, when parsed, then positionals keep their order", () => {
    const { pos } = parseFlags(["one", "--full", "two", "--size=1x1", "three"]);
    expect(pos).toEqual(["one", "two", "three"]);
  });

  test("Given an undeclared flag before a positional, then the positional is not eaten", () => {
    const { flags, pos } = parseFlags(["--full", "somedir"]);
    expect(flags.full).toBe(true);
    expect(pos).toEqual(["somedir"]);
  });

  test("Given --, when parsed, then everything after it is positional", () => {
    const { pos, flags } = parseFlags(["--full", "--", "--not-a-flag"]);
    expect(flags.full).toBe(true);
    expect(pos).toEqual(["--not-a-flag"]);
  });

  test("Given a known list and an unknown flag, then it exits 2 naming the flag", () => {
    const proc = Bun.spawnSync(["bun", "-e", `
      import { parseFlags } from "${import.meta.dir}/../cli.ts";
      parseFlags(["--nonsense"], { known: ["full"] });
    `]);
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("unknown flag --nonsense");
  });

  test("Given no known list, when an unrecognised flag is passed, then it is accepted", () => {
    expect(parseFlags(["--anything"]).flags.anything).toBe(true);
  });
});

describe("accessors", () => {
  test("Given a boolean flag, when read as a string, then it is undefined not 'true'", () => {
    expect(str(parseFlags(["--full"]).flags, "full")).toBeUndefined();
  });

  test("Given --n 5, when read as a number, then it is 5", () => {
    expect(num(parseFlags(["--n", "5"], { value: ["n"] }).flags, "n")).toBe(5);
  });

  test("Given a non-numeric value, when read as a number, then it is undefined", () => {
    expect(num(parseFlags(["--n=abc"]).flags, "n")).toBeUndefined();
  });

  test("Given an absent flag, when read as a bool, then it is false", () => {
    expect(bool(parseFlags([]).flags, "json")).toBe(false);
  });
});

describe("emit — the --json convention", () => {
  test("Given --json, when emitting, then stdout is the data as JSON and the human path is skipped", () => {
    const proc = Bun.spawnSync(["bun", "-e", `
      import { parseFlags, emit } from "${import.meta.dir}/../cli.ts";
      const { flags } = parseFlags(["--json"]);
      emit(flags, { ok: true, n: 2 }, () => console.log("HUMAN OUTPUT"));
    `]);
    const out = proc.stdout.toString();
    expect(out).not.toContain("HUMAN OUTPUT");
    expect(JSON.parse(out)).toEqual({ ok: true, n: 2 });
  });

  test("Given no --json, when emitting, then the human closure runs and stdout is not JSON", () => {
    const proc = Bun.spawnSync(["bun", "-e", `
      import { parseFlags, emit } from "${import.meta.dir}/../cli.ts";
      const { flags } = parseFlags([]);
      emit(flags, { ok: true }, () => console.log("HUMAN OUTPUT"));
    `]);
    expect(proc.stdout.toString()).toContain("HUMAN OUTPUT");
  });
});

describe("optional-value flags", () => {
  const looksLikePath = (s: string) => s.includes("/") || s === ".";

  test("Given --local alone, when parsed, then it is true", () => {
    const { flags } = parseFlags(["slug", "--local"], { optional: { local: looksLikePath } });
    expect(flags.local).toBe(true);
  });

  test("Given --local <path>, when parsed, then the path is captured", () => {
    const { flags, pos } = parseFlags(["slug", "--local", "./repo"], { optional: { local: looksLikePath } });
    expect(flags.local).toBe("./repo");
    expect(pos).toEqual(["slug"]);
  });

  // The behaviour bootstrap.ts's looksLikePath() guard exists to preserve: a bare word
  // after --local is the slug, not the directory.
  test("Given --local <non-path>, when parsed, then it stays a positional", () => {
    const { flags, pos } = parseFlags(["--local", "myslug"], { optional: { local: looksLikePath } });
    expect(flags.local).toBe(true);
    expect(pos).toEqual(["myslug"]);
  });

  test("Given --local followed by another flag, then it does not eat the flag", () => {
    const { flags } = parseFlags(["--local", "--deck"], { optional: { local: looksLikePath } });
    expect(flags.local).toBe(true);
    expect(flags.deck).toBe(true);
  });

  test("Given --local=<path>, when parsed, then the = form still works", () => {
    const { flags } = parseFlags(["--local=./repo"], { optional: { local: looksLikePath } });
    expect(flags.local).toBe("./repo");
  });
});
