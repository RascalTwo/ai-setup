// The feedback log (ADR 0021) folds into what's on the page: the CLI must agree with the widget.
import { describe, expect, test } from "bun:test";
import { foldFeedback, fromNote, type Line } from "../lib/library/feedback.ts";

describe("feedback log fold", () => {
  test("Given lines, edits, a retract, a resolve and a pick, then the page shows the latest of each", () => {
    const { lines, picks, sends } = foldFeedback([
      { type: "speech", id: "a", text: "make it green", at: "1" },
      { type: "speech", id: "b", text: "tallr", at: "2" },
      { type: "edit", id: "b", text: "taller" },
      { type: "comment", id: "c", text: "um" },
      { type: "retract", id: "c" },
      { type: "resolve", id: "a", note: "done" },
      { type: "pick", q: "Q1", opt: "A" },
      { type: "pick", q: "Q1", opt: "B" },
      { type: "send", round: 1 },
    ]);
    expect(lines.map((l) => [l.id, l.text, l.done, l.note])).toEqual([
      ["a", "make it green", true, "done"],
      ["b", "taller", false, undefined],
    ]);
    expect(picks).toEqual({ Q1: "B" });
    expect(sends).toHaveLength(1);
  });

  test("Given a clear, then only lines after it stay on the page", () => {
    const { lines } = foldFeedback([
      { type: "speech", id: "a", text: "x" },
      { type: "clear" },
      { type: "speech", id: "b", text: "y" },
    ]);
    expect(lines.map((l) => l.id)).toEqual(["b"]);
  });
});

describe("feedback start anchor", () => {
  const line = (from?: Line["from"]) => ({
    id: "a",
    type: "speech",
    text: "t",
    at: "",
    done: false,
    anchor: { label: "Bar 2019" },
    ...(from ? { from } : {}),
  });

  test("Given speech that began on another element, then level 1 names where it began", () => {
    expect(fromNote(line({ anchor: { label: "Legend" } }))).toBe("  ← from Legend");
  });

  test("Given speech that began and ended on the same element, or an old line with no start, then level 1 says nothing", () => {
    expect(fromNote(line({ anchor: { label: "Bar 2019" } }))).toBe("");
    expect(fromNote(line())).toBe("");
  });
});
