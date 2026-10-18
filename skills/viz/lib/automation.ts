// A browser viz drives (verify, screenshots) loads a page exactly like a reader does, so a backend route
// that ACTS on page load (spawns servers, rotates a credential, calls a paid model) fires on every check.
// The tag below lets that route tell the two apart: it answers a harmless stub instead of acting.
import type { Page } from "puppeteer-core";

/** Appears in the user agent of every browser viz drives. Backends test `req.headers.get("user-agent")`. */
export const AUTOMATION_UA = "VizAutomation";

/** Mark `page` as driven by viz. A user agent rather than a header: a custom header would put a CORS
 *  preflight on every CDN request the page makes. */
export async function tagAutomation(page: Page): Promise<void> {
  await page.setUserAgent({ userAgent: `${await page.browser().userAgent()} ${AUTOMATION_UA}` });
}
