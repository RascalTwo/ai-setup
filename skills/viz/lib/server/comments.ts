// lib/server/comments.ts — The anchored review layer: comments.json, read and written over HTTP.
//
// Extracted from server.ts, which was 522 lines.

// ---- Anchored comment layer (review/feedback). ----
// Comments persist as a BARE ARRAY in comments.json beside the viz's index.html,
// scoped to the dir the request resolved to — so every viz is commentable for free,
// with zero per-viz setup. Lifecycle: the user creates (POST, status "open") and
// deletes (DELETE, after reviewing); the agent resolves (PATCH, status "resolved"
// + an optional one-line `resolution` note). Last-write-wins; single local user, so
// no locking. This route is only reached in live mode (the overlay that calls it
// isn't injected when frozen, and handleRequest gates it on MODE !== "frozen").
import { MODE } from "./config.ts";
import { handleRequest } from "./routes.ts";
import path from "node:path";
export const COMMENTS_FILE = "comments.json";

export async function readComments(slugDir: string): Promise<Record<string, unknown>[]> {
  const f = Bun.file(path.join(slugDir, COMMENTS_FILE));
  if (!(await f.exists())) return [];
  try {
    const arr = JSON.parse(await f.text());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return []; // a hand-mangled file shouldn't 500 the overlay
  }
}

export async function writeComments(slugDir: string, arr: unknown[]): Promise<void> {
  await Bun.write(path.join(slugDir, COMMENTS_FILE), JSON.stringify(arr, null, 2) + "\n");
}

export async function handleComments(slugDir: string, rest: string, req: Request): Promise<Response> {
  const arr = await readComments(slugDir);

  if (req.method === "GET") return Response.json(arr);

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(body.text ?? "").trim();
    if (!text) return new Response("text required", { status: 400 });
    const comment = {
      id: "c" + Math.random().toString(36).slice(2, 8),
      text,
      status: "open",
      vizState: typeof body.vizState === "string" ? body.vizState : "",
      anchor: body.anchor && typeof body.anchor === "object" ? body.anchor : {},
      createdAt: new Date().toISOString(),
    };
    arr.push(comment);
    await writeComments(slugDir, arr);
    return Response.json(comment, { status: 201 });
  }

  // PATCH / DELETE address a single comment by id: _comments/<id>.
  const id = rest.startsWith("_comments/") ? rest.slice("_comments/".length) : "";
  const idx = id ? arr.findIndex((c) => c.id === id) : -1;
  if (idx === -1) return new Response("comment not found", { status: 404 });

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.status === "open" || body.status === "resolved") arr[idx].status = body.status;
    if (typeof body.resolution === "string") arr[idx].resolution = body.resolution;
    await writeComments(slugDir, arr);
    return Response.json(arr[idx]);
  }

  if (req.method === "DELETE") {
    const [removed] = arr.splice(idx, 1);
    await writeComments(slugDir, arr);
    return Response.json(removed);
  }

  return new Response("method not allowed", { status: 405 });
}
