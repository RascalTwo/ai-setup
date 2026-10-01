// The shapes api.ts answers and app.ts reads — written once (see /viz reference/backend.md).

/** One reading of a usage window. w: window minutes (300 | 10080), v: % used, r: resets_at ms. */
export interface Sample { t: number; w: number; v: number; r: number; q: "exact" | "lagged" }
export interface Tier { name: string; down: string; line: number }
export interface Source { id: string; label: string; plan?: string | null; tier: Tier | null; samples: Sample[] }
export interface Data { now: number; demo: boolean; sources: Source[]; errors?: string }

export interface Routes {
  "/data": { body: null; reply: Data };
}
