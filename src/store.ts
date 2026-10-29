import { ID } from "./constants";
import { TERRAIN, DEFAULT_TERRAIN, ROCK_CHANCE } from "./data";
import { getBuildingTypes } from "./definitions";
import type { Building, BuildingType, Cell, PlacementCheck, TerrainData } from "./types";

export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function getBuildings(scene: any = canvas.scene): Building[] {
  return scene?.getFlag(ID, "buildings") ?? [];
}

export function getTerrain(scene: any = canvas?.scene): TerrainData | null {
  return scene?.getFlag(ID, "terrain") ?? null;
}

/** Gelände-Zeichen an einer Zelle; ohne Geländedaten (oder außerhalb) gilt das Standardgelände. */
export function terrainAt(terrain: TerrainData | null, x: number, y: number): string {
  if (!terrain || x < 0 || y < 0 || x >= terrain.cols || y >= terrain.rows) return DEFAULT_TERRAIN;
  return terrain.cells[y * terrain.cols + x] ?? DEFAULT_TERRAIN;
}


/** Nur Szenen mit gesetzter Markierung sind Siedlungsszenen. */
export function isSettlementScene(scene: any = canvas?.scene): boolean {
  return scene?.getFlag(ID, "enabled") === true;
}

export function getType(typeId: string): BuildingType | undefined {
  return getBuildingTypes().find(b => b.id === typeId);
}

/** Dreht (90°-Schritte) und spiegelt Zellen und verschiebt sie wieder auf min = 0. */
export function transformCells(cells: Cell[], rotation = 0, mirror = false): Cell[] {
  let out: Cell[] = cells.map(([x, y]): Cell => (mirror ? [-x, y] : [x, y]));
  for (let i = 0; i < rotation % 4; i++) out = out.map(([x, y]): Cell => [-y, x]);
  const minX = Math.min(...out.map(c => c[0]));
  const minY = Math.min(...out.map(c => c[1]));
  return out.map(([x, y]): Cell => [x - minX, y - minY]);
}

/** Alle Felder hängen über Kanten (nicht nur Ecken) zusammen. */
export function isConnected(cells: Cell[]): boolean {
  if (!cells.length) return false;
  const set = new Set(cells.map(([x, y]) => cellKey(x, y)));
  const seen = new Set<string>([cellKey(cells[0][0], cells[0][1])]);
  const stack: Cell[] = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = cellKey(x + dx, y + dy);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === set.size;
}

export function bounds(cells: Cell[]): { w: number; h: number } {
  return {
    w: Math.max(...cells.map(c => c[0])) + 1,
    h: Math.max(...cells.map(c => c[1])) + 1
  };
}

/** Kanonische Form: identisch für alle 8 Dreh-/Spiegelvarianten derselben Form. */
export function canonical(cells: Cell[]): string {
  let best: string | null = null;
  for (const mirror of [false, true]) {
    for (let r = 0; r < 4; r++) {
      const s = transformCells(cells, r, mirror).map(([x, y]) => cellKey(x, y)).sort().join("|");
      if (best === null || s < best) best = s;
    }
  }
  return best as string;
}

/** Prüft absolute Zellen auf Rasterkarte (Quadratraster, Padding 0, Ursprung = Szenen-Ursprung). */
export function checkPlacement(scene: any, cells: Cell[]): PlacementCheck {
  if (scene.grid.type !== CONST.GRID_TYPES.SQUARE) return { ok: false, reason: "SIEDLUNG.errors.noSquareGrid" };
  const size: number = scene.grid.size;
  const cols = Math.floor(scene.width / size);
  const rows = Math.floor(scene.height / size);
  const terrain = getTerrain(scene);
  const taken = new Set<string>();
  for (const b of getBuildings(scene)) for (const [x, y] of b.cells) taken.add(cellKey(x, y));
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return { ok: false, reason: "SIEDLUNG.errors.outOfBounds" };
    if (!TERRAIN[terrainAt(terrain, x, y)]?.buildable) return { ok: false, reason: "SIEDLUNG.errors.terrain" };
    if (taken.has(cellKey(x, y))) return { ok: false, reason: "SIEDLUNG.errors.occupied" };
  }
  return { ok: true };
}
