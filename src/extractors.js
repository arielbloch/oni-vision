// Walks a parsed SaveGame and produces flat row arrays for SQLite insertion.
//
// The save's gameObjects field is an array of GameObjectGroup:
//   { name: prefabId, gameObjects: GameObject[] }
// Each GameObject has { position, rotation, scale, folder, behaviors }.
// Each behavior has { name, templateData?, extraData?, extraRaw? }.
//
// We:
//   * Always emit a row per game object into `gameObjects`.
//   * Always emit a row per behavior into `behaviors` (templateData/extraData
//     stringified to JSON), so Claude can fall back to raw JSON for anything
//     we don't have a typed extractor for.
//   * Specialized extractors lift the most-asked-about fields into typed
//     tables: duplicants + their traits/skills/attributes/effects/amounts,
//     buildings + storage_contents, geysers, critters.

const PREFAB_DUPLICANT = "Minion";
const BEHAVIOR_KPREFAB = "KPrefabID";
const BEHAVIOR_MINION_IDENTITY = "MinionIdentity";
const BEHAVIOR_MINION_RESUME = "MinionResume";
const BEHAVIOR_MINION_MODIFIERS = "MinionModifiers";
const BEHAVIOR_MODIFIERS = "Klei.AI.Modifiers";
const BEHAVIOR_ATTR_LEVELS = "Klei.AI.AttributeLevels";
const BEHAVIOR_TRAITS = "Klei.AI.Traits";
const BEHAVIOR_EFFECTS = "Klei.AI.Effects";
const BEHAVIOR_PRIMARY_ELEMENT = "PrimaryElement";
const BEHAVIOR_STORAGE = "Storage";
const BEHAVIOR_GEYSER = "Geyser";
const BEHAVIOR_HEALTH = "Health";

/** Pick the first behavior with a matching name; returns undefined if absent. */
function findBehavior(go, name) {
  if (!go || !Array.isArray(go.behaviors)) return undefined;
  return go.behaviors.find((b) => b.name === name);
}

function getInstanceId(go) {
  const b = findBehavior(go, BEHAVIOR_KPREFAB);
  const id = b?.templateData?.InstanceID;
  return typeof id === "number" ? id : null;
}

/** Critter detection: prefabs in the known critter list. */
const CRITTER_PREFABS = new Set([
  "Hatch", "HatchHard", "HatchVeggie", "HatchEgg", "HatchHardEgg", "HatchVeggieEgg",
  "Drecko", "DreckoBaby", "DreckoEgg", "DreckoPlastic", "DreckoPlasticEgg",
  "Pacu", "PacuBaby", "PacuEgg", "PacuTropical", "PacuTropicalBaby", "PacuTropicalEgg",
  "PacuCleaner", "PacuCleanerBaby",
  "Puft", "PuftBaby", "PuftEgg", "PuftAlpha",
  "Oilfloater", "OilfloaterDecor", "OilfloaterHighTemp",
  "ColdBreather", "ColdBreatherSeed",
  "Glom", "LightBug",
]);

/** Geysers all start with this prefix in ONI. */
function isGeyserPrefab(name) {
  return typeof name === "string" && name.startsWith("GeyserGeneric");
}

/** Stringify safely — circular references replaced with [Circular]. */
function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  });
}

