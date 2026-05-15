# Claude Code / Claude Desktop MCP Plugin Integration Plan

## Goal

Make `oni-vision-plugin` a first-class MCP plugin for the Claude ecosystem — installable via `npx`, discoverable by Claude Desktop and Claude Code CLI, with skills auto-loaded and zero manual config file editing.

## Current State

### What exists today
- A working MCP server (`oni-vision-plugin/mcp/server.js`) exposing 10 typed tools over stdio.
- Two well-written skills (`oni-vision` for data access, `oni-architect` for strategy).
- `plugin.json` that claims to be a "Claude plugin manifest."
- README instructions that say "Drop this in your Claude Code or Cowork plugins directory."

### What I verified by researching the Claude ecosystem

**Claude does NOT recognize `plugin.json`.**  
Claude Desktop and Claude Code CLI both expect MCP servers to be registered via JSON config files — there is no plugin manifest format analogous to Kimi's `plugin.json`. The `plugin.json` in the repo is essentially a no-op for Claude.

**Claude Code CLI skill discovery paths:**
- `~/.claude/skills/` (user-level)
- `<work_dir>/.claude/skills/` (project-level)

**Claude Desktop MCP config:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Claude Code CLI MCP config:**
- `~/.claude/settings.json` or `~/.claude.json` (the `mcpServers` field)

---

## Gap Analysis

### Gap 1: No published npm package

**Problem:** Every major MCP server in the ecosystem is distributed via npm. Users expect to install with:

```bash
npx -y oni-vision-plugin
```

Instead, they must clone the repo, `cd` into a subdirectory, run `npm install`, and hand-edit a JSON config file with an absolute path.

**Current blocker:** `oni-vision-plugin/package.json` has `"private": true` and no `bin` entry.

**Fix:**
1. Remove `"private": true`.
2. Add a `bin` entry pointing at `mcp/server.js`:
   ```json
   "bin": {
     "oni-vision-mcp": "mcp/server.js"
   }
   ```
3. Make `mcp/server.js` executable (`chmod +x`) and add a shebang:
   ```js
   #!/usr/bin/env node
   ```
4. Publish to npm (or GitHub Packages).

After this, the Claude Desktop config becomes a one-liner:
```json
{
  "mcpServers": {
    "oni-vision": {
      "command": "npx",
      "args": ["-y", "oni-vision-plugin"]
    }
  }
}
```

---

### Gap 2: Skills are invisible to Claude

**Problem:** Claude Code CLI scans for skills in `.claude/skills/` (project-level or user-level). The skills are currently buried at `oni-vision-plugin/skills/oni-vision/` and `oni-vision-plugin/skills/oni-architect/` — Claude never sees them.

**Fix:** Create `.claude/skills/` at the repo root. Options:

**Option A — Symlink (DRY, development-friendly):**
```bash
mkdir -p .claude
ln -s ../oni-vision-plugin/skills .claude/skills
```

**Option B — Copy (Windows-friendly, standalone):**
Copy skill files into `.claude/skills/` and keep them in sync. More maintenance, but works everywhere.

**Option C — Both:**
- Symlink at repo root for development
- Document that users can `cp -r oni-vision-plugin/skills/* ~/.claude/skills/` for global access

**Recommendation:** Option A for now. Commit the symlink. Windows users can fall back to manual copy (documented in README).

---

### Gap 3: No example config files in the repo

**Problem:** Users must hunt for the correct config file path and JSON schema. Most MCP repos ship ready-to-copy snippets or example files.

**Fix:** Add example configs:

```
oni-vision-plugin/
└── config-examples/
    ├── claude_desktop_config.json
    └── claude_code_settings.json
```

**`claude_desktop_config.json` (for local dev path):**
```json
{
  "mcpServers": {
    "oni-vision": {
      "command": "node",
      "args": [
        "--no-warnings=ExperimentalWarning",
        "/ABSOLUTE/PATH/TO/oni-vision-plugin/mcp/server.js"
      ]
    }
  }
}
```

**`claude_code_settings.json`:**
```json
{
  "mcpServers": {
    "oni-vision": {
      "command": "node",
      "args": [
        "--no-warnings=ExperimentalWarning",
        "/ABSOLUTE/PATH/TO/oni-vision-plugin/mcp/server.js"
      ]
    }
  }
}
```

Once published to npm, both examples switch to the `npx -y oni-vision-plugin` one-liner.

