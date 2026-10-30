# Siedlungsbau (Settlement Building)

A settlement-building module for **Foundry VTT v14**. 


## Features

### Settlement scenes
- Create a ready-made settlement scene (square grid, **1 square = 5 m**) or mark any existing square-grid scene as a settlement scene.
- **Procedural map generation** with a seeded random generator: choose a terrain for each map edge (e.g. forest to the north, rocks to the east), add rivers that enter from an edge and wind toward the center, and optionally place a lake in the middle. Rivers connect edges with each other (north + east → one river joining both) and all flow into the lake if there is one. Shores and rocks are added organically. The map can be **regenerated** at any time; existing buildings are protected.
- **Map expansion:** the GM can add any number of squares to the left, right, top or bottom. New squares copy the adjacent row/column, and buildings and scene objects are shifted accordingly.

### Terrain editor (GM)
- Paint single squares with a brush.
- Define **custom terrain types** (name, color, buildable or not) in the definitions editor.

### Buildings
- Freely definable **building types** and **categories** with an editor for the building shape (rotate and mirror when placing).
- Players **order** buildings on the map; each building has build costs and upkeep in resources and workers.
- Construction progress is driven by delivered **materials and labor**. Every resource has a **build weight** (decimal values allowed), so rare materials can count more than common ones.
- Clicking a building (Select tool) opens an info window with its effects, upkeep, construction status and progress. Players can rename, demolish or cancel construction; the GM can complete construction instantly.

### Resources, workers and stats
- Custom **resources** (stockpiles) and **workers** (labor per week), with upkeep applied when a week ends.
- Custom **stats** (e.g. morale, loyalty) as interval or open-ended values with thresholds. Buildings can change stats **weekly** or **once** (e.g. a tavern permanently raising morale by 5; reverted if the building is demolished).

### Active effects
- Temporary effects with a duration in weeks (e.g. migrant workers: +5 craftsmen for 3 weeks). They can modify resources, workers or stats and are removed automatically when they expire. The GM adds them in the settlement overview.

### Laws
- The GM defines **law categories** (e.g. Public Safety), **laws** (e.g. Curfew) and their **options** (e.g. Strict Curfew, No Curfew). The active option acts like a permanent effect until it is changed.
- Options can be **disabled** (greyed out) or **hidden**, whole laws can be hidden from players, and laws can be **locked**.
- Module settings control whether players see law effects, how many laws players may change per week, and the cooldown (in weeks) before the same law can be changed again. The GM is never restricted.

### Weekly cycle
- The GM advances the **work week**: upkeep of finished buildings is deducted, then construction orders receive materials and labor; effects tick down and a report is generated.

### Data import / export
- Export and import categories, resources, workers, stats, terrain types, laws and building types as JSON (module settings → *Export/Import data*).

## Installation

### Via manifest URL (recommended)
1. In Foundry go to **Setup → Add-on Modules → Install Module**.
2. Paste this URL into **Manifest URL** and click **Install**:

   ```
   https://github.com/simaimch/siedlungsbau/releases/latest/download/module.json
   ```

### Manual
Download `module.zip` from the [latest release](https://github.com/simaimch/siedlungsbau/releases/latest) and extract it into your `Data/modules/siedlungsbau` folder.

Then enable the module in your world.

## Getting started
1. Open a scene and use the **Settlement** tool group in the scene controls. As GM, choose *Create settlement scene* (or *Mark scene as settlement scene*).
2. Open the **definitions editor** to set up categories, buildings, resources, workers, stats, terrain and laws, or import a prepared JSON file.
3. Players pick the **Build** tool, choose a building and place it on the map. Left click orders it (Shift = multiple), **R** rotates, **Shift+R** mirrors, right click or **Esc** cancels.
4. Use the **settlement overview** to see resources, workers, stats and construction progress. The GM advances the week there.


