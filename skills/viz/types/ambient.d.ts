// Modules the skill's own code imports that ship no declarations (tsconfig.json includes this folder).
// Only the surface used is declared; widen it here when something else is needed.

declare module "@bcoe/v8-coverage" {
  interface FunctionCov { functionName: string; ranges: { startOffset: number; endOffset: number; count: number }[]; isBlockCoverage: boolean }
  interface ScriptCov { scriptId: string; url: string; functions: FunctionCov[] }
  /** Merges coverage of one script from several runs, treating a block a run left out as taken by its parent. */
  export function mergeScriptCovs(scriptCovs: ScriptCov[]): ScriptCov | undefined;
}
