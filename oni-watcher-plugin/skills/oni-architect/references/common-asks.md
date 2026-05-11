# Common asks playbook

The user-facing patterns this skill is designed to handle well. For each, the playbook lists the data to pull, the math to do, and the verdict to deliver.

## "Am I on track for cycle X?"

**Data to pull (in order of preference):**
- `oni_status()` — single call, returns cycle / dupe count / top stressed dupes / geyser types / top elements / parse staleness in one TSV-block. **This is enough for ~80% of "am I ok" questions.**
- `oni_dupe({ name })` for the worst-stressed individual if the user wants detail.
- `oni_query` with `SELECT prefab_id, COUNT(*) FROM buildings GROUP BY prefab_id ORDER BY 2 DESC LIMIT 30;` (use `format: "tsv"` to halve the response size) to inspect what's been built.

**Cycle-by-cycle benchmarks (rough, 3-dupe start):**

| Cycle | Should have                                                       |
|-------|-------------------------------------------------------------------|
| 10    | Algae Terrarium × 3, Microbe Musher, beds, manual generator, latrine. |
| 30    | First Algae Deoxidizer, ~5–6 dupes, basic plumbing, mealwood farm, decor in mess hall. |
| 50    | SPOM on the way (Electrolyzer + 2 H2 generators), atmo suit dock for dirty work. |
| 100   | Coal generators or first SPOM. ~8 dupes. Mush Bars retired in favor of cooked food. |
| 150   | Steel mill running. First aquatuner-cooled refrigerator. Industrial brick area separated. |
| 200   | Petroleum generator. 10–12 dupes. Bristle berry / pepper bread food chain. |
| 300+  | Space access (rocket / portal). Geyser taming for water/oxygen autonomy. |

**Verdict shape:**
> "You're at cycle 312 with 12 dupes. Stockpile is healthy but Liam's at 78% stress — that's the headline. Open his info panel and check decor; my guess is his bedroom is still shared. Power buffer looks fine; food ≈8 cycles, you'll want to add 2 more pepper plants."

## "Why is my power browning out?"

**Data to pull:**
- `oni_query` → wattage of running buildings (sum prefab_id → known watts).
- `oni_query` → battery count and capacity.

**Diagnosis tree:**
1. Total continuous wattage > total continuous generation? → Underprovisioned. Add a generator stage (coal → petroleum → solar/SPOM).
2. Continuous fine but spike loads (aquatuner, super computer, atmo suit dock) cause brownouts? → Add Smart Batteries closer to the spike loads.
3. Wires overheating? → Check load on wire segment. Promote to conductive or heavi-watt.
4. Same circuit running heavi-watt loads through a small transformer? → Move heavi-watt loads off the transformer or add a second one in parallel.

**Verdict shape:**
> "Your continuous generation is 2.4 kW from coal. Your continuous draw including 2 atmo dock wars + super computer is 2.8 kW. You're 400 W short. Two paths: add a second coal generator (cheap), or skip ahead to a SPOM (long-term self-sufficient). Buffer-wise, your 5 batteries are fine if you fix generation."

## "What should I build next?"

**Data to pull:**
- `oni_save_meta()` and `oni_query` for current building counts.
- `oni_resources` → are you bottlenecked on a specific resource?

**Triage rule of thumb (most-broken-first):**

1. **Oxygen** — if stockpile of oxygen is < 1 cycle of demand, fix this *first*. Algae Deoxidizer if you're early; SPOM if you have the iron and water.
2. **Food** — if cycle buffer < 5 cycles, build more plants of whatever's growing and improve decor for morale-cooked meals.
3. **Power** — if browning out, see playbook above.
4. **Stress / Morale** — Mess Hall, Bedrooms, Recreation Room.
5. **Heat** — if building temps are creeping above 35 °C, plan cooling: separate industrial brick, atmo suits, eventually aquatuner + steam turbine.
6. **Research** — by the time the immediate three are stable, run research; gating new tech takes hours of game time.

## "How do I tame [geyser]?"

See `references/geysers.md`. Compute the average kg/s, compare to the table threshold, and walk the user through the tame-loop architecture for that type.

## "Should I farm hatches or dreckos?"

See `references/plants-and-critters.md`. Short answer: **hatches first** (simpler infrastructure, no plumbing), dreckos later when you need plastic.

## "How many SPOMs do I need?"

A SPOM (1 Electrolyzer + 2 Hydrogen Generators) outputs 888 g/s O2 = 533 kg/cycle. A dupe consumes ~60 kg/cycle of O2 awake. So **1 SPOM ≈ 9 dupes comfortable, ≈ 6 with healthy buffer**.

## "What's the best petroleum generator setup?"

- 1 Oil Refinery (refining 5 kg/s crude oil → 5 kg/s petroleum).
- 4 Petroleum Generators consuming 2 kg/s petroleum each → 8 kW production.
- Output gases: 100 g/s polluted oxygen + 80 g/s CO2 + 30 g/s natural gas. Pipe carefully.
- Heat output requires aquatuner+steam-turbine cooling once you scale up.

## "I have a [planet/asteroid] in Spaced Out, what do I send?"

For Outer / Niobium / Folia / etc., the rule is: 1 dupe + 1 atmo suit + 1 oxylite refresh = 8–10 cycles of mining before resupply. Pack 1 ladder + 4 tiles + 2 oxylite per planetoid hop. Bring back the rare resource (niobium, fullerene, etc.) at minimum 100 kg per round trip.

## "Spaced Out specific: when do I leave the starting planetoid?"

Around cycle 80–120. Triggers: you have at least 3 dupes able to wear atmo suits, a research module that's unlocked Module Refinement, and a Steam Engine + 800 kg fuel buffer. Earlier is risky; later is wasting potential.

## How to deliver advice

- Lead with the verdict, then the math.
- Give the user 2–3 paths (cheap-now / medium / proper) and the cost of each.
- If `oni-watcher` data is available, ground every statement in actual numbers from the user's save. Don't say "your stress might be high" if you can say "Liam is at 78%, Jorge at 64%".
- Never invent numbers. If you don't know the exact watts, say "around" or fall through to the wiki link.
