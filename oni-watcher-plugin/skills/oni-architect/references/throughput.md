# Throughput reference

Rates and recipes for the systems that keep showing up in colony design questions. All numbers are vanilla / Spaced Out base values; they don't account for skill bonuses, traits, or +duplicant scaling unless noted.

## Oxygen

| Source                   | Rate                                  | Inputs                          | Power     |
|--------------------------|---------------------------------------|---------------------------------|-----------|
| Algae Terrarium          | 40 g/s O2                             | 30 g/s algae + 300 g/s water    | 0 W       |
| Algae Deoxidizer         | 500 g/s O2                            | 550 g/s algae + 1 kg/s water    | 120 W     |
| Electrolyzer             | 888 g/s O2 + 112 g/s H2               | 1 kg/s water                    | 120 W (overheats above 75 °C input water; outputs 70 °C) |
| Rust Deoxidizer          | 570 g/s O2 + 200 g/s chlorine         | 1 kg/s rust + 0.2 kg/s salt     | 240 W     |

**Per-dupe O2 demand:** ~100 g/s while breathing (≈60 kg/cycle). Mouth Breather trait halves it. Sleeping dupes don't breathe.

So 1 Electrolyzer covers ~9 dupes outright; with one ~6 dupes is comfortable because you want a buffer.

## Food

Calorie demand is **1000 kcal/cycle/dupe**. Multiply by dupes; double-check against `oni_query` for the actual number.

| Food                | kcal/unit  | Source                                           |
|---------------------|------------|--------------------------------------------------|
| Mush Bar            | 800        | Microbe Musher (cheap, low quality of life)     |
| Liceloaf            | 1700       | Mush bar + meal lice in Musher                   |
| Mealwood (Mealice)  | 600/plant  | Mealwood plant (1.7 g/s)                         |
| Bristle Berry       | 1600       | Bristle Blossom (slow grower, sunlight required) |
| Pincha Pepper       | 600        | …after cooking → Pepper Bread                    |
| Pepper Bread        | 4000       | 1 sleet wheat + 3 peppers, Electric Grill        |
| Frost Bun           | 1700       | Sleet wheat, Electric Grill                      |
| BBQ                 | 4000       | Cooked hatch meat, Electric Grill                |
| Surf 'n' Turf       | 8000       | Cooked pacu fillet + cooked omelette             |

A 12-dupe colony needs ≈12,000 kcal/cycle. Pepper Bread × 3 dupe-cycles per loaf — a dozen plants is plenty.

## Power

Common building wattages:

| Building              | Watts |
|-----------------------|-------|
| Algae Deoxidizer      | 120   |
| Electrolyzer          | 120   |
| Hydrogen Generator    | -800 (production) consuming 100 g/s H2 |
| Coal Generator        | -600 production, 1 kg/s coal           |
| Petroleum Generator   | -2000 production, 2 kg/s petroleum     |
| Solar Panel           | -380 max                              |
| Manual Generator      | -400 (with 1 dupe)                    |
| Steam Turbine         | -850 max, consuming 2 kg/s steam      |
| Microbe Musher        | 240   |
| Electric Grill        | 240   |
| Atmo Suit Dock        | 480   |
| Liquid Pump           | 240   |
| Gas Pump              | 240   |
| Liquid Vent           | 0 (passive)                            |
| Aquatuner             | 1200  |
| Thermo Regulator      | 240   |
| Research Station      | 60    |
| Super Computer        | 1200  |

**Wire ratings:**

| Wire                        | Max load |
|-----------------------------|----------|
| Wire (vanilla)              | 1000 W   |
| Conductive Wire             | 2000 W   |
| Heavi-Watt Wire             | 20,000 W |
| Heavi-Watt Conductive Wire  | 50,000 W |

**Transformer outputs:** Small Power Transformer 1 kW, Large Power Transformer 4 kW. Use them to wall off circuits so a heavy load can't overload your light wires.

**Battery shape:** Smart Battery 20 kJ, Jumbo Battery 40 kJ. Wires bridge through batteries. Ratio: enough batteries to cover the dupe-asleep / dupe-awake delta plus the burst from any aquatuner / centrifuge.

## Water and recipes

| Process                          | Inputs                      | Outputs                    |
|----------------------------------|-----------------------------|----------------------------|
| Water Sieve                      | 5 kg/s polluted water + 1 kg filtration medium / 320 kg PW | 5 kg/s clean water |
| Desalinator                      | 5 kg/s salt water           | 4.79 kg/s water + 0.21 kg/s salt |
| Carbon Skimmer                   | 1 kg/s water + 0.3 kg/s CO2 | 1.3 kg/s polluted water    |
| Ice Maker                        | 1 kg/s water                | 1 kg/s ice (–10 °C)        |
| Steam Turbine condensate         | 2 kg/s steam (>125 °C)      | 2 kg/s 95 °C water + 850 W |

**SPOM (Self-Powered Oxygen Module):** 1 Electrolyzer + 2 Hydrogen Generators + 2 Gas Pumps. Net positive ~600 W on hydrogen alone. Standard cycle 30 build.

## Heat math

**Specific Heat Capacity (kJ/kg/K)** for materials you'll see in problems:

| Material        | SHC   |
|-----------------|-------|
| Granite         | 0.79  |
| Igneous Rock    | 1.00  |
| Sandstone       | 0.80  |
| Sedimentary     | 0.80  |
| Iron Ore        | 0.45  |
| Copper Ore      | 0.39  |
| Steel           | 0.49  |
| Refined Metal   | 0.45  |
| Water           | 4.179 |
| Polluted Water  | 4.179 |
| Salt Water      | 4.179 |
| Crude Oil       | 1.69  |
| Petroleum       | 1.76  |
| Hydrogen        | 2.4   |
| Oxygen          | 1.005 |
| Steam           | 4.179 |
| CO2             | 0.846 |

**Why igneous rock is your friend:** twice the SHC of granite for the same weight, so it absorbs heat without heating up. Build heat-sensitive things (electrolyzers, refrigerators) on igneous rock tiles.

**Aquatuner numbers:** moves 14 °C off 10 kg/s of any liquid (560 kJ/s of heat dumped per cycle). Self-heats by 12.6 °C per cycle in vacuum if not cooled. Pair with a steam turbine: aquatuner + steam turbine in steam-room loop is net cooling without external power input above base ambient.

**Steam turbine setpoints:** outputs 95 °C water, accepts steam ≥125 °C. The turbine itself overheats above 200 °C. Run the steam room around 175 °C for stability.

## Quick formulas

```
oxygen_safety = O2_production / (dupes * 100 g/s)         # want >= 1.5 for buffer
food_cycles_buffered = stored_kcal / (dupes * 1000)       # want >= 10 mid-game
power_safety = continuous_generation / peak_load          # want >= 1.2

# Cooling load needed to hold a room at temp T against heat input H_watts:
cooling_kg_per_s = H_watts / (4.179 * dT)   # for water-based loop, dT=14 if aquatuner
```

When the user gives you numbers, plug them in and report both the answer and the safety multiplier. They want to know "am I fine" not "what's the raw number".
