// Hand-built fake SaveGame used by the smoke script and the test suite.
// Designed to exercise every extractor branch:
//   - Minion (duplicant)         -> tests duplicant fields + traits/skills/...
//   - GeyserGeneric_steam        -> tests geyser routing + roll fields
//   - BigVolcano                 -> tests behavior-based geyser detection
//                                   (prefab name doesn't start with "Geyser",
//                                   classification is via the Geyser behavior)
//   - BatterySmart               -> placed building (has BuildingComplete)
//   - StorageLocker              -> placed building w/ Storage contents
//   - loose Algae pile           -> world_object (PrimaryElement, no BuildingComplete)
//   - Hatch                      -> critter (in any hardcoded list)
//   - Pip                        -> critter (NOT in any hardcoded list — guards
//                                   the heuristic against future critters)

export const FAKE_SAVE = {
  version: { major: 7, minor: 26 },
  header: {
    buildVersion: 567890,
    gameInfo: {
      numberOfCycles: 312,
      numberOfDuplicants: 3,
      baseName: "Test Base",
      isAutoSave: false,
      saveMajorVersion: 7,
      saveMinorVersion: 26,
      clusterId: "cluster-x",
      sandboxEnabled: false,
      colonyGuid: "abc-123",
      dlcId: "EXPANSION1",
      originalSaveName: "Test",
    },
  },
  settings: { baseAlreadyCreated: true, nextUniqueID: 99, gameID: 1 },
  world: { worldDetails: "BIG", other: "ok" },
  gameData: { gasConduitFlow: "BLOB", customGameSettings: { is_custom_game: false } },
  gameObjects: [
    {
      name: "Minion",
      gameObjects: [
        {
          position: { x: 100, y: 200, z: 0 },
          scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 4242 } },
            { name: "MinionIdentity", templateData: {
              name: "Meep", gender: "MALE", arrivalTime: 0, voiceIdx: 1,
              bodyData: {}, assignableProxy: { id: 0 }, nameStringKey: "k",
              genderStringKey: "MALE",
            }},
            { name: "MinionResume", templateData: {
              MasteryByRoleID: [],
              MasteryBySkillID: [["Mining1", true], ["Mining2", false]],
              AptitudeBySkillGroup: [],
              totalExperienceGained: 100, currentRole: "Digger",
              targetRole: "MasterDigger", currentHat: "", targetHat: "",
            }},
            { name: "Klei.AI.Traits", templateData: { TraitIds: ["Trait_Sociable","Trait_Loud"] } },
            { name: "Klei.AI.AttributeLevels", templateData: { saveLoadLevels: [
              { attributeId: "Digging", level: 5, experience: 200 },
              { attributeId: "Strength", level: 2, experience: 50 },
            ]}},
            { name: "Klei.AI.Effects", templateData: { saveLoadEffects: [
              { id: "FullBladder", timeRemaining: 30 },
            ]}},
            { name: "MinionModifiers", templateData: {}, extraData: {
              amounts: [
                { name: "Stress", value: { value: 12.5 } },
                { name: "Calories", value: { value: 4000 } },
                { name: "Stamina", value: { value: 80 } },
                { name: "HitPoints", value: { value: 100 } },
              ],
              sicknesses: [],
            }},
          ],
        },
      ],
    },
    {
      name: "GeyserGeneric_steam",
      gameObjects: [
        {
          position: { x: 50, y: 60, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 1 } },
            { name: "Geyser", templateData: { configuration: {
              typeId: "steam", rateRoll: 0.5, iterationLengthRoll: 0.4,
              iterationPercentRoll: 0.6, yearLengthRoll: 0.5, yearPercentRoll: 0.55,
            }}},
          ],
        },
      ],
    },
    {
      // Volcano — its prefab name does NOT start with "Geyser", so prefix
      // detection would miss it. The Geyser behavior is what classifies it.
      name: "BigVolcano",
      gameObjects: [
        {
          position: { x: 70, y: 80, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 2 } },
            { name: "Geyser", templateData: { configuration: {
              typeId: "big_volcano", rateRoll: 0.7, iterationLengthRoll: 0.3,
              iterationPercentRoll: 0.4, yearLengthRoll: 0.6, yearPercentRoll: 0.5,
            }}},
          ],
        },
      ],
    },
    {
      name: "BatterySmart",
      gameObjects: [
        {
          position: { x: 10, y: 10, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 7 } },
            { name: "BuildingComplete", templateData: {} },
            { name: "PrimaryElement", templateData: {
              ElementID: "RefinedMetal", Units: 200, _Temperature: 295.15,
              diseaseID: "", diseaseCount: 0,
            }},
          ],
        },
      ],
    },
    {
      // Loose pile of algae lying on the floor — should land in world_objects,
      // NOT buildings, because it has no BuildingComplete.
      name: "Algae",
      gameObjects: [
        {
          position: { x: 30, y: 30, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 100 } },
            { name: "PrimaryElement", templateData: {
              ElementID: "Algae", Units: 750, _Temperature: 293,
              diseaseID: "", diseaseCount: 0,
            }},
          ],
        },
      ],
    },
    {
      name: "StorageLocker",
      gameObjects: [
        {
          position: { x: 11, y: 11, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 8 } },
            { name: "BuildingComplete", templateData: {} },
            { name: "PrimaryElement", templateData: {
              ElementID: "Iron", Units: 100, _Temperature: 295,
              diseaseID: "", diseaseCount: 0,
            }},
            { name: "Storage", templateData: {
              onlyFetchMarkedItems: false, workTimeRemaining: 0, numberOfUses: 0,
            }, extraData: [
              {
                name: "Algae",
                position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 },
                rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
                behaviors: [
                  { name: "PrimaryElement", templateData: {
                    ElementID: "Algae", Units: 500, _Temperature: 295,
                    diseaseID: "FoodPoisoning", diseaseCount: 10,
                  }},
                ],
              },
              {
                name: "Water",
                position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 },
                rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
                behaviors: [
                  { name: "PrimaryElement", templateData: {
                    ElementID: "Water", Units: 250, _Temperature: 290,
                    diseaseID: "", diseaseCount: 0,
                  }},
                ],
              },
            ]},
          ],
        },
      ],
    },
    {
      name: "Hatch",
      gameObjects: [
        {
          position: { x: 22, y: 22, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 9 } },
            { name: "PrimaryElement", templateData: {
              ElementID: "Creature", Units: 1, _Temperature: 295,
              diseaseID: "", diseaseCount: 0,
            }},
            { name: "MinionModifiers", templateData: {}, extraData: {
              amounts: [
                { name: "Calories", value: { value: 80000 } },
                { name: "HitPoints", value: { value: 50 } },
                { name: "Happiness", value: { value: 20 } },
                { name: "Age", value: { value: 60 } },
              ],
              sicknesses: [],
            }},
          ],
        },
      ],
    },
    {
      // Pip wasn't in the old hardcoded critter list. The new heuristic
      // (has MinionModifiers && not a Minion) should still classify it as a
      // critter and route it into the critters table.
      name: "Pip",
      gameObjects: [
        {
          position: { x: 33, y: 33, z: 0 }, scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 }, folder: 0,
          behaviors: [
            { name: "KPrefabID", templateData: { InstanceID: 200 } },
            { name: "PrimaryElement", templateData: {
              ElementID: "Creature", Units: 1, _Temperature: 295,
              diseaseID: "", diseaseCount: 0,
            }},
            { name: "MinionModifiers", templateData: {}, extraData: {
              amounts: [
                { name: "Calories", value: { value: 50000 } },
                { name: "Age", value: { value: 30 } },
              ],
              sicknesses: [],
            }},
          ],
        },
      ],
    },
  ],
};
