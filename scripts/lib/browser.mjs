/**
 * Shared browser launcher for the visual checks.
 *
 * Playwright is deliberately NOT a dependency of this project: it pulls a
 * browser down with it, and Railway installs dev dependencies during a build.
 * The API suite — which is the one that matters on every change — needs no
 * browser at all. So the visual checks ask for Playwright when they are run,
 * and say so plainly instead of throwing a module-resolution stack trace at
 * somebody who has just unzipped the project.
 */
import fs from 'fs';
import path from 'path';

/**
 * Find a Chromium to drive.
 *
 * Preference order: an explicit CHROME_PATH, then any Chromium already sitting
 * in PLAYWRIGHT_BROWSERS_PATH (CI images and dev containers usually ship one,
 * and its version rarely matches whatever Playwright wants to download), then
 * nothing — which lets Playwright use its own. Hard-coding a version here is
 * how this breaks silently the day the image is rebuilt.
 */
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const full = path.join(root, dir, rel);
      if (fs.existsSync(full)) return full;
    }
  }
  return undefined;
}

export async function launchBrowser(opts = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      '\nThis check drives a real browser, and Playwright is not installed.\n\n'
      + '  npm i -D playwright && npx playwright install chromium\n\n'
      + 'It is not a dependency of the app — the API suite (npm test) needs no browser.\n');
    process.exit(2);
  }
  return chromium.launch({
    args: ['--no-sandbox'],
    executablePath: findChromium(),
    ...opts,
  });
}