export function extractAll(save) {
  const tables = {
    save_meta: [],
    object_groups: [],
    game_objects: [],
    behaviors: [],
    duplicants: [],
    duplicant_traits: [],
    duplicant_skills: [],
    duplicant_attributes: [],
    duplicant_effects: [],
    duplicant_amounts: [],
    buildings: [],
    storage_contents: [],
    geysers: [],
    critters: [],
  };

  // Save metadata as key/value rows.
  const info = save.header?.gameInfo ?? {};
  for (const [key, value] of Object.entries(info)) {
    tables.save_meta.push({
      key,
      value: typeof value === "object" ? safeStringify(value) : String(value),
    });
  }
  tables.save_meta.push({
    key: "saveVersion",
    value: `${save.version?.major}.${save.version?.minor}`,
  });
  tables.save_meta.push({
    key: "buildVersion",
    value: String(save.header?.buildVersion ?? ""),
  });

  // Walk groups.
  let goId = 0;
  let behaviorId = 0;
  for (const group of save.gameObjects ?? []) {
    const prefabId = group.name;
    tables.object_groups.push({
      prefab_id: prefabId,
      count: group.gameObjects?.length ?? 0,
    });

    for (const go of group.gameObjects ?? []) {
      goId++;
      const instanceId = getInstanceId(go);
      tables.game_objects.push({
        id: goId,
        instance_id: instanceId,
        prefab_id: prefabId,
        position_x: go.position?.x ?? null,
        position_y: go.position?.y ?? null,
        position_z: go.position?.z ?? null,
        scale_x: go.scale?.x ?? null,
        scale_y: go.scale?.y ?? null,
        folder: go.folder ?? null,
      });

      for (const behavior of go.behaviors ?? []) {
        behaviorId++;
        tables.behaviors.push({
          id: behaviorId,
          game_object_id: goId,
          name: behavior.name,
          template_data:
            behavior.templateData === undefined
              ? null
              : safeStringify(behavior.templateData),
          extra_data:
            behavior.extraData === undefined
              ? null
              : safeStringify(behavior.extraData),
        });
      }

      // Specialized extraction.
      if (prefabId === PREFAB_DUPLICANT) {
        extractDuplicant(go, goId, instanceId, tables);
      } else if (isGeyserPrefab(prefabId)) {
        extractGeyser(go, goId, prefabId, tables);
      } else if (CRITTER_PREFABS.has(prefabId)) {
        extractCritter(go, goId, prefabId, tables);
      } else {
        // Anything else with a Storage or PrimaryElement+building shape.
        extractBuildingMaybe(go, goId, prefabId, tables);
      }
    }
  }

  return tables;
}

function extractDuplicant(go, goId, instanceId, tables) {
  const identity = findBehavior(go, BEHAVIOR_MINION_IDENTITY)?.templateData ?? {};
  const resume = findBehavior(go, BEHAVIOR_MINION_RESUME)?.templateData ?? {};
  const minionMods = findBehavior(go, BEHAVIOR_MINION_MODIFIERS)?.extraData;
  const amounts = minionMods?.amounts ?? [];

  // Pull common amounts by name. Names are not localized — they're internal IDs.
  const amountByName = {};
  for (const a of amounts) {
    amountByName[a.name] = a?.value?.value ?? null;
  }

  tables.duplicants.push({
    game_object_id: goId,
    instance_id: instanceId,
    name: identity.name ?? null,
    gender: identity.gender ?? null,
    arrival_time: identity.arrivalTime ?? null,
    voice_idx: identity.voiceIdx ?? null,
    current_role: resume.currentRole ?? null,
    target_role: resume.targetRole ?? null,
    total_experience: resume.totalExperienceGained ?? null,
    position_x: go.position?.x ?? null,
    position_y: go.position?.y ?? null,
    stress: amountByName.Stress ?? null,
    calories: amountByName.Calories ?? null,
    stamina: amountByName.Stamina ?? null,
    bladder: amountByName.Bladder ?? null,
    breath: amountByName.Breath ?? null,
    hp: amountByName.HitPoints ?? null,
    decor: amountByName.Decor ?? null,
    immune: amountByName.ImmuneLevel ?? amountByName.Immune ?? null,
    temperature_dupe: amountByName.Temperature ?? null,
    body_temperature: amountByName.BodyTemperature ?? null,
  });

  for (const trait of findBehavior(go, BEHAVIOR_TRAITS)?.templateData?.TraitIds ?? []) {
    tables.duplicant_traits.push({ duplicant_id: goId, trait });
  }

  // Skills the dupe has mastered (true value means mastered).
  for (const [skillId, mastered] of resume.MasteryBySkillID ?? []) {
    if (mastered) tables.duplicant_skills.push({ duplicant_id: goId, skill: skillId });
  }

  for (const lvl of findBehavior(go, BEHAVIOR_ATTR_LEVELS)?.templateData?.saveLoadLevels ?? []) {
    tables.duplicant_attributes.push({
      duplicant_id: goId,
      attribute: lvl.attributeId,
      level: lvl.level ?? null,
      experience: lvl.experience ?? null,
    });
  }

  for (const eff of findBehavior(go, BEHAVIOR_EFFECTS)?.templateData?.saveLoadEffects ?? []) {
    tables.duplicant_effects.push({
      duplicant_id: goId,
      effect: eff.id,
      time_remaining: eff.timeRemaining ?? null,
    });
  }

  for (const a of amounts) {
    tables.duplicant_amounts.push({
      duplicant_id: goId,
      amount_name: a.name,
      value: a?.value?.value ?? null,
    });
  }
}

