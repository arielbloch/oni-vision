// browser.js — open the web dashboard in the user's default browser.
//
// Called once at daemon startup after the web server is up.
// Guards:
//   • Only when a TTY is attached — background services (launchctl, systemd)
//     must not pop a browser window on every boot.
//   • Only once per process — an in-memory flag prevents re-opening on
//     subsequent save events within the same daemon run.
//
// On macOS, tries to reuse an existing tab via AppleScript before falling
// back to `open`, so restarting the daemon doesn't pile up tabs.
//
// The open command is fire-and-forget (detached child, stdio ignored).
// Failure is logged as a warning but never fatal.

import { spawn, spawnSync } from "node:child_process";

/**
 * macOS only: use AppleScript to find a tab already showing `url` in any
 * common Chromium-based browser and bring it to the front.
 *
 * Returns true if a tab was found and focused, false otherwise (including
 * when osascript is unavailable or all browsers are closed).
 */
function tryFocusExistingTabMac(url) {
  // Strip trailing slash for a stable prefix match inside the script.
  const base = url.replace(/\/$/, "");
  const script = [
    `set u to "${base}"`,
    // Standard Chromium browsers (Chrome tab activation API)
    `set browsers to {"Google Chrome", "Brave Browser", "Microsoft Edge", "Chromium"}`,
    `repeat with b in browsers`,
    `  try`,
    `    tell application b`,
    `      repeat with w in windows`,
    `        repeat with t in tabs of w`,
    `          if URL of t starts with u then`,
    `            set active tab index of w to index of t`,
    `            set index of w to 1`,
    `            activate`,
    `            return "ok"`,
    `          end if`,
    `        end repeat`,
    `      end repeat`,
    `    end tell`,
    `  end try`,
    `end repeat`,
    // Arc uses a different tab activation API
    `try`,
    `  tell application "Arc"`,
    `    repeat with w in windows`,
    `      repeat with t in tabs of w`,
    `        if URL of t starts with u then`,
    `          tell w to set active tab to t`,
    `          activate`,
    `          return "ok"`,
    `        end if`,
    `      end repeat`,
    `    end repeat`,
    `  end tell`,
    `end try`,
    `return "none"`,
  ].join("\n");

  try {
    const result = spawnSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 3000,
    });
    return result.stdout?.trim() === "ok";
  } catch {
    return false;
  }
}

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

  // On macOS, prefer reusing an existing tab over opening a new one.
  if (platform === "darwin" && tryFocusExistingTabMac(url)) {
    sessionOpened = true;
    console.log(`[vision] focused existing dashboard tab: ${url}`);
    return true;
  }

  const cmd = OPEN_CMD[platform] ?? "xdg-open";
  const prefix = OPEN_ARGS_PREFIX[platform] ?? [];
  const args = [...prefix, url];

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    // Suppress ENOENT / EACCES if the open command doesn't exist on this
    // platform. Without this listener Node.js emits an unhandled 'error'
    // event and crashes the process — most visible in tests that pass
    // platform:"linux" on macOS where xdg-open isn't installed.
    child.on("error", () => { /* detached — ignore launch errors */ });
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
