# MCP token-usage optimization plan

A focused plan to reduce the token footprint of the `oni-vision-plugin` MCP tools without making them harder for the model (or the user) to use. The current tools are correct and well-documented; the issue is they return more bytes than the model usually needs to answer the question.

## Problem statement

A representative response shape today, for `oni_dupes()` on a 12-dupe colony:

```json
[
  {
    "name": "Meep",
    "gender": "MALE",
    "current_role": "Digger",
    "target_role": "MasterDigger",
    "stress": 12.5,
    "calories": 4000,
    "stamina": 80,
    "bladder": 30,
    "breath": 100,
    "hp": 100,
    "decor": 0,
    "immune": 100,
    "body_temperature": 309.15
  },
  …11 more rows
]
```

That's ~150 tokens per dupe → ~1800 tokens for the full table. Most of the time the user asked "how's stress?", and only `name`+`stress`+`current_role` were needed. We're spending **5–10×** the tokens we should be.

Three distinct sources of waste:

1. **Verbose serialization.** Pretty-printed JSON (2-space indent) is ~30% more tokens than compact JSON. JSON itself is ~50% more tokens than TSV for tabular data because every row repeats every key.
2. **Over-fetching columns.** The tool returns every projected field regardless of what the question needs.
3. **Over-fetching rows.** Defaults are `limit: 50` for dupes and `limit: 25` for resources. Most questions are answered by the top 5.

A fourth one shows up at a higher level:

4. **Composition.** "Give me a colony status overview" currently means the model makes 3-4 tool calls (`oni_save_meta`, `oni_freshness`, `oni_dupes`, `oni_geysers`, `oni_resources`) and assembles the answer. Each tool reopens the SQLite, each response carries its own envelope. One pre-aggregated tool would be cheaper.

## Goals

- Cut the token cost of the median response by **at least 3×** for `oni_dupes`, `oni_resources`, `oni_geysers`.
- Keep all existing tool names and parameter names working (no breaking changes for already-running clients).
- Add zero net code complexity from the model's perspective — fewer roundtrips, not more.
- Keep the security envelope unchanged: read-only, SELECT-only `oni_query`, sort-key allowlist on `oni_dupes`.

## Strategies

### A. Compact serialization by default

Switch the MCP-layer `JSON.stringify(payload, null, 2)` to `JSON.stringify(payload)`. The model parses both equally well; the human reading the trace can pretty-print downstream if needed. **One-line change. ~30% token reduction across every tool response.**

### B. `format` parameter on tabular tools

Accept `format: "json" | "tsv"` on `oni_dupes`, `oni_geysers`, `oni_resources`, `oni_query`. Default stays `json` for back-compat. `tsv` returns header line + one row per line:

```
name	stress	current_role
Meep	12.5	Digger
Stinky	4.0	Chef
…
```

Tab-separated avoids quoting/escaping for the values we actually return (no string contains tabs or newlines). Header on line 1 keeps it self-documenting. **~40–50% smaller than JSON for tabular returns**, additive on top of (A).

### C. `fields` projection on `oni_dupes`

