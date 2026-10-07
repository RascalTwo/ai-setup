// The skill's own source goes through the same formatter as every viz (lib/format/format.ts); this is the one place that
// says which folders are not source: the vizzes (they format themselves), and fixtures that are test data.
//
//   bun maintainer/format-self.ts          # write the formatting
//   tests/skill-format.test.ts             # fails when any file is left unformatted
import path from "node:path";
import { format, type FormatResult } from "../lib/format/format.ts";

const SKILL = path.join(import.meta.dir, "..");
export const SKIP = ["viz-pages", "tests/fixtures"];

export const formatSkill = (write: boolean): FormatResult | null => format(SKILL, SKIP, write);

if (import.meta.main) {
  const r = formatSkill(true);
  console.log(
    r
      ? `${r.files} file(s); ${r.findings.length} finding(s) left\n${r.findings.join("\n")}`
      : "nothing to format",
  );
}
