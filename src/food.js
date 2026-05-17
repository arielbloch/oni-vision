// Food metadata: prefab ID → display name, kcal per item, morale bonus.
//
// Morale values match the game's Food Morale tooltip (+N / -N).
// kcal is per item (not per serving) in the game's internal unit — 1000 kcal
// is roughly 1 meal for one dupe.
//
// This array is written into the `foods` table in current.sqlite during
// buildOutputs(), making it available to both the web frontend and MCP plugin
// via SQL without any hardcoded JS on the consumer side.

/** @type {Array<{prefab_id: string, name: string, kcal: number, morale: number}>} */
export const FOOD_META = [
  { prefab_id: "MushBar",          name: "Mush Bar",         kcal: 1000, morale: -1 },
  { prefab_id: "MushFry",          name: "Mush Fry",          kcal: 1200, morale:  0 },
  { prefab_id: "FriedMushroom",    name: "Fried Mushroom",    kcal: 1600, morale:  1 },
  { prefab_id: "BasicForagePlant", name: "Mealwood Shoot",    kcal:  600, morale:  0 },
  { prefab_id: "Mushroom",         name: "Raw Mushroom",      kcal:  600, morale:  0 },
  { prefab_id: "RawEgg",           name: "Raw Egg",           kcal:  700, morale: -1 },
  { prefab_id: "CookedEgg",        name: "Cooked Egg",        kcal: 2000, morale:  2 },
  { prefab_id: "Meat",             name: "Raw Meat",          kcal: 1600, morale: -1 },
  { prefab_id: "CookedMeat",       name: "Cooked Meat",       kcal: 2400, morale:  2 },
  { prefab_id: "PlantMeat",        name: "Plant Meat",        kcal: 1600, morale:  2 },
  { prefab_id: "Tofu",             name: "Tofu",              kcal: 1600, morale:  2 },
  { prefab_id: "MeatPlanks",       name: "Jerky",             kcal: 4800, morale:  4 },
  { prefab_id: "ColdWheatBread",   name: "Cold Wheat Bread",  kcal: 1600, morale:  2 },
  { prefab_id: "PrickleFig",       name: "Prickle Muffin",    kcal: 1200, morale:  2 },
  { prefab_id: "SpiceBread",       name: "Spice Bread",       kcal: 2400, morale:  4 },
  { prefab_id: "PepperbreadMeal",  name: "Pepper Bread",      kcal: 3200, morale:  4 },
  { prefab_id: "SpicyTofu",        name: "Spicy Tofu",        kcal: 3200, morale:  4 },
  { prefab_id: "MushroomWrap",     name: "Mushroom Wrap",     kcal: 4000, morale:  4 },
  { prefab_id: "WormBasicFood",    name: "Stuffed Berry",     kcal: 4000, morale:  4 },
  { prefab_id: "Burger",           name: "Barbecue",          kcal: 4000, morale:  4 },
  { prefab_id: "SurfAndTurf",      name: "Surf 'n' Turf",     kcal: 6000, morale:  8 },
  { prefab_id: "FruitCake",        name: "Frost Burger",      kcal: 6000, morale:  8 },
];
