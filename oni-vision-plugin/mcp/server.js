#!/usr/bin/env node
// MCP server exposing typed read-only tools over the oni-vision
// SQLite database. Speaks the standard MCP stdio transport — point
// any MCP-aware client at this script.
//
// Each tool re-opens the SQLite read-only per call. We could keep a
// persistent handle, but the parse pipeline atomically renames a fresh
// DB into place every save, so per-call open guarantees we always read
// the latest snapshot.
//
// Token efficiency: responses are compact JSON (no pretty-print) by
// default. Tabular tools accept `format: "tsv"` to return a TSV block
// instead, which is ~50% smaller than JSON-array-of-objects for the
// same data. See docs/mcp-optimization.md for the design.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  resolveDbPath,
  toTsv,
  saveMeta,
  freshness,
  dupes,
  dupeDetail,
  geysers,
  resources,
  food,
  query,
  status,
  schema,
  priorities,
} from "../lib/queries.js";

const TOOLS = [
  {
    name: "oni_save_meta",
    description: "Headline facts about the parsed save: base name, cycle count, dupe count, save version, parsed_at staleness stamp. Cheap; start here when in doubt.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "oni_freshness",
    description: "Seconds since the watcher last reparsed the save. Returns null fields if the watcher hasn't run yet. Use this to decide whether to nudge the user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "oni_status",
    description: "**Preferred entry point for general colony questions.** Returns a compact TSV-block snapshot covering: header facts (cycle, dupe count, base name), top stressed dupes, geyser type counts, top elements by mass, and parse staleness. Replaces 4-5 separate tool calls with one ~400-token response.",
    inputSchema: {
      type: "object",
      properties: {
        dupeLimit: { type: "integer", description: "How many top-stressed dupes to include. Default: 5." },
        geyserLimit: { type: "integer", description: "How many geyser types to include. Default: 10." },
        resourceLimit: { type: "integer", description: "How many top elements by mass to include. Default: 5." },
      },
    },
  },
  {
    name: "oni_schema",
    description: "List every queryable table and view with its column names. Compact (~200 tokens). Call once if you need to compose oni_query calls and don't already know the schema.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "oni_dupes",
    description: "List duplicants with their key vitals. Sortable by stress (default), calories, stamina, bladder, breath, hp, decor, immune, body_temperature, gender, current_role, target_role, or name. Use `fields` to project just the columns you need (saves tokens). Default limit is 12; bump it only if you have more dupes than that.",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", description: "Sort key. Default: stress (descending)." },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Project only these columns. Unknown names are silently dropped. Default: all columns.",
        },
        limit: { type: "integer", description: "Max rows. Default: 12." },
        format: { type: "string", enum: ["json", "tsv"], description: "Output format. Default: json. TSV is ~50% smaller for tabular returns." },
      },
    },
  },
  {
    name: "oni_dupe",
    description: "Everything we know about a single duplicant by name: vitals, traits, mastered skills, attribute levels, and active status effects. Replaces several oni_query calls; ~100-150 tokens.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Duplicant name. Case-sensitive." },
      },
      required: ["name"],
    },
  },
  {
    name: "oni_geysers",
    description: "List every geyser/vent/volcano on the map with type, position, and roll percentiles. NOTE: rate_roll is a 0..1 percentile against the geyser type's base range, NOT actual kg/s.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "tsv"], description: "Output format. Default: json." },
      },
    },
  },
  {
    name: "oni_resources",
    description: "Aggregate stored resources by element. `location` chooses where to look: 'storage' (containers only), 'world' (loose piles only), or 'both' (default). Totals ≥100 kg are reported as integers.",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          enum: ["storage", "world", "both"],
          description: "Default: both.",
        },
        limit: { type: "integer", description: "Max rows. Default: 10." },
        format: { type: "string", enum: ["json", "tsv"], description: "Output format. Default: json." },
      },
    },
  },
  {
    name: "oni_food",
    description: "Food items currently in colony storage, with display name, kcal per item, morale bonus, and stack count. JOINs the food_meta lookup table so results are human-readable. Unknown food items (new DLC) appear with null name/kcal/morale.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max food types to return. Default: 20." },
        format: { type: "string", enum: ["json", "tsv"], description: "Output format. Default: json." },
      },
    },
  },
  {
    name: "oni_priorities",
    description: "Chore group priorities for every dupe — only non-default entries (priority ≠ 3). Returns dupe_name, chore_group, label (UI name), and priority. Use this to understand each dupe's specialisation at a glance.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["json", "tsv"], description: "Output format. Default: json. Use tsv for large results." },
      },
    },
  },
  {
    name: "oni_query",
    description: "Run an arbitrary SELECT (or WITH … SELECT) against the SQLite DB. Multiple statements and any non-SELECT statement are rejected. Note: semicolons anywhere in the SQL (even inside string literals) are rejected — avoid `WHERE name = ';'`. Use the typed tools above when they cover the question — they're cheaper to compose and they pre-round numeric noise.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT statement." },
        params: {
          type: "array",
          items: {},
          description: "Optional positional parameters bound to ? placeholders.",
        },
        format: { type: "string", enum: ["json", "tsv"], description: "Output format. Default: json. Use tsv for large tabular returns to save tokens." },
      },
      required: ["sql"],
    },
  },
];

function openDb() {
  const path = resolveDbPath();
  if (!existsSync(path)) {
    throw new Error(
      `oni-vision database not found at ${path}. ` +
      `Has oni-vision run yet? Run 'npm start' in the oni-vision repo, ` +
      `or 'npm run parse' for a one-shot.`
    );
  }
  return new DatabaseSync(path, { readOnly: true });
}

function withDb(fn) {
  let db;
  try {
    db = openDb();
    return fn(db);
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Format `data` according to the caller's chosen format. JSON is compact
 * (no indentation) — the model parses both equally well, and pretty-print
 * costs ~30% more tokens. For tabular data with `format: "tsv"`, render
 * the TSV block directly. For non-tabular tools that always return a
 * pre-rendered string (oni_status, oni_schema), pass through unchanged.
 */
function renderPayload(data, format) {
  if (typeof data === "string") return data;
  if (format === "tsv" && Array.isArray(data)) return toTsv(data);
  return JSON.stringify(data);
}

const server = new Server(
  { name: "oni-vision", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let payload;
    switch (name) {
      case "oni_save_meta":
        payload = withDb((db) => saveMeta(db));
        break;
      case "oni_freshness":
        payload = withDb((db) => freshness(db));
        break;
      case "oni_status":
        payload = withDb((db) => status(db, args));
        break;
      case "oni_schema":
        payload = withDb((db) => schema(db));
        break;
      case "oni_dupes":
        payload = withDb((db) => dupes(db, args));
        break;
      case "oni_dupe":
        if (typeof args.name !== "string" || args.name === "") {
          throw new Error("oni_dupe requires a non-empty `name` argument.");
        }
        payload = withDb((db) => dupeDetail(db, args.name));
        if (payload == null) {
          throw new Error(`No duplicant named "${args.name}". Try oni_dupes() to list names.`);
        }
        break;
      case "oni_geysers":
        payload = withDb((db) => geysers(db));
        break;
      case "oni_resources":
        payload = withDb((db) => resources(db, args));
        break;
      case "oni_food":
        payload = withDb((db) => food(db, args));
        break;
      case "oni_priorities":
        payload = withDb((db) => priorities(db));
        break;
      case "oni_query":
        payload = withDb((db) => query(db, args.sql, args.params ?? []));
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: renderPayload(payload, args.format) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Error: ${err.message}` },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
