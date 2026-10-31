import { ID } from "./constants";
import { TERRAIN } from "./data";
import { getRoadTypes } from "./definitions";
import { getBuildings, getTerrain, terrainAt } from "./store";
import { DEFAULT_ROAD_GAP, normalizeRoadOrders, normalizeRoads, roadAt } from "./roads";
import type { RoadCellContext } from "./roads";
import type { RoadOrder, RoadType, TerrainData } from "./types";

export const SETTING_ROAD_GAP = "roadGap";

/** Größe der Karte in Feldern (aus den Geländedaten, sonst aus den Szenenmaßen). */
export function mapSize(scene: any = canvas.scene): { cols: number; rows: number } {
  const t = getTerrain(scene);
  const s: number = scene.grid.size;
  return { cols: t?.cols ?? Math.round(scene.dimensions.sceneWidth / s), rows: t?.rows ?? Math.round(scene.dimensions.sceneHeight / s) };
}

const typeIds = (): Set<string> => new Set(getRoadTypes().map(r => r.id));

/** Fertige Wege der Szene (immer in der Größe der Karte). */
export function getRoads(scene: any = canvas?.scene): TerrainData {
  const { cols, rows } = mapSize(scene);
  return normalizeRoads(scene?.getFlag(ID, "roads"), cols, rows, typeIds());
}

/** Beauftragte Wegabschnitte der Szene in der Reihenfolge der Beauftragung. */
export function getRoadOrders(scene: any = canvas?.scene): RoadOrder[] {
  const { cols, rows } = mapSize(scene);
  return normalizeRoadOrders(scene?.getFlag(ID, "roadOrders"), cols, rows, typeIds());
}

export const getRoadType = (id: string): RoadType | undefined => getRoadTypes().find(r => r.id === id);

/** Abstand der Wege zum Feldrand als Anteil (Einstellung in Prozent). */
export function roadGap(): number {
  try {
    const v = Number(game.settings.get(ID, SETTING_ROAD_GAP));
    return Number.isFinite(v) ? v / 100 : DEFAULT_ROAD_GAP / 100;
  } catch {
    return DEFAULT_ROAD_GAP / 100;
  }
}

/** Gebäude, die auf dem Feld stehen (egal ob im Bau oder fertig)? */
export function buildingCells(scene: any = canvas.scene): Set<string> {
  return new Set(getBuildings(scene).flatMap(b => b.cells.map(([x, y]) => `${x},${y}`)));
}

/** Kontext für die Prüfung, ob auf einem Feld ein Weg beauftragt werden darf. */
export function roadContext(scene: any = canvas.scene): RoadCellContext {
  const { cols, rows } = mapSize(scene);
  const terrain = getTerrain(scene);
  const roads = getRoads(scene);
  const taken = buildingCells(scene);
  const orders = new Set(getRoadOrders(scene).map(o => `${o.x},${o.y}`));
  return {
    cols,
    rows,
    buildable: (x, y) => !!TERRAIN[terrainAt(terrain, x, y)]?.buildable,
    hasBuilding: (x, y) => taken.has(`${x},${y}`),
    hasRoad: (x, y) => roadAt(roads, x, y) !== null,
    hasOrder: (x, y) => orders.has(`${x},${y}`)
  };
}
