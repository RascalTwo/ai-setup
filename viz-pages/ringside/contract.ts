import type { Chunk, Lane } from "./model.ts";

export interface SessionInfo {
  id: string;
  project: string;
  mtime: number;
  size: number;
  title: string;
}

/** A subagent of the session, linked to the Agent call that launched it by `toolUseId`. */
export interface AgentInfo {
  id: string;
  description: string;
  toolUseId: string;
  /** True when the helper's transcript ends on a final reply, so it is finished. */
  final: boolean;
}

export interface Routes {
  "/sessions": { body: null; reply: { sessions: SessionInfo[] } };
  "/events": {
    body: null;
    /** `from` is the main transcript's byte offset; `subs` is JSON for { agentId: byte offset }. */
    query: { id: string; from: string; subs: string };
    reply: Chunk & {
      offset: number;
      subs: Record<string, number>;
      agents: AgentInfo[];
      /** True when a file has more complete lines waiting, so ask again straight away. */
      more: boolean;
    };
  };
  "/outcome": {
    /** `pos` is the byte offset of the call's line in its transcript; `agent` is its `agent` tag. */
    body: { session: string; id: string; agent: string; pos: number; intent: string };
    reply: { outcome: string | null };
  };
  /** One line for a whole conversation strip; `key` names it for the cache, `steps` are its labels and outcomes. */
  "/beat": {
    body: { key: string; before: string; steps: string[]; after: string };
    reply: { beat: string | null };
  };
  /** The lane for a call that runs a script; `input` is the call's redacted input, script included. */
  "/lane": {
    body: { id: string; input: string };
    reply: { lane: Lane | null };
  };
  /** The whole session retold; `lines` are its prompts, strip summaries and replies, in order. */
  "/story": {
    body: { key: string; lines: string[] };
    reply: { story: string | null };
  };
  "/label": {
    body: { id: string; tool: string; input: string };
    reply: { label: string | null };
  };
}
