// lib/verify/chrome.ts — finding the user's Chrome.
//
// puppeteer-core drives an EXISTING browser rather than downloading Chromium, which
// is why the skill installs in seconds and why this list has to be right.

import { existsSync } from "node:fs";



export function chromePath(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // macOS
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    "No Chrome found. Set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary.",
  );
}
