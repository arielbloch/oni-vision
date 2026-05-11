# Duplicants

Stress, traits, skills, and the social plumbing of keeping dupes alive and productive.

## Stress

Stress is a 0–100% gauge per dupe. At 100% the dupe enters a stress response — Aggressive (vomits), Binge Eater (eats half your fridge), Ugly Crier (negative decor radius), Banshee (screams, debuffs morale).

**Sources of stress increase:**
- Low decor (each cycle in negative decor adds %)
- Hunger / hunger pangs / starving
- Wet feet
- Sleep interruption
- Dark room
- Witnessing death
- Personal triggers (Loud sleeper traits etc.)

**Sources of stress decrease:**
- Positive decor in living spaces
- Quality meals (table + chair, not standing on a tile)
- Massage table
- Phorbo / Pip / Plug Slug morale buffs (DLC critters)
- Recreation room buildings
- Sleep in a Cot/Comfy Bed in a private bedroom

If a dupe's stress is climbing, it's almost always one of: their bedroom decor is bad, their toilet block is unsanitary, they're walking on polluted water without atmo suits, or they're not getting morale-quality meals.

**Quick stress-fix priority list (in order):**
1. Build a Mess Hall with Great Hall morale bonus (table, chair, decor > +10).
2. Private Bedrooms (Comfy Bed, decor > +10).
3. Replace Microbe Mush with cooked food.
4. Atmo suits for any room with chlorine, hot temperatures, or polluted oxygen.
5. Add a Massage Table parked next to high-stress dupes.

## Traits

**Always-keep traits** (positive that compound across the game):

| Trait                  | Effect                                    |
|------------------------|-------------------------------------------|
| Mouth Breather         | -50% O2 consumption                       |
| Iron Gut               | +15 germ resistance, can eat raw food     |
| Diver's Lungs          | +200 g lung capacity                      |
| Quick Learner          | +7 to one skill XP gain                   |
| Interior Decorator     | +3 decor                                  |
| Trypophobia (negative) | Most-trolling negative; impacts drilling. Skip. |

**Traits that print money in early game:**

- **Bottomless Stomach** + plenty of food: not actually a problem, just calorie cost.
- **Caregiver**: extra healing — pair with a Triage Cot.
- **Loner**: stress decay alone — perfect for a research-only dupe.
- **Twinkletoes**: stomp out cracks instantly — saves dupe-time.

**Traits to think hard about:**

- **Anemic**: -1 athletics. Acceptable if dupe is a Researcher; bad for Diggers.
- **Loud Sleeper**: stresses bunkmates. Must have private bedroom.
- **Slow Learner**: -1 to all skills. Pretty rough; pass.
- **Narcoleptic**: random sleep. Hard pass.

**Joy traits** (random morale boosts):

- Creative Type, Greasemonkey, Cudgel of Order — keep these dupes happy and they pay back hard.

## Skills and the morale economy

Every skill mastered raises the dupe's *morale demand* by 1. Total morale comes from:

- Base 7
- Quality meals (Great Hall +6, etc.)
- Bedroom assignment (Cot +1, Bed +3, Comfy Bed +6)
- Recreation buildings (massage table, water cooler, mechanical surfboard)
- Decor visited

If morale is below skill demand, the dupe gains stress passively. A 12-skill dupe needs 12+ morale.

**Skill build orders:**

**Early game (cycles 0–50):**
- One Master Digger (Mining 4)
- One Master Builder (Construction 4)
- One Researcher (Learning 3)
- One Cook + Farmer (Cuisine + Farming)
- Operator/Suits ASAP (Operating 1, Engineering 1)

**Mid game (cycles 50–200):**
- Suits Engineer (Improved Suit Wearing) for everyone who works in atmo zones
- Plumber (Improved Plumbing) — finishes basic water lines
- Electrical Engineering for power room work
- Medic for sick bay

**Late game (cycles 200+):**
- Robotics for autobuild
- Pyrotechnics for nuclear / petrochemical
- Astronaut for rockets (Spaced Out)

Don't over-train. A dupe with 10 skills demands 17+ morale and you'll be paying for it forever. Keep most dupes specialized at 2–4 skills.

## Status effects worth knowing

These show up in `duplicant_effects.effect`:

- `FullBladder`, `BladderFull` — needs to pee soon.
- `WetFeet`, `SoakingWet` — wet from walking through liquid; +5/+10 stress per cycle until fixed.
- `Bored` — too few rec activities.
- `RedAlert` / `YellowAlert` — colony-wide alert states; affect everyone.
- `MyFavoriteFood`, `BalancedDiet`, `GreatMeal` — positive food morale.
- `MovingToColony` (Spaced Out) — duplicant in transit on rocket; not present on this asteroid right now.
- `SoreBack`, `BadSleep`, `Insomniac` — fix sleeping arrangements.

When a user complains "Liam is stressed", check `duplicant_effects` first — usually the answer is staring at you in 1–2 effect IDs.

## Common asks

**"Should I keep this dupe?"** — Evaluate against:
1. Top 3 traits (must include 2+ from the always-keep list, or specialized utility).
2. Joy trait? (bonus, not required)
3. Interest aptitudes match a role I'm short on?

If 1 fails outright, pass. Don't keep dupes for cosmetic reasons — every body is calories, oxygen, and morale demand for the rest of the game.

**"Why is my dupe stressed?"** — Use `oni_dupe({ name })` — it returns the dupe's traits + skills + attributes + active effects in one payload. Check the `effects` list for any negative-effect IDs (SoreBack, WetFeet, etc.); that's usually your answer. If effects are clean, check decor (need at least +10 in bedroom and 0 in workspaces).

**"How many dupes should I print?"** — Rule of thumb: 1 dupe per cycle 5 until cycle 30, then 1 per ~10 cycles, capping around 12–16 for a balanced base. SPOM-equivalent oxygen and food production scales with dupes; don't get ahead of those.
