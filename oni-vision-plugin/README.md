# oni-vision plugin

Claude Code / Cowork plugin that lets Claude query your live **Oxygen Not Included** colony data. The oni-vision daemon parses your save into SQLite on every autosave; this plugin exposes that database as typed read-only tools and loads two AI skills — one for raw colony data, one for strategy advice.

---

## Prerequisites

- **oni-vision daemon running** — `npm start` in the `oni-vision` repo while ONI is open. The daemon watches for new saves and reparses them automatically.
- **Node.js ≥ 22.5** — required by both the daemon and the MCP server (`node:sqlite` is built-in from 22.5).
- **Claude Code** — the CLI tool (`npm install -g @anthropic-ai/claude-code`).

---

## Installation

### Option A — Install as a plugin (recommended)

```bash
# From within a Claude Code session:
/plugin install /path/to/oni-vision/oni-vision-plugin
```

This registers the MCP server and loads both skills (`oni-vision` and `oni-architect`) automatically.

### Option B — Claude desktop app (Cowork)

Add the MCP server to `~/Library/Application Support/Claude/claude_desktop_config.json` (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "oni-vision": {
      "command": "node",
      "args": [
        "--no-warnings=ExperimentalWarning",
        "/Users/ariel/code/oni-vision/oni-vision-plugin/mcp/server.js"
      ]
    }
  }
}
```

Restart the Claude desktop app after saving. The MCP tools will be available in any Cowork session.

### Option C — Register only the MCP server (Claude Code, no plugin system)

```bash
claude mcp add oni-vision -- node --no-warnings=ExperimentalWarning /path/to/oni-vision/oni-vision-plugin/mcp/server.js
```

The MCP tools become available in the current project; skills must be loaded separately.

---

## Plugin layout

```
oni-vision-plugin/
├── .claude-plugin/
│   └── plugin.json          # Canonical Claude Code plugin manifest.
│                            # Declares the MCP server + skill paths.
│                            # Used by /plugin install.
├── .mcp.json                # Per-project MCP registration helper.
│                            # Used by `claude mcp add` (no plugin system).
│                            # Distinct from .claude-plugin/ — see below.
├── mcp/
│   └── server.js            # MCP server entry point
├── lib/
│   └── queries.js           # Query functions used by the MCP server
├── skills/
│   ├── oni-vision/          # Data skill — when/how to use the MCP tools
│   │   ├── SKILL.md
│   │   └── references/
│   └── oni-architect/       # Strategy skill — colony design and debugging
│       ├── SKILL.md
│       └── references/
└── README.md
```

**Two config files, two concepts:**

- `.claude-plugin/plugin.json` — the **plugin manifest** consumed by `/plugin install`. It declares the MCP server to spawn (via `${CLAUDE_PLUGIN_ROOT}`) and the skills to load. Use this path when you want the full plugin experience (tools + skills).

- `.mcp.json` — a **per-project MCP registration** file consumed by `claude mcp add --file` or by placing it in a project root. It registers only the MCP server without the plugin system. Use this if you want to add the MCP tools to a specific project without a global plugin install.

The MCP server is stateless: it opens `~/.oni-vision/output/current.sqlite` read-only on each tool call, so it always reads the freshest snapshot the daemon produced.

---

## MCP tools

All tools are read-only. Any write attempt via `oni_query` is rejected.

---

### `oni_save_meta`

Headline facts from the parsed save. **Start here when in doubt** — it's cheap (~50 tokens) and tells you the base name, cycle, dupe count, save version, and when it was last parsed.

**Input:** none

**Output example:**
```json
{
  "base_name": "Cosmic Conundrum",
  "cycle": 312,
  "duplicant_count": 12,
  "save_version": "7.26",
  "parsed_at": "2026-05-09T17:32:11.000Z",
  "source_file": "/Users/ariel/…/my_colony.sav"
}
```

---

### `oni_freshness`

Seconds since the daemon last reparsed the save. Use when the question is time-sensitive.

**Input:** none

**Output example:**
```json
{ "age_seconds": 47, "parsed_at": "2026-05-09T17:32:11.000Z" }
```

Returns `{ "age_seconds": null, "parsed_at": null }` if the daemon hasn't run yet.

---

### `oni_status`

**Preferred entry point for general colony questions.** Returns a compact TSV-block snapshot covering cycle, dupe count, critters, geyser count, top stressed dupes, geyser type summary (with human-readable names), top elements by mass, and parse staleness. Replaces 4–5 separate tool calls with one ~400-token response.

**Input:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dupeLimit` | integer | 5 | How many top-stressed dupes to include |
| `geyserLimit` | integer | 10 | How many geyser types to include |
| `resourceLimit` | integer | 5 | How many top elements to include |

