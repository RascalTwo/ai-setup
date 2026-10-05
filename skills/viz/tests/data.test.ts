// Page data route (ADR 0019): a page appends JSON lines to _log/<name>, confined to .viz-data/.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseJson } from "./json.ts";
import { DATA_DIR, handleData } from "../lib/server/data.ts";

const req = (method: string, body?: string) =>
  new Request("http://x/", {
    method,
    ...(body !== undefined ? { body } : {}),
    headers: body ? { "content-type": "application/json" } : {},
  });

describe("page data route", () => {
  test("Given a viz, when a page posts two entries, then GET returns both in order, time-stamped", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viz-data-"));
    expect((await handleData(dir, "_log/answers", req("POST", '{"pick":"Q1:A"}'))).status).toBe(
      201,
    );
    await handleData(
      dir,
      "_log/answers",
      req("POST", '{"pick":"Q2:B","at":"2026-01-01T00:00:00Z"}'),
    );
    const got = parseJson<Record<string, string>[]>(
      await (await handleData(dir, "_log/answers", req("GET"))).text(),
    );
    expect(got.map((e) => e.pick)).toEqual(["Q1:A", "Q2:B"]);
    expect(got[0]!.at).toMatch(/^\d{4}-/u);
    expect(got[1]!.at).toBe("2026-01-01T00:00:00Z"); // the page's own stamp wins
    expect(
      readFileSync(path.join(dir, DATA_DIR, "answers.jsonl"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(2);
  });

  test("Given a log, when it is deleted, then GET returns an empty list", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viz-data-"));
    await handleData(dir, "_log/votes", req("POST", '{"v":1}'));
    expect((await handleData(dir, "_log/votes", req("DELETE"))).status).toBe(204);
    expect(await (await handleData(dir, "_log/votes", req("GET"))).json()).toEqual([]);
  });

  test("Given a name that tries to leave .viz-data, when posted, then it is refused and nothing is written outside", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viz-data-"));
    for (const bad of ["../escape", "a/b", "..", "UPPER", ".hidden", ""]) {
      // oxlint-disable-next-line no-await-in-loop -- each request is checked against the directory before the next one runs
      expect((await handleData(dir, "_log/" + bad, req("POST", "{}"))).status).toBe(400);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  test("Given a body that is not a JSON object, when posted, then it is refused", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viz-data-"));
    for (const body of ["not json", "[1,2]", '"str"', "null"]) {
      // oxlint-disable-next-line no-await-in-loop -- each request is checked against the directory before the next one runs
      expect((await handleData(dir, "_log/x", req("POST", body))).status).toBe(400);
    }
    expect(existsSync(path.join(dir, DATA_DIR))).toBe(false);
  });

  test("Given the unbuilt _files namespace, when called, then it says so rather than 404ing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "viz-data-"));
    expect((await handleData(dir, "_files/r2.webm", req("PUT", "x"))).status).toBe(501);
  });
});
