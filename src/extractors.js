// Walks a parsed SaveGame and produces flat row arrays for SQLite insertion.
//
// The save's gameObjects field is an array of GameObjectGroup:
//   { name: prefabId, gameObjects: GameObject[] }
// Each GameObject has { position, rotation, scale, folder, behaviors }.
// Each behavior has { name, templateData?, extraData?, extraRaw? }.
//
// We:
//   * Always emit a row per game object into `game_objects`.
//   * Always emit a row per behavior into `behaviors` (templateData/extraData
//     stringified to JSON), so Claude can fall back to raw JSON for anything
//     we don't have a typed extractor for.
//   * Specialized extractors lift the most-asked-about fields into typed
//     tables. Classification:
//       - Minion prefab                -> duplicants + traits/skills/...
//       - Has MinionModifiers behavior -> critters (covers all critter types
//         + their eggs + babies, robust against new ONI updates)
//       - Prefab starts with "Geyser"  -> geysers
//       - Has BuildingComplete         -> buildings (placed structures)
//       - Has PrimaryElement only      -> world_objects (debris, food,
//         dropped items, plants, raw materials)

import {
  KPrefabIDBehavior,
  MinionIdentityBehavior,
  MinionResumeBehavior,
  MinionModifiersBehavior,
  AIAttributeLevelsBehavior,
  AITraitsBehavior,
  AIEffectsBehavior,
  PrimaryElementBehavior,
  StorageBehavior,
  GeyserBehavior,
} from "oni-save-parser";

import { safeStringify } from "./utils.js";

const PREFAB_DUPLICANT = "Minion";

// `BuildingComplete` is not exported by oni-save-parser as a typed
// behavior constant, so it stays as a string literal here. If the library
// ever adds an export for it we should switch to that.
const BEHAVIOR_BUILDING_COMPLETE = "BuildingComplete";

/** Pick the first behavior with a matching name; returns undefined if absent. */
function findBehavior(go, name) {
  if (!go || !Array.isArray(go.behaviors)) return undefined;
  return go.behaviors.find((b) => b.name === name);
}

function hasBehavior(go, name) {
  return findBehavior(go, name) !== undefined;
}

function getInstanceId(go) {
  const b = findBehavior(go, KPrefabIDBehavior);
  const id = b?.templateData?.InstanceID;
  return typeof id === "number" ? id : null;
}

/** Geysers all start with this prefix in ONI. */
function isGeyserPrefab(name) {
  return typeof name === "string" && name.startsWith("Geyser");
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
    world_objects: [],
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

      // Specialized extraction. Order matters: a Minion has MinionModifiers
      // too, so check duplicant before critter. A geyser has no
      // MinionModifiers and no BuildingComplete, so order with critters and
      // buildings doesn't matter.
      if (prefabId === PREFAB_DUPLICANT) {
        extractDuplicant(go, goId, instanceId, tables);
      } else if (hasBehavior(go, MinionModifiersBehavior)) {
        extractCritter(go, goId, prefabId, tables);
      } else if (isGeyserPrefab(prefabId)) {
        extractGeyser(go, goId, prefabId, tables);
      } else if (hasBehavior(go, BEHAVIOR_BUILDING_COMPLETE)) {
        extractBuilding(go, goId, prefabId, tables);
      } else if (hasBehavior(go, PrimaryElementBehavior) || hasBehavior(go, StorageBehavior)) {
        extractWorldObject(go, goId, prefabId, tables);
      }
    }
  }

  return tables;
}

function extractDuplicant(go, goId, instanceId, tables) {
  const identity = findBehavior(go, MinionIdentityBehavior)?.templateData ?? {};
  const resume = findBehavior(go, MinionResumeBehavior)?.templateData ?? {};
  const minionMods = findBehavior(go, MinionModifiersBehavior)?.extraData;
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

  for (const trait of findBehavior(go, AITraitsBehavior)?.templateData?.TraitIds ?? []) {
    tables.duplicant_traits.push({ duplicant_id: goId, trait });
  }

  // Skills the dupe has mastered (true value means mastered).
  for (const [skillId, mastered] of resume.MasteryBySkillID ?? []) {
    if (mastered) tables.duplicant_skills.push({ duplicant_id: goId, skill: skillId });
  }

  for (const lvl of findBehavior(go, AIAttributeLevelsBehavior)?.templateData?.saveLoadLevels ?? []) {
    tables.duplicant_attributes.push({
      duplicant_id: goId,
      attribute: lvl.attributeId,
      level: lvl.level ?? null,
      experience: lvl.experience ?? null,
    });
  }

  for (const eff of findBehavior(go, AIEffectsBehavior)?.templateData?.saveLoadEffects ?? []) {
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
  const geyser = findBehavior(go, GeyserBehavior)?.templateData ?? {};
  const cfg = geyser.configuration ?? {};
  // Note: rate_roll and *_roll fields are 0..1 percentiles against the
  // geyser type's base range, NOT actual kg/s. Resolving to a real rate
  // requires the library's geyser const-data. See README "Caveats".
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
  const minionMods = findBehavior(go, MinionModifiersBehavior)?.extraData;
  const amountByName = {};
  for (const a of minionMods?.amounts ?? []) {
    amountByName[a.name] = a?.value?.value ?? null;
  }
  const pe = findBehavior(go, PrimaryElementBehavior)?.templateData ?? {};
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

/** Placed structures: anything with a BuildingComplete behavior. */
function extractBuilding(go, goId, prefabId, tables) {
  const pe = findBehavior(go, PrimaryElementBehavior)?.templateData;
  const storage = findBehavior(go, StorageBehavior);

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

  emitStorageContents(storage, goId, tables);
}

/**
 * Loose stuff with mass/temp but not a placed building: dropped resources,
 * food items, plants, eggs, debris, raw materials.
 */
function extractWorldObject(go, goId, prefabId, tables) {
  const pe = findBehavior(go, PrimaryElementBehavior)?.templateData;
  const storage = findBehavior(go, StorageBehavior);

  tables.world_objects.push({
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

  emitStorageContents(storage, goId, tables);
}

function emitStorageContents(storage, ownerGoId, tables) {
  for (const item of storage?.extraData ?? []) {
    const itemPE = findBehavior(item, PrimaryElementBehavior)?.templateData;
    tables.storage_contents.push({
      building_id: ownerGoId,
      item_prefab_id: item.name ?? null,
      element_id: itemPE?.ElementID ?? null,
      units: itemPE?.Units ?? null,
      temperature: itemPE?._Temperature ?? null,
      disease_id: itemPE?.diseaseID ?? null,
      disease_count: itemPE?.diseaseCount ?? null,
    });
  }
}
