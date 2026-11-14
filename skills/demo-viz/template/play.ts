// ▶ Play: replays a demo's moves for the human, step by step, and hands control back on request.
// Plain logic, no DOM: app.ts supplies what "playing step i" means (a fake cursor on the real build,
// a command run, a transcript advanced) and the beat between steps; this keeps the position straight.
import type { Step } from "./walk.schema.js";

export type Move = { click: string } | { select: string; value: string };

/** What doing a step is: its `act`, else the value of done.sel, else a click on target when done waits for a result. */
export function movesOf(s: Pick<Step, "act" | "done" | "target">): Move[] {
  if (s.act) return s.act;
  if (s.done && "value" in s.done) return [{ select: s.done.sel, value: s.done.value }];
  if (s.done && s.target) return [{ click: s.target }];
  return [];
}

export interface PlayState {
  at: number;
  playing: boolean;
}

export interface PlayOptions {
  /** Do step i's moves. `live()` turns false once Play was stopped or moved by hand: give up then. */
  play(i: number, live: () => boolean): Promise<void>;
  /** The beat between steps, so the eye can follow. */
  hold(): Promise<void>;
  onChange(s: PlayState): void;
  /** "Do it myself": cut whatever the last `play` is still doing. */
  abort?(): void;
  at?: number;
}

export interface Player {
  readonly state: PlayState;
  /** Play from here; from the end, from the top. */
  start(): void;
  /** Stop after the step in hand finishes. */
  pause(): void;
  /** Move by hand (back, forward, a persona, a key): beats autoplay, plays nothing. */
  go(to: number): void;
  /** "Do it myself": stop at once, leave the build where it is, hand the controls back. */
  stop(): void;
  /** The human moved the build on their own (the guide's own Next): follow, unless Play is driving. */
  follow(to: number): void;
}

export function player(n: number, o: PlayOptions): Player {
  let at = Math.min(Math.max(o.at ?? 0, 0), n - 1);
  let playing = false;
  let finished = false;
  let run = 0; // bumped by every hand move: a loop from an earlier run sees it and stops
  let looping = false; // a loop is alive (possibly finishing the step in hand after a pause)
  const emit = () => {
    o.onChange({ at, playing });
  };
  const halt = () => {
    run += 1;
    looping = false;
    playing = false;
    o.abort?.();
  };
  async function loop(mine: number) {
    const live = () => mine === run;
    looping = true;
    try {
      while (live() && playing) {
        // oxlint-disable-next-line no-await-in-loop -- steps play in order
        await o.play(at, live);
        if (!live() || !playing) return; // paused: the step in hand finished, the next doesn't start
        if (at >= n - 1) {
          playing = false;
          finished = true;
          emit();
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- the beat between steps
        await o.hold();
        if (!live() || !playing) return;
        at += 1;
        emit();
      }
    } finally {
      if (live()) looping = false;
    }
  }
  return {
    get state(): PlayState {
      return { at, playing };
    },
    start() {
      if (playing || n === 0) return;
      if (finished) at = 0;
      finished = false;
      playing = true;
      emit();
      if (looping) return; // paused a moment ago and still finishing its step: that loop carries on
      run += 1;
      loop(run).catch((e: unknown) => {
        playing = false;
        console.error(e);
        emit();
      });
    },
    pause() {
      playing = false;
      emit();
    },
    go(to: number) {
      halt();
      finished = false;
      at = Math.min(Math.max(to, 0), n - 1);
      emit();
    },
    stop() {
      halt();
      emit();
    },
    follow(to: number) {
      if (playing || to === at) return;
      at = Math.min(Math.max(to, 0), n - 1);
      finished = false;
      emit();
    },
  };
}