---

### `oni_schema`

Lists every table and view in the DB with their column names. ~200 tokens. Call once before writing `oni_query` SQL if you don't already know the schema.

**Input:** none

---

### `oni_dupes`

One row per duplicant. Sortable and projectable to keep token usage low.

**Input:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sort` | string | `"stress"` | Sort column — any of: `stress`, `calories`, `stamina`, `bladder`, `breath`, `hp`, `decor`, `immune`, `body_temperature`, `gender`, `current_role`, `target_role`, `name` |
| `fields` | string[] | all | Columns to return. Unknown names are silently dropped. |
| `limit` | integer | 12 | Max rows |
| `format` | `"json"` \| `"tsv"` | `"json"` | TSV is ~50% smaller for tabular returns |

**Tip:** `fields: ["name", "stress", "current_role"]` is typically enough for stress questions and is ~10× smaller than the default full projection.

---

### `oni_dupe`

Everything about a single duplicant: vitals, traits, mastered skills, attribute levels, and active status effects. Replaces several `oni_query` calls; ~100–150 tokens.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Duplicant name. Case-sensitive. |

**Output shape:**
```json
{
  "name": "Meep",
  "stress": 12.5,
  "calories": 4000,
  "current_role": "Miner",
  "traits": ["Gastrophobia", "Uncultured"],
  "skills": ["Mining1", "Mining2", "Building1"],
  "attributes": [{ "attribute": "Digging", "level": 7, "experience": 8400 }],
  "effects": []
}
```

---

### `oni_geysers`

Every geyser, vent, and volcano on the map with type, human-readable name, position, and roll percentiles.

**Input:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | `"json"` \| `"tsv"` | `"json"` | Output format |

**Important:** `rate_roll` and `year_percent_roll` are **0–1 percentiles** against the geyser type's base range — not kg/s. See the `oni-architect` skill's `geysers.md` reference for the formula to convert percentiles to average kg/s output.

**Output columns:** `prefab_id`, `type_id`, `type_name`, `position_x`, `position_y`, `rate_roll`, `year_percent_roll`

---

### `oni_resources`

Aggregate stored resources by element, across containers, the map floor, or both.

**Input:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `location` | `"storage"` \| `"world"` \| `"both"` | `"both"` | Where to look |
| `limit` | integer | 10 | Max element types |
| `format` | `"json"` \| `"tsv"` | `"json"` | Output format |

**Output columns:** `element_id`, `element_name`, `total_units` (kg, integers ≥100 kg), `items`

---

### `oni_food`

Food items currently in colony storage, joined with the `foods` lookup table for human-readable names, kcal values, and morale bonuses.

**Input:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 20 | Max food types |
| `format` | `"json"` \| `"tsv"` | `"json"` | Output format |

**Output columns:** `prefab_id`, `name`, `kcal`, `morale`, `qty` (stack count)

Unknown food items (new DLC content not yet in `foods`) appear with `null` name/kcal/morale and their raw `prefab_id`.

---

### `oni_query`

Run an arbitrary SELECT (or `WITH … SELECT`) against the full DB schema. **For anything the typed tools don't cover.**

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sql` | string | ✓ | A single SELECT statement. Semicolons anywhere in the string are rejected. |
| `params` | array | | Positional `?` parameters |
| `format` | `"json"` \| `"tsv"` | | Default: `json`. Use `tsv` for large tabular returns. |

**Safety:** Any non-SELECT statement (UPDATE, DROP, ATTACH, PRAGMA write, etc.) is rejected. Multiple statements are rejected.

