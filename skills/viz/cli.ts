// cli.ts — the one argument parser, error exit, and output convention.
//
// WHY THIS EXISTS: every entry point used to roll its own. manage.ts had a real
// parseFlags with a VALUE_FLAGS set; bootstrap.ts and build.ts each hand-rolled an
// if/else chain over process.argv; verify.ts used a closure that split only on "=", so
// `--size 800x600` silently did nothing there while working fine everywhere else; and
// server.ts just called process.argv.includes(), so a typo'd flag was ignored without a
// word. die(msg, code) was independently reimplemented, identically, in four files.
//
// The user-visible cost of that was a CLI where the same flag syntax worked or didn't
// depending on which script you were talking to. This module is the fix: one parser,
// one error path, one --json convention.

/** Print to stderr and exit. Convention: 2 = wrong usage, 1 = it went wrong. */
export function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

export type Flags = Record<string, string | boolean>;
export type Parsed = { flags: Flags; pos: string[] };

export type ParseOptions = {
  /**
   * Flags that consume the NEXT argument when written `--flag value`. Without this a
   * parser cannot tell `--out dir` (a value) from `--full dir` (a boolean then a
   * positional), so every value-taking flag must be declared.
   */
  value?: Iterable<string>;
  /**
   * Flags whose value is OPTIONAL — `--local` and `--local <dir>` are both valid. The
   * predicate decides whether the next argument is this flag's value or a positional,
   * which is what lets `--local myslug` still read myslug as the slug. Without this a
   * parser has to choose between eating the next word always or never, and bootstrap.ts
   * needs neither.
   */
  optional?: Record<string, (next: string) => boolean>;
  /**
   * Every flag the command accepts. Supply it and an unrecognised flag is a usage
   * error instead of a silent no-op. Omit it to accept anything (the old behaviour).
   */
  known?: Iterable<string>;
  /** Printed above the error when an unknown flag is rejected. */
  usage?: string;
};

/**
 * Parse `--flag`, `--flag=value` and `--flag value` (for declared value flags), plus
 * positionals. `--` ends flag parsing; everything after it is positional.
 *
 * Both spellings of a value flag are always accepted, so no script can drift into
 * supporting only one of them the way verify.ts did.
 */
export function parseFlags(args: string[], opts: ParseOptions = {}): Parsed {
  const valueFlags = new Set(opts.value ?? []);
  const known = opts.known ? new Set(opts.known) : null;
  const flags: Flags = {};
  const pos: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (known && !known.has(name)) {
      die(`${opts.usage ? opts.usage + "\n\n" : ""}ERROR: unknown flag --${name}`, 2);
    }
    if (eq >= 0) {
      flags[name] = a.slice(eq + 1);
    } else if (valueFlags.has(name)) {
      const next = args[++i];
      if (next === undefined) die(`ERROR: --${name} needs a value`, 2);
      flags[name] = next;
    } else if (opts.optional?.[name]) {
      const next = args[i + 1];
      // Present-but-valueless stays `true`; the caller distinguishes the two.
      if (next !== undefined && !next.startsWith("--") && opts.optional[name](next)) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      flags[name] = true;
    }
  }
  return { flags, pos };
}

/** A flag's value, or undefined. Guards against `--out` being passed with no value. */
export function str(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

/** A flag's value as a number, or undefined if absent/unparseable. */
export function num(flags: Flags, name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** True only for a present boolean flag. `--json=false` reads as false, not "set". */
export function bool(flags: Flags, name: string): boolean {
  const v = flags[name];
  return v === true || v === "true";
}

/**
 * The --json convention, in one place.
 *
 * Machine-readable output used to exist on exactly two of ~30 commands, which meant
 * anything scripting this toolchain — CI, an agent, the MCP server — had to scrape
 * prose decorated with ✓/⚠️. Commands call this instead of console.log-ing directly:
 * pass the data, and a closure that renders it for a human.
 *
 * JSON goes to stdout ALONE so `| jq` works; human output may print whatever it likes.
 */
export function emit(flags: Flags, data: unknown, human: () => void): void {
  if (bool(flags, "json")) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  human();
}
