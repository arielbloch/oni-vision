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

  // JXA (JavaScript for Automation) — more portable than AppleScript across
  // browsers; handles Arc's different tab API gracefully via try/catch.
  // Must be wrapped in an IIFE because JXA disallows top-level return.
  const script = `(function() {
    var u = ${JSON.stringify(base)};
    var browsers = ["Google Chrome", "Brave Browser", "Microsoft Edge", "Chromium", "Arc"];
    for (var bi = 0; bi < browsers.length; bi++) {
      try {
        var app = Application(browsers[bi]);
        if (!app.running()) continue;
        var wins = app.windows();
        for (var wi = 0; wi < wins.length; wi++) {
          try {
            var tabs = wins[wi].tabs();
            for (var ti = 0; ti < tabs.length; ti++) {
              try {
                var tabUrl = tabs[ti].url();
                if (tabUrl && tabUrl.indexOf(u) === 0) {
                  wins[wi].activeTabIndex = ti + 1;
                  app.activate();
                  return "ok";
                }
              } catch(e) {}
            }
          } catch(e) {}
        }
      } catch(e) {}
    }
    return "none";
  })()`;

  try {
    const result = spawnSync("osascript", ["-l", "JavaScript", "-e", script], {
      encoding: "utf8",
      timeout: 5000,
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
    return true;
  } catch {
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
