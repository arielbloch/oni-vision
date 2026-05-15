# Geysers, vents, and volcanoes

ONI's geyser system is two layers: a **type** (steam, salt water, etc.) defines the output element, temperature, base output range, and dormancy/eruption durations; a **roll** (the `*_roll` columns in the SQLite) is a per-instance percentile against that type's range.

## The roll formula

Each geyser instance carries six rolls in `[0, 1]`:

- `rate_roll` — output rate within type's [min, max] kg/s during eruption
- `iteration_length_roll` — eruption seconds within type's range
- `iteration_percent_roll` — % of iteration spent erupting (rest is short cooldown)
- `year_length_roll` — total active+dormant cycle length in cycles
- `year_percent_roll` — % of year spent active (rest dormant)

To resolve a geyser to **average kg/s of output**:

```
inst_rate     = type.rate_min     + rate_roll          * (type.rate_max     - type.rate_min)
inst_iter_pct = type.iter_min     + iter_pct_roll      * (type.iter_max     - type.iter_min)
inst_year_pct = type.year_min     + year_pct_roll      * (type.year_max     - type.year_min)
average_kgs   = inst_rate * inst_iter_pct * inst_year_pct
```

Multiply by 600 for kg/cycle.

## Type table (vanilla + Spaced Out, base game)

