export interface Routes {
  "/sent": {
    body: { words: string };
    reply: { ok: boolean; message: string };
  };
  "/signoff": {
    // when: slot (default) | now | hold, which Kelpie's signoff takes as --now / --hold
    body: { words: string; verdicts: Record<string, string>; when?: string };
    reply: { ok: boolean; message: string };
  };
}
