#!/usr/bin/env node
// MCP server exposing typed read-only tools over the oni-watcher
// SQLite database. Speaks the standard MCP stdio transport — point
// any MCP-aware client at this script.
//
// Each tool re-opens the SQLite read-only per call. We could keep a
// persistent handle, but the parse pipeline atomically renames a fresh
// DB into place every save, so per-call open guarantees we always read
// the latest snapshot.

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
  saveMeta,
  freshness,
  dupes,
  geysers,
  resources,
  query,
} from "../lib/queries.js";

const TOOLS = [
  {
    name: "oni_save_meta",
    description: "Headline facts about the parsed save: base name, cycle count, dupe count, save version, and parsed_at staleness stamp.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "oni_freshness",
    description: "Seconds since the watcher last reparsed the save. Use this to decide whether to nudge the user to run the watcher.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "oni_dupes",
    description: "List duplicants with their key vitals. Sortable by stress (default), calories, stamina, bladder, breath, hp, decor, immune, body_temperature, or name.",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", description: "Sort key. Default: stress (descending)." },
        limit: { type: "integer", description: "Max rows to return. Default: 50." },
      },
    },
  },
  {
    name: "oni_geysers",
    description: "List every geyser/vent/volcano on the map with type, position, and roll percentiles. NOTE: rate_roll is a 0..1 percentile against the geyser type's base range, NOT actual kg/s.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "oni_resources",
    description: "Aggregate stored resources by element. `location` chooses where to look: 'storage' (containers only), 'world' (loose piles only), or 'both' (default).",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          enum: ["storage", "world", "both"],
          description: "Default: both.",
        },
        limit: { type: "integer", description: "Max rows. Default: 25." },
      },
    },
  },
  {
    name: "oni_query",
    description: "Run an arbitrary SELECT (or WITH … SELECT) against the SQLite DB. Multiple statements and any non-SELECT statement are rejected. Use the typed tools above when they cover the question — they're cheaper to compose.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT statement." },
        params: {
          type: "array",
          items: {},
          description: "Optional positional parameters bound to ? placeholders.",
        },
      },
      required: ["sql"],
    },
  },
];

function openDb() {
  const path = resolveDbPath();
  if (!existsSync(path)) {
    const err = new Error(
      `oni-watcher database not found at ${path}. ` +
      `Has the watcher run yet? Run 'npm start' in the oni-watcher repo, ` +
      `or 'npm run parse' for a one-shot.`
    );
    err.code = "ONI_DB_MISSING";
    throw err;
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

const server = new Server(
  { name: "oni-watcher", version: "0.1.0" },
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
      case "oni_dupes":
        payload = withDb((db) => dupes(db, args));
        break;
      case "oni_geysers":
        payload = withDb((db) => geysers(db));
        break;
      case "oni_resources":
        payload = withDb((db) => resources(db, args));
        break;
      case "oni_query":
        payload = withDb((db) => query(db, args.sql, args.params ?? []));
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
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