`type_id` in the SQLite `geysers` table is a numeric **SimHash** integer (ONI's SDBM hash of the internal type name). Both the name and its hash are listed below so you can match live query results to this reference.

Output element is what comes out; output temperature is roughly fixed per type with small jitter. Base output ranges (kg/s during eruption) and dormancy params:

| type_id (name)        | SimHash integer | Output             | Rate range (kg/s)   | Out temp (°C) |
|-----------------------|-----------------|--------------------|---------------------|---------------|
| `steam`               | -899515856      | Cool Steam Vent water | 1.0 – 2.0       | 110           |
| `hot_steam`           | -2022709954     | Steam Vent steam   | 0.5 – 2.0           | 500           |
| `hot_water`           | 713477285       | Water Geyser       | 1.0 – 3.0           | 95            |
| `slush_water`         | 1280790313      | Cool Slush Geyser  | 1.0 – 2.0           | -10 (PW)      |
| `filthy_water`        | -413583980      | Polluted Water Vent | 2.0 – 6.0          | 30 (PW)       |
| `slush_salt_water`    | 1984991388      | Cool Salt Slush    | 1.0 – 2.0           | -10 (salt water) |
| `salt_water`          | 630638510       | Salt Water Geyser  | 1.0 – 4.0           | 95            |
| `oil_drip`            | -2131904254     | Leaky Oil Fissure  | 1.0 – 3.0           | 325           |
| `small_volcano`       | -471575302      | Minor Volcano      | 8.0 – 20.0 (magma)  | 1726 (magma)  |
| `big_volcano`         | -1592417549     | Volcano            | 18.0 – 40.0 (magma) | 1726          |
| `liquid_co2`          | 1482090435      | Carbon Dioxide Geyser | 0.2 – 0.4 (LCO2) | -55           |
| `hot_co2`             | -620712844      | Carbon Dioxide Vent | 0.07 – 0.14 (CO2) | 500           |
| `chlorine_gas`        | 1483840464      | Chlorine Gas Vent  | 0.04 – 0.14         | 60            |
| `hot_hydrogen`        | 1123505170      | Hydrogen Vent      | 0.07 – 0.14         | 500           |
| `hot_po2`             | -513313279      | Hot Polluted Oxygen Vent | 0.07 – 0.14  | 500           |
| `slimy_po2`           | 2128532496      | Infectious Polluted Oxygen | 0.05 – 0.14 | 60           |
| `methane`             | -841236436      | Natural Gas Geyser | 0.07 – 0.14         | 150           |
| `liquid_sulfur`       | -1765654948     | Liquid Sulfur Geyser (Frosty Planet) | 0.5 – 1.5 | 138 |
| `iron`                | 1306370440      | Iron Volcano       | 8 – 24 (iron magma) | 2526          |
| `copper`              | -1725038055     | Copper Volcano     | 8 – 24 (copper magma) | 2226        |
| `aluminum`            | 2108244480      | Aluminum Volcano   | 8 – 24 (aluminum magma) | 2226      |
| `gold`                | -279785280      | Gold Volcano       | 8 – 24 (gold magma) | 2326          |
| `cobalt`              | 108179667       | Cobalt Volcano     | 8 – 24 (cobalt magma) | 2226        |
| `tungsten`            | -1058835580     | Tungsten Volcano   | 8 – 24 (tungsten magma) | 4426      |
| `niobium`             | -1779895821     | Niobium Volcano    | 8 – 24 (niobium magma) | 4126       |

(Numbers are author's best recall as of the Frosty Planet patch; verify against [oxygennotincluded.fandom.com/wiki/Geyser](https://oxygennotincluded.fandom.com/wiki/Geyser) when in doubt. Klei occasionally rebalances.)

## Worth-taming heuristic

A geyser is "worth taming" if its **average kg/s × 600 sec/cycle** comfortably exceeds your colony's draw for that resource. Rough thresholds for a 12-dupe colony:

| Resource         | Want at least average kg/cycle |
|------------------|--------------------------------|
| Water            | 600 kg/cycle (1 kg/s)          |
| Polluted water   | 360 kg/cycle (0.6 kg/s)        |
| Steam            | 600 kg/cycle (for SPOM input)  |
| Hydrogen         | 50 kg/cycle (for hydrogen gen) |
| Natural gas      | 100 kg/cycle                   |
| Magma            | any (volcanos make metal)     |

A 30th-percentile cool steam vent (rate 1.3 kg/s, iter 50%, year 50%) outputs 1.3 × 0.5 × 0.5 = 0.325 kg/s average ≈ 195 kg/cycle. Marginal for water if you have 12 dupes; comfortable for 6.

## Tameability requirements

For each output type, the tame loop:

- **Water / hot water / salt water**: pump out, cool from 95 °C to <40 °C before consumption (steel pipes or radiant heat exchanger). Enclose to prevent overpressure (>5 kg/tile gas in the chamber stops eruption — feature, not a bug).
- **Cool steam**: condenses naturally. Just route to a holding tank; no cooling needed.
- **Volcanos**: build steam-turbine room over the magma drop chamber. The 1726 °C magma dumps heat into a steam pool; turbine harvests at 200 °C, condensate flows to a cooled output. Net positive power.
- **Hydrogen vent**: pump direct to hydrogen generators. Account for output temperature (500 °C) — pre-cool with radiant pipes through a coolant loop.
- **Liquid CO2**: rare and useful. Pump to a sealed reservoir and use for cold storage / refrigerator passive cooling.
- **Chlorine vent**: leave dormant if you don't need chlorine; route to slick sterilization room.

## Overpressure

All gas/liquid geysers stop erupting when surrounding pressure reaches a threshold. **For most gas vents: ~5 kg/tile.** For liquid vents: ~95 kg/tile. The standard fix is a vacuum chamber around the geyser with active pumping.

## Common asks

**"Is this geyser worth taming?"** — Compute average kg/s from the rolls (formula above). Compare to the threshold for that resource. Tell the user the average rate AND the worth/not-worth verdict; let them decide.

**"How do I tame [type]?"** — Pick from the list above. If ranked by complexity: cool steam (trivial) → liquid vents (medium, needs cooling and pressure-relief) → volcanos (advanced, needs steam-turbine setup) → hot gas vents (medium-advanced).

**"What's the rate for this geyser instance I see in my save?"** — `oni_geysers()` returns rolls; apply the formula above with the type's range table.
