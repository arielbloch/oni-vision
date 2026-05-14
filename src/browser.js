// browser.js — open the web dashboard in the user's default browser.
//
// Called once after the first successful parse while the web server is up.
// Guards:
//   • Only when a TTY is attached — background services (launchctl, systemd)
//     must not pop a browser window on every boot.
//   • Only once per process — an in-memory flag prevents re-opening on
//     subsequent save events within the same daemon run.
//
// The open command is fire-and-forget (detached child, stdio ignored).
// Failure is logged as a warning but never fatal.

import { spawn } from "node:child_process";

/** Platform → command that opens a URL in the default browser. */
const OPEN_CMD = {
  darwin: "open",
  win32:  "cmd",
  linux:  "xdg-open",
};

/** Extra args needed before the URL for some platforms. */
const OPEN_ARGS_PREFIX = {
  win32: ["/c", "start", ""],
};

/** In-memory guard: true once the browser has been launched this session. */
let sessionOpened = false;

/**
 * Open `url` in the default browser, subject to the guards described above.
 *
 * @param {string} url               The URL to open (e.g. "http://127.0.0.1:8080").
 * @param {object} [opts]
 * @param {string} [opts.platform]   process.platform override (for tests).
 * @param {boolean} [opts.tty]       Override TTY detection (for tests).
 * @returns {boolean}                true if the browser was launched, false if skipped.
 */
export function openBrowser(url, {
  platform = process.platform,
  tty = process.stdout.isTTY === true,
} = {}) {
  // Guard 1: don't open from a background service.
  if (!tty) return false;

  // Guard 2: only open once per daemon process.
  if (sessionOpened) return false;

  const cmd = OPEN_CMD[platform] ?? "xdg-open";
  const prefix = OPEN_ARGS_PREFIX[platform] ?? [];
  const args = [...prefix, url];

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    sessionOpened = true;
    console.log(`[vision] opened dashboard in browser: ${url}`);
    return true;
  } catch (err) {
    console.warn(`[vision] could not open browser: ${err.message}`);
    return false;
  }
}

/**
 * Reset the session guard. Exposed for tests; also called when you want
 * to allow a re-open within the same process (e.g. after reconfiguration).
 */
export function resetBrowserGuard() {
  sessionOpened = false;
}