**Key tables for `oni_query`:**

| Table | What's in it |
|-------|-------------|
| `save_meta(key, value)` | Cycle, base name, version, parsed_at, source_file |
| `duplicants` | One row per dupe; all vital stats |
| `duplicant_traits(duplicant_id, trait)` | Join on `duplicants.game_object_id` |
| `duplicant_skills(duplicant_id, skill)` | Mastered skills only |
| `duplicant_attributes(duplicant_id, attribute, level, experience)` | |
| `duplicant_effects(duplicant_id, effect, time_remaining)` | Active status effects |
| `buildings(game_object_id, prefab_id, position_x, position_y, element_id, units, temperature)` | Placed structures |
| `world_objects` | Loose resources, plants, eggs — same shape as `buildings` |
| `storage_contents(owner_id, item_prefab_id, element_id, units, temperature)` | Items inside Storage behaviors |
| `geysers(game_object_id, prefab_id, type_id, rate_roll, year_percent_roll, position_x, position_y, scaled_year_length_s, scaled_year_percent)` | `scaled_year_*` are the resolved per-instance dormancy-cycle length/percent (no live eruption countdown — phase isn't persisted) |
| `critters(game_object_id, prefab_id, age, calories, hp, happiness, temperature)` | |
| `behaviors(game_object_id, name, template_data, extra_data)` | Generic fallback; template_data is JSON |
| `elements(element_id, name)` | SimHash → element name lookup |
| `geyser_types(type_id, name, element, output_temp_c, yield_min_kg_cycle, yield_max_kg_cycle, lifetime_avg_kg_cycle, dlc, disease)` | SimHash → geyser type name, produced resource, output temp, and yield (kg/cycle) |
| `foods(prefab_id, name, kcal, morale)` | Food metadata |
| `effects(effect, label, severity)` | Status effect display labels |
| `skills(branch, label)` | Skill branch → display name |
| `chore_groups(hash, name, label, domain, abbr, sort_order)` | Chore-group catalog with FE display metadata |

Convenience views: `v_resources_in_storage`, `v_world_objects_by_element`, `v_geysers_summary`, `v_buildings_by_prefab`.

---

## Skills

Skills are loaded automatically when the plugin is installed. They teach Claude when and how to use the tools, provide reference material, and handle common colony questions efficiently.

### `oni-vision` — Colony data skill

Activates whenever you ask about your colony: dupes, geysers, resources, food, cycle, stress, traits, skills, effects. Knows which tool to use for each question, how to keep token usage low (TSV format, field projection, `oni_status` as the entry point), and how to interpret the results.

### `oni-architect` — Colony strategy skill

Activates for strategy, design, and debugging questions: "what should I build next?", "why is my oxygen low?", "is this geyser worth taming?", "how do I set up a steam turbine loop?". Uses `oni-vision` tools when live data is available to ground advice in real numbers rather than generic guidance.

Reference material loaded on demand from `skills/oni-architect/references/`:
- `geysers.md` — geyser type table with SimHash integers, roll-to-kg/s formula, tameability heuristics, overpressure rules
- `throughput.md` — oxygen, food, power, heat throughput numbers and cardinal rates
- `duplicants.md` — trait quick reference, skill build order, stress management
- `plants-and-critters.md` — plant farming conditions, critter ranching inputs/outputs
- `common-asks.md` — canned answers for the most frequent colony questions

---

## Configuration

The MCP server reads `~/.oni-vision/config.json` (the same config file the daemon uses) to find `outputDir`. Default: `~/.oni-vision/output/`.

To use a non-default output directory:
```json
{ "outputDir": "/path/to/your/output/dir" }
```

---

## Troubleshooting

**"oni-vision database not found"**
The daemon hasn't produced a `current.sqlite` yet. Run `npm start` in the oni-vision repo with ONI open, save the game once, then retry.

**Stale data**
`oni_freshness` returns the age in seconds. If it's large (>600 s), check that the daemon is running (`npm start`) and that ONI has autosave enabled.

**MCP server won't start**
Verify Node.js ≥ 22.5 is installed (`node --version`). The server uses `node:sqlite`, which is built in from 22.5.
