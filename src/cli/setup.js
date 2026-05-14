#!/usr/bin/env node
// npm run setup — install oni-vision as a login-time background service.
//
// macOS:  writes a LaunchAgent plist and calls `launchctl load` on it.
//         The daemon starts at login and is kept alive by launchd.
// Linux:  writes a systemd user service and calls
//         `systemctl --user enable --now oni-vision`.
// Windows: uses schtasks to create a Task Scheduler entry that runs at logon.
//
// All paths are resolved from this file's location so the script works
// whether the project is cloned into any directory.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const NODE_BIN     = process.execPath;          // absolute path to the node binary
const DAEMON_ENTRY = join(PROJECT_ROOT, "src", "index.js");
const LOG_FILE     = join(homedir(), ".oni-vision", "daemon.log");
const PLATFORM     = process.platform;

// ── dispatch ──────────────────────────────────────────────────────────────────

if (PLATFORM === "darwin") {
  setupMacOS();
} else if (PLATFORM === "linux") {
  setupLinux();
} else if (PLATFORM === "win32") {
  setupWindows();
} else {
  console.error(`[setup] unsupported platform: ${PLATFORM}`);
  process.exit(1);
}

// ── macOS — LaunchAgent ───────────────────────────────────────────────────────

function setupMacOS() {
  const agentsDir = join(homedir(), "Library", "LaunchAgents");
  const plistPath = join(agentsDir, "com.oni-vision.daemon.plist");

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dirname(LOG_FILE), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.oni-vision.daemon</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>--no-warnings=ExperimentalWarning</string>
    <string>${DAEMON_ENTRY}</string>
  </array>

  <!-- Start immediately and restart if it exits. -->
  <key>RunAtLoad</key>   <true/>
  <key>KeepAlive</key>   <true/>

  <!-- Logs land in ~/.oni-vision/daemon.log -->
  <key>StandardOutPath</key>  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
`;

  writeFileSync(plistPath, plist, "utf8");
  console.log(`[setup] wrote ${plistPath}`);

  // If already loaded, unload first so we pick up any changes.
  spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });

  const result = spawnSync("launchctl", ["load", plistPath], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[setup] launchctl load failed — plist written but service not started.");
    process.exit(1);
  }

  console.log("[setup] ✓ oni-vision will start automatically at login.");
  console.log(`[setup]   Logs: ${LOG_FILE}`);
  console.log("[setup]   To stop now:    launchctl unload ~/Library/LaunchAgents/com.oni-vision.daemon.plist");
  console.log("[setup]   To uninstall:   npm run uninstall");
}

// ── Linux — systemd user service ─────────────────────────────────────────────

function setupLinux() {
  const serviceDir  = join(homedir(), ".config", "systemd", "user");
  const servicePath = join(serviceDir, "oni-vision.service");

  mkdirSync(serviceDir,       { recursive: true });
  mkdirSync(dirname(LOG_FILE), { recursive: true });

  const unit = `[Unit]
Description=oni-vision — Oxygen Not Included save watcher
After=network.target

[Service]
ExecStart=${NODE_BIN} --no-warnings=ExperimentalWarning ${DAEMON_ENTRY}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`;

  writeFileSync(servicePath, unit, "utf8");
  console.log(`[setup] wrote ${servicePath}`);

  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", "oni-vision"]);

  console.log("[setup] ✓ oni-vision is running and will start automatically at login.");
  console.log(`[setup]   Logs:   ${LOG_FILE}   (or: journalctl --user -u oni-vision -f)`);
  console.log("[setup]   Status: systemctl --user status oni-vision");
  console.log("[setup]   To uninstall: npm run uninstall");
}

// ── Windows — Task Scheduler ──────────────────────────────────────────────────

function setupWindows() {
  // Create a task that runs at logon for the current user, hidden (no window).
  const taskName = "oni-vision-daemon";
  const cmd = `"${NODE_BIN}" --no-warnings=ExperimentalWarning "${DAEMON_ENTRY}"`;

  // Delete any existing task with the same name first.
  spawnSync("schtasks", ["/delete", "/tn", taskName, "/f"], { stdio: "ignore" });

  const result = spawnSync(
    "schtasks",
    [
      "/create",
      "/tn",  taskName,
      "/tr",  cmd,
      "/sc",  "ONLOGON",
      "/rl",  "HIGHEST",  // run with highest privileges available to the user
      "/f",               // overwrite if exists
    ],
    { stdio: "inherit", shell: true }
  );

  if (result.status !== 0) {
    console.error("[setup] schtasks /create failed.");
    process.exit(1);
  }

  // Start immediately without waiting for next login.
  spawnSync("schtasks", ["/run", "/tn", taskName], { stdio: "inherit" });

  console.log("[setup] ✓ oni-vision is running and will start automatically at login.");
  console.log(`[setup]   Task name: ${taskName}`);
  console.log("[setup]   To uninstall: npm run uninstall");
}

// ── helpers ───────────────────────────────────────────────────────────────────

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[setup] command failed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
}