Accept `fields: ["name", "stress"]` to limit the projection. Reuse the existing sort-key allowlist (`stress`, `calories`, `stamina`, `bladder`, `breath`, `hp`, `decor`, `immune`, `body_temperature`, `name`, plus `gender`, `current_role`, `target_role`). Unknown field names are silently dropped (don't surface SQL errors to the model).

Default `fields`, when omitted, is the current full set — back-compat. Models that know the parameter can shrink:

```
oni_dupes({ fields: ["name", "stress"], sort: "stress", limit: 8 })
```

→ ~30 tokens of data, vs ~1800 today. **Order-of-magnitude reduction for the most-called tool.**

### D. Tighter default limits

- `oni_dupes` default `limit`: 50 → **12** (almost always enough; max colony size is around 16, the model will ask for more if needed).
- `oni_resources` default `limit`: 25 → **10**.
- `oni_geysers` keeps no limit (returns all — typically <20 geysers per save).

These are defaults; the model can override.

### E. `oni_status` — pre-aggregated single-call status

A new tool that returns everything the model usually needs to "summarize the colony" in one shot, as a compact TSV-like block:

```
base_name=Cosmic Conundrum
cycle=312
duplicants=12
critters=4
geysers=7
buildings=184
parsed_at_age_seconds=23

# top 5 dupes by stress
name	stress	role
Meep	76.0	Digger
Stinky	32.0	Chef
Liam	18.0	Operator
Mae	12.0	Researcher
Jorge	8.0	Builder

# geyser types
steam	2
chlorine_vent	1
…

# top 5 elements by mass
Algae	12400 kg	in 8 places
Water	8250 kg	in 3 places
…
```

This replaces 4-5 tool calls with one ~400-token response. The format is hand-readable for humans tailing the MCP log, and the model parses key=value + named TSV sections without trouble.

### F. `oni_schema` — schema introspection

A new tool returning the schema in compact form so the model doesn't need a copy of `CLAUDE.md` in its system prompt to compose `oni_query` calls. Output shape:

```
duplicants: game_object_id, name, gender, current_role, target_role, stress, calories, stamina, bladder, breath, hp, decor, immune, body_temperature, ...
duplicant_traits: duplicant_id, trait
…
v_buildings_by_prefab: prefab_id, count
```

One call, ~200 tokens, replaces dozens of lines in skills/oni-vision/SKILL.md. Idempotent and safe to call once at the start of a session.

### G. `oni_dupe` — single-dupe deep dive

For "tell me everything about Meep" — currently the model has to call `oni_dupes` (filter by name), then `oni_query` for traits, `oni_query` for skills, etc. A typed `oni_dupe({ name })` returns one row that includes the dupe's vitals + traits[] + skills[] + active effects[] + attribute levels. ~100 tokens. Replaces 4 calls and an envelope per call.

### H. Numeric tightening in `oni_resources` totals

`total_units` currently returns `ROUND(SUM(units), 2)`. For mass aggregates we don't need 2 decimals — `12423.84` and `12424` look the same to a player. Drop to integers when total >= 100 kg. Saves a few tokens per row.

## Non-goals

- **Don't switch to a binary or msgpack-style serialization.** MCP is text-only over stdio for now; even if it weren't, JSON/TSV are zero-context-overhead for the model.
- **Don't introduce a query DSL.** `oni_query` already gives full SQL. We just want better defaults for the common 80%.
- **Don't break existing callers.** Every change is additive: new params are optional with sensible defaults, new tools are new names.

## Per-tool change matrix

| Tool             | Compact JSON | format param | fields param | New default limit | Other |
|------------------|--------------|--------------|--------------|-------------------|-------|
| `oni_save_meta`  | ✓            | —            | —            | —                 | —     |
| `oni_freshness`  | ✓            | —            | —            | —                 | —     |
| `oni_dupes`      | ✓            | ✓            | ✓            | 50 → 12           | —     |
| `oni_geysers`    | ✓            | ✓            | —            | (unchanged)       | —     |
| `oni_resources`  | ✓            | ✓            | —            | 25 → 10           | int totals when ≥100 kg |
| `oni_query`      | ✓            | ✓            | —            | (unchanged)       | —     |
| `oni_food`       | (new)        | ✓            | —            | 20                | joins food_meta lookup table |
| `oni_status`     | (new)        | (TSV-text)   | —            | —                 | one-call aggregate |
| `oni_schema`     | (new)        | (TSV-text)   | —            | —                 | replaces SKILL crib |
| `oni_dupe`       | (new)        | ✓            | —            | —                 | one-dupe deep dive |

## Implementation order

1. Compact JSON in `mcp/server.js` content-text serialization. Lowest-risk, biggest blanket win.
2. Add `format: "tsv"` support to `dupes`, `geysers`, `resources`, `query` in `lib/queries.js`. Pure formatting layer; doesn't change data correctness.
3. Add `fields` projection to `dupes`.
4. Lower default limits on `dupes` and `resources`.
5. Integer-round large totals in `resources`.
6. Implement `oni_status`, `oni_schema`, `oni_dupe`.
7. Update `skills/oni-vision/SKILL.md` to point at the new tools and params.
8. Tests for every new code path: format=tsv output shape, fields projection, oni_status content, oni_schema list, oni_dupe deep dive.

Each step is independent and could ship as its own commit.

## Measurement

For each change, document a rough before/after token count on a representative call. Use approximate counts (length / 4) since exact tokenization depends on the model. The README's existing "Quick status" example is a fine yardstick.

Order-of-magnitude targets:

- `oni_dupes` "stress sweep" with `fields: ["name","stress","current_role"]`: 1800 → 150 tokens (12×).
- `oni_resources` top-5 with tighter limit + int totals: 600 → 80 tokens (7×).
- "Summarize my colony" via `oni_status` vs four separate calls: 2500 → 400 tokens (6×).

## Security considerations

- `fields` allowlist is the same allowlist as `sort` — column names can't be bound parameters in SQLite, so we interpolate after validation. Unknown fields are dropped, not surfaced as errors (and not concatenated into SQL).
- `format` is matched against a fixed enum `["json", "tsv"]` before any output happens; an adversarial value can't cause format-string injection.
- `oni_schema` reads `sqlite_master` and the convenience-view list — no user input touches SQL.
- `oni_status`'s TSV-block format never includes user-controlled data outside cell boundaries; tabs and newlines aren't possible in dupe names, geyser type_ids, or element_ids (the parser doesn't emit them).
- All existing safeguards stay in place: read-only DB handle, SELECT-only `oni_query`, multi-statement rejection.

## Documentation impact

- `skills/oni-vision/SKILL.md`: add a "minimal-token patterns" section near the top. Show the `fields` projection idiom for `oni_dupes`, and `oni_status` as the default for general colony questions.
- `CLAUDE.md` (parent project): unchanged — it's already the lightweight raw-SQL path.
- `oni-vision-plugin/README.md`: add the three new tools to the tools table, plus a note about `format: "tsv"` on the existing tools.
