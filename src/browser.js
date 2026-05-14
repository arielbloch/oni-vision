// browser.js — open the web dashboard in the user's default browser.
//
// Called once after the first successful parse while the web server is up.
// Guards:
//   • Only when a TTY is attached — background services (launchctl, systemd)
//     must not pop a browser window on every boot.
//   • Only once per installation — a flag file (~/.oni-vision/.browser-opened)
//     prevents re-opening on every daemon restart. Delete the flag to re-open.
//
// The open command is fire-and-forget (detached child, stdio ignored).
// Failure is logged as a warning but never fatal.

import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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

/**
 * Open `url` in the default browser, subject to the guards described above.
 *
 * @param {string} url               The URL to open (e.g. "http://127.0.0.1:8080").
 * @param {object} [opts]
 * @param {string} [opts.home]       Home directory override (for tests).
 * @param {string} [opts.platform]   process.platform override (for tests).
 * @param {boolean} [opts.tty]       Override TTY detection (for tests).
 * @returns {boolean}                true if the browser was launched, false if skipped.
 */
export function openBrowser(url, {
  home = homedir(),
  platform = process.platform,
  tty = process.stdout.isTTY === true,
} = {}) {
  // Guard 1: don't open from a background service.
  if (!tty) {
    return false;
  }

  // Guard 2: only open once per installation.
  const flagPath = join(home, ".oni-vision", ".browser-opened");
  if (existsSync(flagPath)) {
    return false;
  }

  const cmd = OPEN_CMD[platform] ?? "xdg-open";
  const prefix = OPEN_ARGS_PREFIX[platform] ?? [];
  const args = [...prefix, url];

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      // shell:false is safer and avoids injection; the URL is our own string.
    });
    child.unref(); // don't keep the Node process alive waiting for the child

    // Write the flag file so we don't reopen on the next restart.
    mkdirSync(dirname(flagPath), { recursive: true });
    writeFileSync(flagPath, url + "\n", "utf8");

    console.log(`[vision] opened dashboard in browser: ${url}`);
    return true;
  } catch (err) {
    console.warn(`[vision] could not open browser: ${err.message}`);
    return false;
  }
}

/**
 * Clear the "browser already opened" flag so the next daemon start
 * will open the browser again. Called by `npm run uninstall`.
 *
 * @param {string} [home]
 */
/**
 * Clear the "browser already opened" flag so the next daemon start
 * will open the browser again. Called by `npm run uninstall`.
 *
 * @param {string} [home]
 */
export function clearBrowserFlag(home = homedir()) {
  const flagPath = join(home, ".oni-vision", ".browser-opened");
  if (existsSync(flagPath)) {
    try {
      rmSync(flagPath);
    } catch { /* ignore */ }
  }
}
