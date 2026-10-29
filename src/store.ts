import { ID } from "./constants";
import { BUILDINGS } from "./data";
import type { Building, BuildingType, Cell, PlacementCheck } from "./types";

export const cellKey = (x: number, y: number): string => `${x},${y}`;

export function getBuildings(scene: any = canvas.scene): Building[] {
  return scene?.getFlag(ID, "buildings") ?? [];
}

/** Nur Szenen mit gesetzter Markierung sind Siedlungsszenen. */
export function isSettlementScene(scene: any = canvas?.scene): boolean {
  return scene?.getFlag(ID, "enabled") === true;
}

export function getType(typeId: string): BuildingType | undefined {
  return BUILDINGS.find(b => b.id === typeId);
}

/** Dreht (90°-Schritte) und spiegelt Zellen und verschiebt sie wieder auf min = 0. */
export function transformCells(cells: Cell[], rotation = 0, mirror = false): Cell[] {
  let out: Cell[] = cells.map(([x, y]): Cell => (mirror ? [-x, y] : [x, y]));
  for (let i = 0; i < rotation % 4; i++) out = out.map(([x, y]): Cell => [-y, x]);
  const minX = Math.min(...out.map(c => c[0]));
  const minY = Math.min(...out.map(c => c[1]));
  return out.map(([x, y]): Cell => [x - minX, y - minY]);
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
  const taken = new Set<string>();
  for (const b of getBuildings(scene)) for (const [x, y] of b.cells) taken.add(cellKey(x, y));
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return { ok: false, reason: "SIEDLUNG.errors.outOfBounds" };
    if (taken.has(cellKey(x, y))) return { ok: false, reason: "SIEDLUNG.errors.occupied" };
  }
  return { ok: true };
}
