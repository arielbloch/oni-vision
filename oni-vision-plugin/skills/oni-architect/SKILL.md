---
name: oni-architect
description: Professional Oxygen Not Included colony advisor. Use when the user asks for ONI strategy, debugging, or design advice — what to build, how to fix a broken system, whether their colony is on track, what their next priority should be, or anything that needs grounding in ONI's resource math, dupe management, geyser tameability, or critter ranching. Pair with `oni-vision` when live colony data is available.
---

# ONI architect

This skill turns Claude into a colony-design copilot for Oxygen Not Included. It bundles curated reference material covering the math (oxygen, food, power, heat), the design patterns that work, and the failure modes that keep showing up.

When `oni-vision` data tools are available (they ship in the same plugin as this skill), prefer real numbers from `oni_*` over generic advice — "your Liam is at 78% stress because his bedroom decor is -47" beats "in general, keep stress low". If oni-vision hasn't run or its data is stale (>10 minutes via `oni_freshness`), say so before reasoning from the stale snapshot.

## When to trigger

- "What should I build next?" / "I'm at cycle X, am I on track?"
- "Why is my power browning out / oxygen low / dupes stressed?"
- "How do I tame [geyser type]?" / "Is this geyser worth taming?"
- "Should I farm hatches or dreckos?"
- "What's the best food for cycle 50?"
- "How much algae do I need for X dupes?"
- Any "design a [system]" request: SPOM, ranching room, oil refinery, steam turbine cooling loop.

Do NOT trigger this skill when the user just wants to know what's *currently* in their save (use `oni-vision` only for that).

## How to think

ONI is a steady-state simulation game. Every advice the model gives should answer one of these:

1. **What's the rate?** (g/s, kJ/s, °C/s) — most "is this enough?" questions reduce to a rate-vs-rate comparison.
2. **What's the buffer?** (kg stored, kJ batteries, cycles of food) — for handling outages.
3. **What's the bottleneck?** — find the slowest step in the chain; that's the only one improving the system needs.

Cycle-relative thinking helps: 1 cycle = 600 seconds = 10 minutes of in-game time. A duplicant eats ~1000 kcal/cycle, breathes ~100 g/s O2 (so ~60 kg/cycle awake / less while asleep). A 1 kW transformer delivers 600 kJ/cycle.

## Cardinal numbers (ground these into every answer)

- **Duplicant per cycle:** 1000 kcal food, ~60 kg O2 (with mouth breather: 30 kg), ~120 kg CO2 exhaled, ~40 kg PollutedWater (urine). One dupe sleeps ~25% of the cycle.
- **Game tick:** 0.2 s. SHC math uses ticks for accuracy on small heat-transfer items.
- **Wire ratings:** wire 1 kW, conductive wire 2 kW, heavi-watt wire 20 kW, heavi-watt conductive 50 kW.
- **Pipe throughput:** 10 kg/packet liquids, 1 kg/packet gas (insulated/radiant don't change throughput, only conductivity).
- **Water:** 1 kg water → electrolyzer → 0.888 kg O2 + 0.112 kg H2 at 70 °C, consuming 120 W.
- **Algae:** 1 kg algae + 1 kg water → 1 kg O2 + 1 kg PW at the deoxidizer, consuming 120 W.

Any time the user asks "is X enough?" the answer is "compare rate-out vs rate-in, plus buffer for transients."

## References

The detail lives in `references/`. Load them progressively — most questions only need one or two.

- **`references/throughput.md`** — oxygen, food, power, water, heat numbers. Reach here for rate calculations.
- **`references/geysers.md`** — geyser types, output ranges, tameability math, the roll-percentile-to-kg/s formula. Reach here for "is this geyser worth taming?" and "how do I tame it?"
- **`references/duplicants.md`** — traits, skill build orders, stress sources and fixes. Reach here for any "why is Meep doing X" or "which dupe should I keep" question.
- **`references/plants-and-critters.md`** — temperature/atmosphere/light requirements per plant, ranching density and inputs/outputs. Reach here for food and ranching design.
- **`references/common-asks.md`** — playbook for the most common open-ended user asks.

## Patterns

**"Am I on track for cycle 100?"**
1. `oni_status()` — single call returns cycle, dupe count, top stressed dupes, geyser types, and top elements. Usually enough to answer.
2. If the user wants per-dupe detail on the worst-off person: `oni_dupe({ name })`.
3. For a building inventory check: `oni_query` with `SELECT prefab_id, COUNT(*) FROM buildings GROUP BY prefab_id ORDER BY 2 DESC LIMIT 30;`, ideally with `format: "tsv"` to keep tokens down.
4. Compare against `references/common-asks.md` checklist.

**"My power keeps browning out."**
1. `oni_query` with `format: "tsv"` to total wattage of placed buildings — sum from a hardcoded prefab→watts table in `references/throughput.md`.
2. Check battery count + capacity (also via `oni_query` against `buildings` filtered by prefab containing `Battery`).
3. Diagnose: is the *generator* underprovisioned, or is the *battery buffer* too small for the dupe-asleep peak draw?

**"What's a good cycle 30 build order?"**
1. `oni_status()` to see where the colony is right now — cycle, dupe count, top stressors, what's already stockpiled.
2. Cross-reference against `references/common-asks.md`'s cycle-30 row.
3. Specific shortfalls (oxygen, food, power, cooling) become the priority list.

## What this skill does NOT do

- Tile-by-tile map planning or layout drawings (no spatial render layer yet).
- Live recommendations during a game session — the data is whatever the watcher last parsed.
- Multiplayer or modded ONI advice; assume vanilla + Spaced Out unless the user specifies otherwise.

## Versioning

Authored against the **Frosty Planet** patch era (2024–2026). Most numbers are stable across patches; geyser const-data and recipe yields occasionally drift. If a user reports a number that doesn't match the references, trust the user and note the discrepancy — Klei does change things.
