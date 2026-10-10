export interface Routes {
  "/sent": {
    body: { words: string };
    reply: { ok: boolean; message: string };
  };
  "/signoff": {
    body: { words: string; verdicts: Record<string, string> };
    reply: { ok: boolean; message: string };
  };
}
