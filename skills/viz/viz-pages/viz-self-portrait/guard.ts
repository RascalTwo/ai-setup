// Every POST to the self-portrait's backend acts on the real library (delete rmSyncs a folder, rotate kills lobby
// links, base-url runs a repo's script), and nothing else tells the page's own click from an agent's `curl` at
// 127.0.0.1:5180 or another website's fetch. A browser stamps Sec-Fetch-Site on each request and page script cannot
// forge it: only the page itself says "same-origin". (2026-09-30: an agent POSTed a real id to /delete while
// differential-testing api.ts.)
export const onlyFromThisPage =
  (handler: (req: Request) => unknown) =>
  (req: Request): unknown =>
    req.method === "POST" && req.headers.get("sec-fetch-site") !== "same-origin"
      ? Response.json(
          {
            ok: false,
            err: "refused: this route changes the library, so it only answers the Library page's own requests",
          },
          { status: 403 },
        )
      : handler(req);