---

### Gap 4: `plugin.json` misleads maintainers

**Problem:** `oni-vision-plugin/plugin.json` is labeled "Claude plugin manifest" in the README, but Claude has no concept of this file. It only works for Kimi Code CLI (and even there, partially — see `docs/kimi-code-mcp-plugin-plan.md`).

**Fix:** Be explicit about what `plugin.json` is for. Update the README:

```markdown
## Plugin manifests

- `plugin.json` — Kimi Code CLI plugin spec (ignored by Claude).
- For Claude Desktop / Claude Code CLI, use the MCP config examples below.
```

Or remove `plugin.json` entirely from the Claude-facing docs and keep it as an internal Kimi artifact.

---

### Gap 5: No `npm install` guard in the MCP server

**Problem:** If a user points Claude at `mcp/server.js` without running `npm install` first, the server crashes immediately with `ERR_MODULE_NOT_FOUND` for `@modelcontextprotocol/sdk`. Claude Desktop shows a generic "connection failed" error with no hint about the missing dependencies.

**Fix:** Add a startup check in `mcp/server.js`:

```js
// At the top of server.js
try {
  await import("@modelcontextprotocol/sdk/server/index.js");
} catch (err) {
  if (err.code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "[@modelcontextprotocol/sdk] not found. " +
      "Run 'npm install' in the oni-vision-plugin directory."
    );
  }
  throw err;
}
```

Better yet, publishing to npm (Gap 1) eliminates this entirely because `npx` handles installation.

---

### Gap 6: README mixes Claude Code, Claude Desktop, and Cowork without distinguishing them

**Problem:** The current README says "Claude Code / Cowork plugin" and "Drop this in your Claude Code or Cowork plugins directory." But:
- **Claude Desktop** has no "plugins directory" — it uses `claude_desktop_config.json`.
- **Claude Code CLI** uses `~/.claude/settings.json`.
- **Cowork** (if it still exists as a separate product) may have yet another mechanism.

**Fix:** Restructure the README into three sections:

1. **Claude Desktop** — config file path + JSON snippet
2. **Claude Code CLI** — `claude mcp add` or settings.json path
3. **Kimi Code CLI** — `kimi plugin install` + setup script

---

### Gap 7: No `claude mcp add` support documented

**Problem:** Claude Code CLI has a `claude mcp add` command (analogous to `kimi mcp add`). Most users prefer CLI commands over hand-editing JSON.

**Fix:** Document the CLI path:

```bash
# Claude Code CLI
claude mcp add oni-vision -- node --no-warnings=ExperimentalWarning \
  /path/to/oni-vision-plugin/mcp/server.js
```

Once npm-published:
```bash
claude mcp add oni-vision -- npx -y oni-vision-plugin
```

---

## Implementation Order

1. **Add `.claude/skills` symlink** at repo root (parallel to `.kimi/skills`).
2. **Add `config-examples/`** with `claude_desktop_config.json` and `claude_code_settings.json`.
3. **Clean up `plugin.json` documentation** — clarify it's Kimi-only.
4. **Add startup dependency check** to `mcp/server.js` (quick win until npm publish).
5. **Restructure README** into per-client sections (Claude Desktop, Claude Code CLI, Kimi).
6. **Prepare for npm publish** (shebang, `bin`, remove `private`, tag release).
7. **Update examples to `npx -y`** after publish.

---

## Comparison: Kimi vs Claude Plugin Gaps

| Issue | Kimi | Claude |
|-------|------|--------|
| Plugin manifest | `plugin.json` (partially works) | No manifest format; pure MCP config |
| MCP registration | Ignored in `plugin.json`; manual `kimi mcp add` required | Always manual via config file or `claude mcp add` |
| Skill discovery | `~/.kimi/skills/` or `<work_dir>/.kimi/skills/` | `~/.claude/skills/` or `<work_dir>/.claude/skills/` |
| Dependency install | Manual `npm install` in plugin dir | Manual `npm install` in plugin dir (or use `npx`) |
| One-command install | `kimi plugin install` + setup script | `npx -y oni-vision-plugin` (after npm publish) |

**Bottom line:** Claude has *less* infrastructure for "plugins" than Kimi. There is no `claude plugin install`. The closest thing to a "proper Claude plugin" is an npm-published MCP server that users add via `claude mcp add` or paste into their config file.
