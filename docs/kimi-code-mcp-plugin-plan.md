# Kimi Code CLI Plugin Integration Plan

## Goal

Make `oni-vision-plugin` a first-class Kimi Code CLI plugin that installs with a single command and works out of the box — MCP server registered, dependencies installed, skills discoverable.

## Current State (tested 2026-05-15)

What works:
- `kimi plugin install ./oni-vision-plugin` succeeds and copies the plugin into `~/.kimi/plugins/oni-vision/`.
- The MCP server itself is solid: 10 tools, read-only SQLite, compact JSON/TSV output.
- Skills (`oni-vision` and `oni-architect`) are well-written with progressive-disclosure references.

What does **not** work automatically:
- `kimi mcp list` is empty after install — the `mcpServers` block in `plugin.json` is ignored by Kimi.
- `npm install` inside the plugin directory is never run — `kimi mcp test oni-vision` fails with `ERR_MODULE_NOT_FOUND`.
- Skills are invisible — Kimi scans `~/.kimi/skills/` and `<work_dir>/.kimi/skills/`, not inside installed plugins.

## Root Cause: Kimi's Plugin Spec

Kimi Code CLI (`v1.44.0`) only reads these fields from `plugin.json`:

```python
class PluginSpec(BaseModel):
    name: str
    version: str
    description: str = ""
    config_file: str | None = None   # JSON file to inject host values into
    inject: dict[str, str] = {}      # dotted-path → host-value key
    tools: list[PluginToolSpec] = [] # native plugin tools (not MCP)
    runtime: PluginRuntime | None = None  # written by host on install
```

Everything else (`mcpServers`, `skills`, `author`, `homepage`, `license`) is silently ignored via `extra="ignore"`.

There is no post-install hook. Kimi copies the source tree and writes `runtime`, then stops.

---

## Proposed Fixes

### 1. Add `.kimi/skills/` at the repo root

**Why:** Kimi auto-discovers project-level skills when the working directory is the oni-vision repo. This makes the skills available during development and when users run `kimi` inside the project.

**Implementation:**
```bash
mkdir -p .kimi
ln -s ../oni-vision-plugin/skills .kimi/skills
```

Commit the symlink. Skills will appear as:
- `.kimi/skills/oni-vision/SKILL.md`
- `.kimi/skills/oni-architect/SKILL.md`
- `.kimi/skills/oni-architect/references/*.md`

**Alternative:** Copy the files instead of symlinking if cross-platform support (Windows) matters more than DRY.

---

### 2. Add a setup script inside the plugin

**Why:** Kimi has no post-install hook, so we ship a script the user runs once after `kimi plugin install`.

**Implementation:** `oni-vision-plugin/scripts/setup.sh`

```bash
#!/usr/bin/env bash
set -e

PLUGIN_DIR="${HOME}/.kimi/plugins/oni-vision"
if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "Plugin not installed. Run: kimi plugin install ./oni-vision-plugin"
  exit 1
fi

cd "$PLUGIN_DIR"
echo "[setup] installing npm dependencies..."
npm install

echo "[setup] registering MCP server..."
kimi mcp add --transport stdio oni-vision -- \
  node --no-warnings=ExperimentalWarning \
  "$PLUGIN_DIR/mcp/server.js"

echo "[setup] verifying connection..."
kimi mcp test oni-vision

echo "[setup] done."
```

**Windows counterpart:** `oni-vision-plugin/scripts/setup.bat` or a cross-platform Node script `scripts/setup.js`.

---

### 3. Clean up `plugin.json`

**Why:** Remove fields that Kimi ignores to avoid misleading future maintainers.

**Current:**
```json
{
  "name": "oni-vision",
  "version": "0.1.0",
  "description": "...",
  "author": "Ariel Bloch",
  "homepage": "https://github.com/ArielBloch/oni-vision",
  "license": "MIT",
  "mcpServers": { ... },
  "skills": [ ... ]
}
```

**Proposed:**
```json
{
  "name": "oni-vision",
  "version": "0.1.0",
  "description": "Query your live Oxygen Not Included colony save. Provides typed read-only tools (dupes, geysers, resources, food) plus a SELECT-only SQL escape hatch over the SQLite database produced by the oni-vision daemon.",
  "config_file": null,
  "inject": {},
  "tools": []
}
```

Move `author`, `homepage`, `license` into `README.md` where they belong.

---

### 4. Update install documentation

**Why:** Users need to know about the two-step install (plugin + setup script).

**New `oni-vision-plugin/README.md` install section:**

```markdown
## Install (Kimi Code CLI)

```bash
# 1. Install the plugin
kimi plugin install ./oni-vision-plugin

# 2. Run the setup script (installs deps + registers MCP server)
~/.kimi/plugins/oni-vision/scripts/setup.sh
```

**Install (Claude Code / other MCP clients)**

Add to your MCP config:
```json
{
  "mcpServers": {
    "oni-vision": {
      "command": "node",
      "args": [
        "--no-warnings=ExperimentalWarning",
        "/path/to/oni-vision-plugin/mcp/server.js"
      ]
    }
  }
}
```
```

---

### 5. (Optional) Bundle `node_modules` for zero-dependency install

**Why:** Eliminates the `npm install` step entirely. Trade-off: ~2 MB of committed binaries.

**How:** After running `npm install` in `oni-vision-plugin/`, commit `node_modules/@modelcontextprotocol/sdk` and its transitive deps. Add `oni-vision-plugin/node_modules/` to the parent `.gitignore` with an exception:

```gitignore
# Parent .gitignore
node_modules/

# But bundle the plugin's deps so users don't need npm
!oni-vision-plugin/node_modules/
```

**Verdict:** Skip for now. The `scripts/setup.sh` approach is cleaner and keeps the repo small. Revisit if users complain about the extra step.

---

## Open Questions

1. **Should we auto-copy skills into `~/.kimi/skills/` during setup?**
   - Pro: Skills work in any working directory, not just the oni-vision repo.
   - Con: Duplicates source of truth; updates to `oni-vision-plugin/skills/` won't sync automatically.
   - Recommendation: Start with the `.kimi/skills/` symlink at repo root only. Document that users can manually symlink into `~/.kimi/skills/` if they want the skills globally.

2. **Should the setup script be a Node script instead of bash?**
   - Pro: Cross-platform (Windows without WSL).
   - Con: Requires Node to already be installed to run the setup script that installs Node deps. Circular.
   - Recommendation: Provide both `setup.sh` and `setup.bat`. Most ONI players are on Windows or macOS.

3. **Should the MCP server path use an absolute path?**
   - Currently `plugin.json` uses `"./mcp/server.js"` which is relative to the plugin directory. Kimi ignores this anyway, but our setup script writes an absolute path into `~/.kimi/mcp.json`.
   - This is correct: absolute paths survive working-directory changes.

---

## Implementation Order

1. Create `.kimi/skills → oni-vision-plugin/skills` symlink.
2. Write `oni-vision-plugin/scripts/setup.sh` (+ `.bat`).
3. Clean up `oni-vision-plugin/plugin.json`.
4. Update `oni-vision-plugin/README.md` with Kimi-specific install steps.
5. Update top-level `README.md` to mention Kimi support alongside Claude Code.
6. Test end-to-end: uninstall → reinstall → run setup → `kimi mcp test oni-vision` → ask a colony question.
