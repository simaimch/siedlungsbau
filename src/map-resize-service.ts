import { ID } from "./constants";
import { getBuildings, getTerrain, isSettlementScene } from "./store";
import { getRoads, getRoadOrders } from "./roads-store";
import { expandRoads, shiftOrders } from "./roads";
import { expandTerrain, normalizeExpand, shiftCells, MAX_SIDE, type Expand } from "./map-resize";

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Verschiebt Objekte der Szene (Pixel), damit sie beim Erweitern nach links/oben an ihrem Feld bleiben. */
async function shiftPlaceables(scene: any, dx: number, dy: number): Promise<void> {
  if (!dx && !dy) return;
  const jobs: [string, (d: any) => object][] = [
    ["Token", d => ({ x: d.x + dx, y: d.y + dy })],
    ["Tile", d => ({ x: d.x + dx, y: d.y + dy })],
    ["Drawing", d => ({ x: d.x + dx, y: d.y + dy })],
    ["Note", d => ({ x: d.x + dx, y: d.y + dy })],
    ["AmbientLight", d => ({ x: d.x + dx, y: d.y + dy })],
    ["AmbientSound", d => ({ x: d.x + dx, y: d.y + dy })],
    ["Wall", d => ({ c: [d.c[0] + dx, d.c[1] + dy, d.c[2] + dx, d.c[3] + dy] })]
  ];
  for (const [type, fn] of jobs) {
    try {
      const docs: any[] = [...(scene.getEmbeddedCollection(type)?.contents ?? [])];
      if (docs.length) await scene.updateEmbeddedDocuments(type, docs.map(d => ({ _id: d.id, ...fn(d) })));
    } catch (err) {
      console.warn(`${ID} | ${type} konnte nicht verschoben werden`, err);
    }
  }
}

/** SL: erweitert die Karte der aktuellen Siedlungsszene um beliebig viele Felder je Seite. */
export async function expandMap(input: Partial<Record<keyof Expand, unknown>>): Promise<boolean> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene || !isSettlementScene(scene)) return false;
  const size: number = scene.grid.size;
  const old = getTerrain(scene) ?? {
    cols: Math.round(scene.dimensions.sceneWidth / size),
    rows: Math.round(scene.dimensions.sceneHeight / size),
    cells: ""
  };
  if (!old.cells) old.cells = "g".repeat(old.cols * old.rows);
  const e = normalizeExpand(input, old.cols, old.rows);
  if (!e.left && !e.right && !e.top && !e.bottom) {
    ui.notifications.warn(t("SIEDLUNG.expand.none", { max: MAX_SIDE }));
    return false;
  }
  const terrain = expandTerrain(old, e);
  const buildings = getBuildings(scene).map(b => ({ ...b, cells: shiftCells(b.cells, e.left, e.top) }));
  const roads = expandRoads(getRoads(scene), e);
  const roadOrders = shiftOrders(getRoadOrders(scene), e.left, e.top);
  await scene.update({
    width: terrain.cols * size,
    height: terrain.rows * size,
    flags: { [ID]: { terrain, buildings, roads, roadOrders } }
  });
  await shiftPlaceables(scene, e.left * size, e.top * size);
  ui.notifications.info(t("SIEDLUNG.expand.done", { cols: terrain.cols, rows: terrain.rows }));
  return true;
}
