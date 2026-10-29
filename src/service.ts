import { ID, SOCKET, STATUS } from "./constants";
import { getBuildings, getType, canonical, checkPlacement, isSettlementScene } from "./store";
import type { Building, Cell, OrderMessage } from "./types";

const t = (key: string, data?: Record<string, string>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const speaker = () => ({ alias: t("SIEDLUNG.title") });

/** Spieler/SL: Auftrag stellen. Spieler schicken ihn per Socket an die aktive SL. */
export function requestOrder(typeId: string, cells: Cell[]): void {
  if (!isSettlementScene()) return;
  const msg: OrderMessage = { action: "order", sceneId: canvas.scene.id, typeId, cells, userId: game.user.id };
  if (game.user.isGM) {
    void handleOrder(msg);
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.error(t("SIEDLUNG.errors.noGM"));
    return;
  }
  game.socket.emit(SOCKET, msg);
}

export function registerSocket(): void {
  game.socket.on(SOCKET, (msg: OrderMessage | undefined) => {
    if (game.user !== game.users.activeGM) return;
    if (msg?.action === "order") void handleOrder(msg);
  });
}

/** Läuft nur auf dem Client der aktiven SL und prüft alles erneut. */
async function handleOrder({ sceneId, typeId, cells, userId }: OrderMessage): Promise<void> {
  const scene = game.scenes.get(sceneId);
  const type = getType(typeId);
  const user = game.users.get(userId);
  if (!scene || !type || !user || !isSettlementScene(scene)) return;
  const valid =
    Array.isArray(cells) &&
    cells.length === type.cells.length &&
    cells.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger));
  if (!valid || canonical(cells) !== canonical(type.cells)) return;

  const res = checkPlacement(scene, cells);
  if (!res.ok) {
    await ChatMessage.create({
      whisper: [userId],
      speaker: speaker(),
      content: t("SIEDLUNG.chat.rejected", { name: type.name, reason: t(res.reason!) })
    });
    return;
  }

  const buildings: Building[] = foundry.utils.deepClone(getBuildings(scene));
  buildings.push({
    id: foundry.utils.randomID(),
    typeId: type.id,
    name: type.name,
    category: type.category,
    cells,
    status: STATUS.ORDERED
  });
  await scene.setFlag(ID, "buildings", buildings);
  await ChatMessage.create({ speaker: speaker(), content: t("SIEDLUNG.chat.ordered", { user: user.name, name: type.name }) });
}

export async function completeBuilding(id: string): Promise<void> {
  if (!game.user.isGM) return;
  const buildings: Building[] = foundry.utils.deepClone(getBuildings());
  const b = buildings.find(x => x.id === id);
  if (!b || b.status === STATUS.DONE) return;
  b.status = STATUS.DONE;
  await canvas.scene.setFlag(ID, "buildings", buildings);
  await ChatMessage.create({ speaker: speaker(), content: t("SIEDLUNG.chat.completed", { name: b.name }) });
}

export async function removeBuilding(id: string): Promise<void> {
  if (!game.user.isGM) return;
  const buildings = getBuildings().filter(x => x.id !== id);
  await canvas.scene.setFlag(ID, "buildings", buildings);
}

/** SL: erstellt eine leere Szene mit Quadratraster, 1 Feld = 5 m. */
export async function createSettlementScene(): Promise<void> {
  if (!game.user.isGM) return;
  const input = (name: string, label: string, value: string | number, extra = ""): string =>
    `<div class="form-group"><label>${label}</label><input name="${name}" value="${value}" ${extra}></div>`;
  const result: { name: string; cols: number; rows: number } | null = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("SIEDLUNG.tools.createScene") },
    content:
      input("sceneName", t("SIEDLUNG.scene.name"), "Siedlung") +
      input("cols", t("SIEDLUNG.scene.cols"), 40, 'type="number" min="5" max="200"') +
      input("rows", t("SIEDLUNG.scene.rows"), 30, 'type="number" min="5" max="200"'),
    ok: {
      label: t("SIEDLUNG.scene.create"),
      callback: (_event: Event, button: any) => ({
        name: button.form.elements.namedItem("sceneName").value || "Siedlung",
        cols: Number(button.form.elements.namedItem("cols").value) || 40,
        rows: Number(button.form.elements.namedItem("rows").value) || 30
      })
    },
    rejectClose: false
  });
  if (!result) return;
  const size = 100;
  const scene = await Scene.create({
    name: result.name,
    width: result.cols * size,
    height: result.rows * size,
    padding: 0,
    grid: { type: CONST.GRID_TYPES.SQUARE, size, distance: 5, units: "m" },
    background: { color: "#4a5d3a" },
    tokenVision: false,
    flags: { [ID]: { enabled: true } }
  });
  await scene.view();
}

/** SL: markiert die aktuelle Szene als Siedlungsszene bzw. entfernt die Markierung. */
export async function toggleSettlementScene(): Promise<void> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene) return;
  const enable = !isSettlementScene(scene);
  if (enable && scene.grid.type !== CONST.GRID_TYPES.SQUARE) {
    ui.notifications.error(t("SIEDLUNG.errors.noSquareGrid"));
    return;
  }
  if (enable && scene.padding) ui.notifications.warn(t("SIEDLUNG.errors.padding"));
  await scene.setFlag(ID, "enabled", enable);
}
