import { expect, test } from "bun:test";
import { AUTOMATION_UA, tagAutomation } from "../lib/automation.ts";

test("Given a page, when it is tagged, then its user agent keeps Chrome's and ends with the automation tag", async () => {
  let ua = "";
  const page = {
    browser: () => ({
      userAgent: async () => {
        await Promise.resolve();
        return "Mozilla/5.0 HeadlessChrome/154";
      },
    }),
    setUserAgent: async (o: { userAgent: string }) => {
      await Promise.resolve();
      ua = o.userAgent;
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stand-in for a puppeteer Page: only the two methods tagAutomation calls
  await tagAutomation(page as never);
  expect(ua).toBe(`Mozilla/5.0 HeadlessChrome/154 ${AUTOMATION_UA}`);
});
