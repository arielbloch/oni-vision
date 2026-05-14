#!/usr/bin/env node
// npm run uninstall — remove the oni-vision login-time service and clean up.
//
// macOS:  unloads and deletes the LaunchAgent plist.
// Linux:  stops + disables the systemd user service and deletes the unit file.
// Windows: deletes the Task Scheduler entry.
//
// Also clears the "browser already opened" flag so the next manual `npm start`
// will open the dashboard in the browser again.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { clearBrowserFlag } from "../browser.js";

const HOME     = homedir();
const PLATFORM = process.platform;

if (PLATFORM === "darwin") {
  uninstallMacOS();
} else if (PLATFORM === "linux") {
  uninstallLinux();
} else if (PLATFORM === "win32") {
  uninstallWindows();
} else {
  console.error(`[uninstall] unsupported platform: ${PLATFORM}`);
  process.exit(1);
}

clearBrowserFlag(HOME);
console.log("[uninstall] ✓ done.");

// ── macOS ─────────────────────────────────────────────────────────────────────

function uninstallMacOS() {
  const plistPath = join(HOME, "Library", "LaunchAgents", "com.oni-vision.daemon.plist");

  if (existsSync(plistPath)) {
    spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
    try {
      rmSync(plistPath);
      console.log(`[uninstall] removed ${plistPath}`);
    } catch (err) {
      console.warn(`[uninstall] could not delete plist: ${err.message}`);
    }
  } else {
    console.log("[uninstall] no LaunchAgent plist found — nothing to remove.");
  }
}

// ── Linux ─────────────────────────────────────────────────────────────────────

function uninstallLinux() {
  const servicePath = join(HOME, ".config", "systemd", "user", "oni-vision.service");

  // Best-effort stop + disable; ignore errors if service was never registered.
  spawnSync("systemctl", ["--user", "stop",    "oni-vision"], { stdio: "ignore" });
  spawnSync("systemctl", ["--user", "disable", "oni-vision"], { stdio: "ignore" });

  if (existsSync(servicePath)) {
    try {
      rmSync(servicePath);
      console.log(`[uninstall] removed ${servicePath}`);
    } catch (err) {
      console.warn(`[uninstall] could not delete unit file: ${err.message}`);
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  } else {
    console.log("[uninstall] no systemd unit file found — nothing to remove.");
  }
}

// ── Windows ───────────────────────────────────────────────────────────────────

function uninstallWindows() {
  const taskName = "oni-vision-daemon";
  const result = spawnSync(
    "schtasks",
    ["/delete", "/tn", taskName, "/f"],
    { stdio: "inherit", shell: true }
  );
  if (result.status === 0) {
    console.log(`[uninstall] removed scheduled task "${taskName}"`);
  } else {
    // schtasks returns non-zero when the task doesn't exist; treat as soft error.
    console.log(`[uninstall] scheduled task "${taskName}" not found — nothing to remove.`);
  }
}
