# oni-watcher-plugin

Claude Code / Cowork plugin that wraps the [`oni-watcher`](..) SQLite output behind an MCP server, plus a skill that teaches the model how to use the tools. Drop this in your Claude Code or Cowork plugins directory and Claude can answer questions about your live ONI colony.

## Layout

```
oni-watcher-plugin/
├── plugin.json           # Claude plugin manifest
├── package.json          # MCP SDK dependency
├── mcp/
│   └── server.js         # stdio MCP server, exposes 6 tools
├── skills/
│   ├── oni-watcher/
│   │   └── SKILL.md      # how-to for the data tools
│   └── oni-architect/
│       ├── SKILL.md      # ONI design / strategy advisor
│       └── references/   # progressive-disclosure reference docs
│           ├── throughput.md
│           ├── geysers.md
│           ├── duplicants.md
│           ├── plants-and-critters.md
│           └── common-asks.md
└── lib/
    └── queries.js        # pure query layer (testable without MCP)
```

## What's in the box

**Two skills:**

- **`oni-watcher`** — teaches the model when and how to use the MCP tools below to answer questions about the user's *current* colony.
- **`oni-architect`** — a curated knowledge base for ONI strategy, debugging, and design advice. Loads `references/*.md` on demand (progressive disclosure). When `oni-watcher` data is available the architect grounds advice in actual numbers; otherwise it falls back to general design patterns.

**Six MCP tools:**

| Tool             | What                                                              |
|------------------|-------------------------------------------------------------------|
| `oni_save_meta`  | Base name, cycle, dupe count, save version, parsed_at staleness   |
| `oni_freshness`  | Seconds since the watcher last reparsed                           |
| `oni_dupes`      | Duplicants with vitals, sortable                                  |
| `oni_geysers`    | Every geyser/vent/volcano, with type and roll percentiles         |
| `oni_resources`  | Element totals — storage / world / both                           |
| `oni_query`      | SELECT-only SQL escape hatch                                      |

## Install

```bash
cd oni-watcher-plugin
npm install
```

The watcher itself (the parent project) needs to be running for there to be any data:

```bash
cd ..
npm start
```

## Wire it into Claude

The exact mechanism depends on your client. Add this plugin's directory to your Claude Code or Cowork plugin path, then enable the `oni-watcher` plugin in your client's plugin manager.

The MCP entry in `plugin.json` is:

```json
{
  "mcpServers": {
    "oni-watcher": {
      "command": "node",
      "args": ["./mcp/server.js"]
    }
  }
}
```

If your client expects a different manifest shape, the moving pieces it cares about are: spawn `node mcp/server.js` (cwd = this folder), speak MCP over stdio.

## How it finds the SQLite

`mcp/server.js` resolves the DB path at every call:
1. If `~/.oni-watcher/config.json` (or `~/.config/oni-watcher/config.json`) sets `outputDir`, it reads `<outputDir>/current.sqlite`.
2. Otherwise, falls back to `~/.oni-watcher/output/current.sqlite` (the watcher's default).

No plugin-specific config — it follows the watcher's config so there's only one source of truth.

## Safety

- The DB is opened **read-only** every call.
- `oni_query` rejects anything that isn't a single SELECT (or `WITH … SELECT`) statement. PRAGMA, ATTACH, INSERT, UPDATE, DELETE, DROP, ALTER are all rejected before reaching SQLite.
- Each call opens a fresh handle so we never serve stale rows after an atomic rename by the watcher.

## License

MIT — same as the parent project.
