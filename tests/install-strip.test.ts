// scripts/install-strip.ts: the Install strip on each poster, generated from the manifests.
import { expect, test } from "vitest";
import { type Owned } from "../scripts/manifest.ts";
import { isStale, posterPath, strip, withStrip } from "../scripts/install-strip.ts";

const skill = (name: string, requires?: Owned["manifest"]["requires"]): Owned => ({ name, kind: "skill", manifest: requires ? { requires } : {} });
const tool = (name: string, requires?: Owned["manifest"]["requires"]): Owned => ({ name, kind: "tool", manifest: requires ? { requires } : {} });
const lines = (html: string) => /<pre>([\s\S]*?)<\/pre>/.exec(html)![1].split("\n").map((l) => l.replace(/<[^>]+>/g, ""));

test("a skill that needs only itself installs with one npx skills line", () => {
  const a = skill("alone");
  expect(lines(strip(a, [a]))).toEqual(["npx skills add RascalTwo/ai-setup -g -s alone"]);
});

test("a tool, or a skill that needs a tool, installs with the full setup: npm ci, then node install.ts", () => {
  const t = tool("t");
  const s = skill("s", { tools: ["t"] });
  // THEN a tool needs the full setup, with no reason given; a skill says which need brought it
  expect(lines(strip(t, [t, s]))).toEqual(["npm ci", "node install.ts"]);
  expect(strip(t, [t, s])).not.toContain("it needs");
  expect(lines(strip(s, [t, s]))).toEqual(["npm ci", "node install.ts"]);
  expect(strip(s, [t, s])).toContain("it needs the t tool");
});

test("commands and manual steps are listed as needs, and the subagents step is not repeated under the full setup", () => {
  const s = skill("s", { tools: ["t"], commands: ["jq"], manual: ["ai-setup subagents", "the Chrome extension"] });
  const t = tool("t");
  const html = strip(s, [s, t]);
  expect(html).toContain("<code>jq</code>");
  expect(html).toContain("the Chrome extension");
  expect(html).not.toContain(">ai-setup subagents<");
  expect(html).toContain("its subagents");
});

test("a poster's strip is replaced in place, or inserted before the scroll cue, and escapes what it prints", () => {
  const want = strip(skill("a&b"), []);
  // GIVEN a poster with no strip: THEN it goes before the cue, at the cue's indent
  const bare = '<body>\n  <div class="scroll-cue">go</div>\n</body>';
  const once = withStrip(bare, want);
  expect(once.indexOf("install:start")).toBeLessThan(once.indexOf("scroll-cue"));
  expect(isStale(once, want)).toBe(false);
  // GIVEN the strip changes: THEN it is replaced, not added twice
  const next = strip(tool("t"), []);
  const twice = withStrip(once, next);
  expect(twice.match(/install:start/g)).toHaveLength(1);
  expect(isStale(twice, next)).toBe(false);
  expect(isStale(twice, want)).toBe(true);
  // THEN a name is escaped
  expect(want).toContain("a&amp;b");
  // GIVEN a poster with no cue to anchor on: THEN it says so
  expect(() => withStrip("<body></body>", want)).toThrow(/scroll-cue/);
});

test("a rewrapped strip is not stale, and a poster without one is", () => {
  const want = strip(skill("a"), []);
  expect(isStale(`<p>x</p>${want.replace(/\n/g, "\n   ")}`, want)).toBe(false);
  expect(isStale("<p>no strip</p>", want)).toBe(true);
});

test("a poster is found under its kind's slug, or the other kind's, and null when there is none", () => {
  expect(posterPath(skill("viz"))).toMatch(/viz-pages\/skill-viz\/index\.html$/);
  expect(posterPath(skill("no-such-thing-anywhere"))).toBeNull();
});
