// lib/verify/noise.ts — browser housekeeping that verify must not report as a viz bug.

/**
 * A media request Chrome cancelled itself. Seeking an <audio>/<video> abandons the range request in
 * flight, so a viz that seeks (a reader, a scrubbable film) gets one per seek. Only `media` counts:
 * an aborted script or fetch really did not load, and a media file that is missing fails with a
 * different error.
 */
export function isBenignAbort(resourceType: string, errorText: string | undefined): boolean {
  return resourceType === "media" && errorText === "net::ERR_ABORTED";
}