function extractGeyser(go, goId, prefabId, tables) {
  const geyser = findBehavior(go, BEHAVIOR_GEYSER)?.templateData ?? {};
  const cfg = geyser.configuration ?? {};
  tables.geysers.push({
    game_object_id: goId,
    prefab_id: prefabId,
    type_id: cfg.typeId ?? null,
    rate_roll: cfg.rateRoll ?? null,
    iteration_length_roll: cfg.iterationLengthRoll ?? null,
    iteration_percent_roll: cfg.iterationPercentRoll ?? null,
    year_length_roll: cfg.yearLengthRoll ?? null,
    year_percent_roll: cfg.yearPercentRoll ?? null,
    position_x: go.position?.x ?? null,
    position_y: go.position?.y ?? null,
  });
}

function extractCritter(go, goId, prefabId, tables) {
  const minionMods = findBehavior(go, BEHAVIOR_MINION_MODIFIERS)?.extraData;
  const amountByName = {};
  for (const a of minionMods?.amounts ?? []) {
    amountByName[a.name] = a?.value?.value ?? null;
  }
  const pe = findBehavior(go, BEHAVIOR_PRIMARY_ELEMENT)?.templateData ?? {};
  tables.critters.push({
    game_object_id: goId,
    prefab_id: prefabId,
    position_x: go.position?.x ?? null,
    position_y: go.position?.y ?? null,
    age: amountByName.Age ?? null,
    calories: amountByName.Calories ?? null,
    hp: amountByName.HitPoints ?? null,
    happiness: amountByName.Happiness ?? null,
    temperature: pe._Temperature ?? null,
  });
}

function extractBuildingMaybe(go, goId, prefabId, tables) {
  const pe = findBehavior(go, BEHAVIOR_PRIMARY_ELEMENT)?.templateData;
  const storage = findBehavior(go, BEHAVIOR_STORAGE);
  // Only emit a building row if it has a PrimaryElement (most placed objects
  // do; raw materials and tiles too — we keep them all so resource queries
  // can aggregate across the world).
  if (!pe && !storage) return;

  tables.buildings.push({
    game_object_id: goId,
    prefab_id: prefabId,
    position_x: go.position?.x ?? null,
    position_y: go.position?.y ?? null,
    element_id: pe?.ElementID ?? null,
    units: pe?.Units ?? null,
    temperature: pe?._Temperature ?? null,
    disease_id: pe?.diseaseID ?? null,
    disease_count: pe?.diseaseCount ?? null,
  });

  // Storage contents come through the Storage behavior's extraData.
  for (const item of storage?.extraData ?? []) {
    const itemPE = findBehavior(item, BEHAVIOR_PRIMARY_ELEMENT)?.templateData;
    tables.storage_contents.push({
      building_id: goId,
      item_prefab_id: item.name ?? null,
      element_id: itemPE?.ElementID ?? null,
      units: itemPE?.Units ?? null,
      temperature: itemPE?._Temperature ?? null,
      disease_id: itemPE?.diseaseID ?? null,
      disease_count: itemPE?.diseaseCount ?? null,
    });
  }
}
