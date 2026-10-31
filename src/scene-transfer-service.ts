import { ID } from "./constants";
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import { getDefinitions, replaceDefinitions } from "./definitions";
import { getBuildings, getTerrain, isSettlementScene } from "./store";
import { getSettlement } from "./settlement";
import { exportDefinitions } from "./transfer";
import { exportScene } from "./scene-transfer";
import { normalizeMapGenOptions } from "./mapgen";
import type { SceneData } from "./scene-transfer";
import type { Definitions } from "./types";

/** JSON der aktuellen Siedlungsszene (null, wenn die Szene keine Siedlungsszene ist). */
export function exportCurrentScene(includeDefinitions: boolean): string | null {
  const scene = canvas.scene;
  if (!scene || !isSettlementScene(scene)) return null;
  const size: number = scene.grid.size;
  const stored = getTerrain(scene);
  const cols = stored?.cols ?? Math.round(scene.dimensions.sceneWidth / size);
  const rows = stored?.rows ?? Math.round(scene.dimensions.sceneHeight / size);
  const terrain = stored && stored.cells.length === cols * rows ? stored : { cols, rows, cells: DEFAULT_TERRAIN.repeat(cols * rows) };
  const hasMapgen = scene.getFlag(ID, "mapgen") !== undefined;
  return exportScene({
    name: scene.name,
    terrain,
    ...(hasMapgen ? { mapgen: normalizeMapGenOptions(scene.getFlag(ID, "mapgen")) } : {}),
    settlement: getSettlement(scene),
    buildings: getBuildings(scene),
    ...(includeDefinitions ? { definitions: JSON.parse(exportDefinitions(getDefinitions())) } : {})
  });
}

/** Ab v14 hat jede Ebene eine eigene Hintergrundfarbe; sie füllt den Szenenbereich. */
async function applyBaseColor(scene: any, hex: string): Promise<void> {
  const color = parseInt(hex.replace("#", ""), 16);
  try {
    const levels: any[] = [...(scene.levels?.contents ?? [])];
    if (levels.length) {
      await scene.updateEmbeddedDocuments("Level", levels.map(l => ({ _id: l.id, background: { color } })));
    } else {
      const [level] = await scene.createEmbeddedDocuments("Level", [{ name: scene.name, background: { color } }]);
      if (level) await scene.update({ initialLevel: level.id });
    }
  } catch (err) {
    console.warn(`${ID} | Hintergrundfarbe der Ebene konnte nicht gesetzt werden`, err);
  }
}

const flagsOf = (data: SceneData): Record<string, unknown> => ({
  enabled: true,
  terrain: data.terrain,
  ...(data.mapgen ? { mapgen: data.mapgen } : {}),
  buildings: data.buildings,
  settlement: data.settlement
});

/** SL: übernimmt zusammengeführte Definitionen und legt aus den Daten eine neue Siedlungsszene an. */
export async function importAsNewScene(data: SceneData, definitions: Required<Definitions> | null): Promise<void> {
  if (!game.user.isGM) return;
  if (definitions) await replaceDefinitions(definitions);
  const size = 100;
  const scene = await Scene.create({
    name: data.name,
    width: data.terrain.cols * size,
    height: data.terrain.rows * size,
    padding: 0,
    grid: { type: CONST.GRID_TYPES.SQUARE, size, distance: 5, units: "m" },
    backgroundColor: TERRAIN[DEFAULT_TERRAIN].color,
    tokenVision: false,
    flags: { [ID]: flagsOf(data) }
  });
  await applyBaseColor(scene, TERRAIN[DEFAULT_TERRAIN].color);
  await scene.view();
}

/**
 * SL: ersetzt alle Siedlungsdaten der aktuellen Siedlungsszene und passt ihre Größe an.
 * Objekte der Szene (Tokens, Wände, ...) bleiben unberührt.
 */
export async function importIntoCurrentScene(data: SceneData, definitions: Required<Definitions> | null): Promise<void> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene || !isSettlementScene(scene)) return;
  if (definitions) await replaceDefinitions(definitions);
  // Objekte in Flags werden beim Aktualisieren zusammengeführt: erst die alten Schlüssel entfernen, dann neu schreiben
  await scene.update({ flags: { [ID]: { "-=settlement": null, "-=terrain": null, "-=mapgen": null, "-=buildings": null } } });
  const size: number = scene.grid.size;
  await scene.update({
    width: data.terrain.cols * size,
    height: data.terrain.rows * size,
    flags: { [ID]: flagsOf(data) }
  });
}
