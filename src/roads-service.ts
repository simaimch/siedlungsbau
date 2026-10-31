import { ID, SOCKET } from "./constants";
import { escapeHTML } from "./util";
import { isSettlementScene } from "./store";
import { buildingCells, getRoadOrders, getRoads, getRoadType, roadContext } from "./roads-store";
import { MAX_ROAD_CELLS, pruneRoads, roadAt, roadCellProblem, setRoad } from "./roads";
import { TERRAIN } from "./data";
import { getTerrain, terrainAt } from "./store";
import type { Cell, RoadMessage, RoadOrder } from "./types";

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const speaker = () => ({ alias: t("SIEDLUNG.title") });

/** Schreibzugriffe nacheinander ausführen, damit schnelle Striche sich nicht gegenseitig überschreiben. */
let queue: Promise<void> = Promise.resolve();
const enqueue = (job: () => Promise<void>): Promise<void> => {
  queue = queue.then(job).catch(err => console.error(`${ID} | Wege`, err));
  return queue;
};

const chunks = (cells: Cell[]): Cell[][] => {
  const out: Cell[][] = [];
  for (let i = 0; i < cells.length; i += MAX_ROAD_CELLS) out.push(cells.slice(i, i + MAX_ROAD_CELLS));
  return out;
};

function send(msg: RoadMessage): void {
  if (!isSettlementScene()) return;
  if (game.user.isGM) {
    void handle(msg);
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.error(t("SIEDLUNG.errors.noGM"));
    return;
  }
  game.socket.emit(SOCKET, msg);
}

/** Alle Nutzer: Wegabschnitte beauftragen. */
export function requestRoadOrder(typeId: string, cells: Cell[]): void {
  for (const part of chunks(cells)) send({ action: "roadOrder", sceneId: canvas.scene.id, typeId, cells: part, userId: game.user.id });
}

/** Alle Nutzer: Wegabschnitte entfernen bzw. den Bau abbrechen. */
export function requestRoadRemove(cells: Cell[]): void {
  for (const part of chunks(cells)) send({ action: "roadRemove", sceneId: canvas.scene.id, cells: part, userId: game.user.id });
}

/** SL: schließt den Bau der Wegabschnitte sofort ab. */
export function completeRoads(cells: Cell[]): Promise<void> {
  return enqueue(async () => {
    const scene = canvas.scene;
    if (!game.user.isGM || !scene || !isSettlementScene(scene)) return;
    const want = new Set(cells.map(([x, y]) => `${x},${y}`));
    let roads = getRoads(scene);
    const orders = getRoadOrders(scene);
    const left: RoadOrder[] = [];
    let done = 0;
    for (const o of orders) {
      if (want.has(`${o.x},${o.y}`)) {
        roads = setRoad(roads, o.x, o.y, o.typeId);
        done++;
      } else left.push(o);
    }
    if (!done) return;
    await scene.update({ flags: { [ID]: { roads, roadOrders: left } } });
  });
}

export function registerRoadSocket(): void {
  game.socket.on(SOCKET, (msg: RoadMessage | undefined) => {
    if (game.user !== game.users.activeGM) return;
    if (msg?.action === "roadOrder" || msg?.action === "roadRemove") void handle(msg);
  });
}

/** Prüft und bereinigt die Felder einer Nachricht: ganze Zahlen, ohne Doppelte, höchstens MAX_ROAD_CELLS. */
function cleanCells(raw: unknown): Cell[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const c of raw.slice(0, MAX_ROAD_CELLS)) {
    if (!Array.isArray(c) || c.length !== 2 || !c.every(Number.isInteger)) continue;
    const key = `${c[0]},${c[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([c[0], c[1]]);
  }
  return out;
}

/** Läuft nur auf dem Client der aktiven SL und prüft alles erneut. */
function handle(msg: RoadMessage): Promise<void> {
  return enqueue(async () => {
    const scene = game.scenes.get(msg.sceneId);
    const user = game.users.get(msg.userId);
    if (!scene || !user || !isSettlementScene(scene)) return;
    const cells = cleanCells(msg.cells);
    if (!cells.length) return;

    if (msg.action === "roadOrder") {
      const type = typeof msg.typeId === "string" ? getRoadType(msg.typeId) : undefined;
      if (!type) return;
      const ctx = roadContext(scene);
      const orders = getRoadOrders(scene);
      let accepted = 0;
      for (const [x, y] of cells) {
        if (roadCellProblem(x, y, ctx) !== null) continue;
        orders.push({ x, y, typeId: type.id });
        accepted++;
      }
      if (!accepted) {
        await ChatMessage.create({ whisper: [user.id], speaker: speaker(), content: t("SIEDLUNG.roads.chat.rejected", { name: escapeHTML(type.name) }) });
        return;
      }
      await scene.update({ flags: { [ID]: { roadOrders: orders } } });
      await ChatMessage.create({
        speaker: speaker(),
        content: t("SIEDLUNG.roads.chat.ordered", { user: escapeHTML(user.name), count: accepted, name: escapeHTML(type.name) })
      });
      return;
    }

    // Entfernen: fertige Wege verschwinden, Aufträge werden abgebrochen
    let roads = getRoads(scene);
    const orders = getRoadOrders(scene);
    const want = new Set(cells.map(([x, y]) => `${x},${y}`));
    const kept = orders.filter(o => !want.has(`${o.x},${o.y}`));
    let removed = orders.length - kept.length;
    for (const [x, y] of cells) {
      if (roadAt(roads, x, y) !== null) {
        roads = setRoad(roads, x, y, null);
        removed++;
      }
    }
    if (!removed) return;
    await scene.update({ flags: { [ID]: { roads, roadOrders: kept } } });
    await ChatMessage.create({ speaker: speaker(), content: t("SIEDLUNG.roads.chat.removed", { user: escapeHTML(user.name), count: removed }) });
  });
}

/** Entfernt Wege und Aufträge unter Gebäuden und auf nicht baubarem Gelände (z. B. nach neuer Geländeform). */
export function pruneScene(scene: any): Promise<void> {
  return enqueue(async () => {
    if (!isSettlementScene(scene)) return;
    const roads = getRoads(scene);
    const orders = getRoadOrders(scene);
    if (!orders.length && !/[^.]/.test(roads.cells)) return;
    const taken = buildingCells(scene);
    const terrain = getTerrain(scene);
    const result = pruneRoads(roads, orders, (x, y) => taken.has(`${x},${y}`) || !TERRAIN[terrainAt(terrain, x, y)]?.buildable);
    if (result) await scene.update({ flags: { [ID]: { roads: result.roads, roadOrders: result.orders } } });
  });
}

// Wegabschnitte verschwinden automatisch, wenn ein Gebäude auf ihr Feld kommt oder das Gelände dort nicht mehr baubar ist
Hooks.on("updateScene", (scene: any, changes: any) => {
  if (game.user !== game.users.activeGM) return;
  const flags = changes.flags?.[ID];
  if (!flags || typeof flags !== "object") return;
  if ("buildings" in flags || "terrain" in flags) void pruneScene(scene);
});

