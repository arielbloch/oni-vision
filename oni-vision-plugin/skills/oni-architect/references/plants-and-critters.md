# Plants and critters

## Plants

Each plant has a temperature range, an atmosphere requirement, sometimes a light requirement, and a fertilization input. Outside the green range plants stop growing (or wilt and die at extremes).

| Plant          | Yield                  | Temp range (°C) | Atmo                              | Light    | Fertilizer                             |
|----------------|------------------------|-----------------|-----------------------------------|----------|----------------------------------------|
| Mealwood       | 1 mealice / 6 cycles   | 5 – 35          | Any except chlorine               | None     | 5 kg dirt / cycle                      |
| Bristle Blossom | 1 berry / 6 cycles    | 5 – 30          | Any except chlorine               | 10000+ lux required | 8.3 g/s water                |
| Sleet Wheat    | 3 grain / 18 cycles    | -15 – 5         | Cold biome                        | None     | 85 g/s water + 1.7 g/s phosphorite     |
| Pincha Pepper  | 1 pepper / 18 cycles   | 35 – 80         | Hot biome                         | None     | 1.7 g/s phosphorite + 50 g/s polluted water |
| Pincha Pepper Nut | seeds                | same            | same                              | None     | same                                   |
| Bog Bucket     | 1 bog jelly / 18 c.    | 5 – 35          | Polluted oxygen                   | None     | 70 g/s polluted water + 17 g/s slime   |
| Mushroom       | 1 mushroom / 12 c.     | 5 – 30          | CO2 / chlorine OK                 | None     | 70 g/s slime / 17 g/s phosphorite      |
| Dusk Cap       | 1 mushroom / 12 c.     | -30 – 30        | Hydrogen                          | None     | 17 g/s slime + 17 g/s phosphorite      |
| Saturn Critter Trap | trap                | 0 – 60          | Any                               | None     | 25 g/s phosphorite                     |
| Spindly Grubfruit Plant | grubfruit       | 5 – 35          | Any                               | 10000+ lux | 17 g/s sucrose                       |
| Arbor Tree     | 1 lumber / 12 cycles   | 5 – 35          | Any except chlorine               | None     | 70 g/s water + 0.5 kg/s dirt           |
| Wheezewort     | -                      | -50 – 95        | Any                               | None     | 1 kg phosphorite/cycle (cools surroundings) |

(Numbers from the Frosty Planet patch era. Verify against the wiki when in doubt.)

**Domestic vs wild:** wild plants produce ~25% the yield but require zero fertilizer. Wild Mealwood / Wild Sleet Wheat are surprisingly viable mid-game — let half the early-game ones grow wild.

**Wheezewort** is the best passive cooler in the game: each one absorbs ~12 kW of heat from the surrounding 1-tile radius, given hydrogen atmosphere boost. Stack them in coolant rooms.

## Critter ranching

Each critter species has:
- Lifespan (cycles)
- Calorie content (slaughter / butcher yield)
- Optional input (e.g. Drecko eats Mealwood for plastic)
- Output (egg, meat, materials)

**Reproduction rule:** in a 12-tile-or-larger room with ≥1 Auto-Wrangle station, ranching skill from a Rancher dupe lays eggs at +1 happiness/cycle. Cramped (>8 critters of same type per 12 tiles) blocks reproduction.

| Critter          | Lifespan | Diet                    | Output                              | Notes                          |
|------------------|----------|-------------------------|-------------------------------------|--------------------------------|
| Hatch            | 100 c.   | 140 g/c. raw mineral    | 70k kcal meat + 70 kg coal/cycle    | Workhorse. Stone Hatch eats igneous; Sage Hatch eats polluted dirt. |
| Smooth Hatch     | 100 c.   | 140 g/c. metal ore      | meat + 1 kg/c. refined metal        | Late game; auto-refines.       |
| Drecko           | 150 c.   | Mealwood / Bristle      | 100 g/c. reed fiber                 | Glossy variant produces plastic. |
| Pacu (Tropical)  | 100 c.   | algae                   | 70 g/c. eggshell + meat             | Best food/water ratio.        |
| Puft             | 100 c.   | polluted oxygen         | 200 g/c. slime                       | Slime farm.                   |
| Puft Prince      | 100 c.   | polluted oxygen         | bleach stone                         |                              |
| Slickster        | 100 c.   | CO2                     | 1 kg/c. petroleum or oil             | Late-game power.              |
| Pip              | 75 c.    | wild plant materials    | morale boost (DLC), mostly cosmetic |                              |
| Plug Slug (DLC)  | 200 c.   | refined metal           | 800 W power, 4-tile range           |                              |
| Beetle (DLC)     | 100 c.   | dasha saltvine          | sand + meat                          |                              |
| Sweetle          | 100 c.   | sucrose                 | sucrose / sucrose + sand            | Sugar Engine fuel.            |
| Cuddle Pip       | 100 c.   | -                       | morale buff to nearby dupes          | Ranching shrine pet.          |

**Egg yields per critter per cycle (rancher-tended):**

- Hatch: 1 egg / ~12 cycles → ~8 eggs over its lifetime
- Drecko: 1 egg / ~30 cycles → ~5 eggs
- Pacu: 1 egg / ~25 cycles → ~4 eggs

Net positive ranching loop (sustained without printing pod):
- 8 hatches in 96-tile room, fed automatically by Auto-Sweepers from a dropoff.
- 1 Rancher dupe with Improved Husbandry skill.
- Slaughter at age ~80 cycles for max meat yield before natural death.

## Common asks

**"Hatches or pacus for food?"** — Hatches are easier (eat any raw mineral, no liquid plumbing, no critter feeder). Pacus give better food (Surf 'n' Turf is 8000 kcal) but need water tanks, algae, and atmo-suit-tolerant rancher access. Do hatches first.

**"How do I get plastic before Drecko ranching?"** — Oil → Petroleum → Plastic in the polymer press. Or scrap-feed naturally born Glossy Drecko mod (none in vanilla). Realistic answer: get to oil and refine.

**"What plant should I farm at cycle X?"**
- Cycles 0–30: Wild Mealwood + Mush Bars.
- Cycles 30–80: Domestic Mealwood, Pincha Peppers if hot biome accessible.
- Cycles 80+: Sleet Wheat + Pincha → Pepper Bread is the gold standard.
- Bristle Blossom early if you have sun and water (overworld access).

**"How many wheezeworts do I need to cool my SPOM?"** — Hydrogen room around the SPOM, 4 wheezeworts is usually enough for 1 electrolyzer.
