import { ID, SOCKET, STATUS } from "./constants";
import { getBuildings, getType, isSettlementScene } from "./store";
import { completeBuilding, removeBuilding } from "./service";
import { escapeHTML, sanitizeName } from "./util";
import type { Building, BuildingActionMessage } from "./types";

const t = (key: string, data?: Record<string, string>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const speaker = () => ({ alias: t("SIEDLUNG.title") });

function send(msg: BuildingActionMessage): void {
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

/** Alle Nutzer: Gebäude umbenennen. */
export function requestRename(buildingId: string, name: string): void {
  send({ action: "rename", sceneId: canvas.scene.id, buildingId, name, userId: game.user.id });
}

/** Alle Nutzer: Gebäude abreißen bzw. den Bau abbrechen. */
export function requestRemove(buildingId: string): void {
  send({ action: "remove", sceneId: canvas.scene.id, buildingId, userId: game.user.id });
}

/** SL: schließt den Bau sofort ab. */
export function requestComplete(buildingId: string): void {
  if (game.user.isGM) void completeBuilding(buildingId);
}

/** Empfängt Aktionen der Spieler; nur die aktive SL führt sie aus. */
export function registerActionSocket(): void {
  game.socket.on(SOCKET, (msg: BuildingActionMessage | undefined) => {
    if (game.user !== game.users.activeGM) return;
    if (msg?.action === "rename" || msg?.action === "remove") void handle(msg);
  });
}

/** Läuft nur auf dem Client der aktiven SL und prüft alles erneut. */
async function handle(msg: BuildingActionMessage): Promise<void> {
  const scene = game.scenes.get(msg.sceneId);
  const user = game.users.get(msg.userId);
  if (!scene || !user || !isSettlementScene(scene)) return;
  const building = getBuildings(scene).find(b => b.id === msg.buildingId);
  if (!building) return;

  if (msg.action === "rename") {
    const fallback = getType(building.typeId)?.name ?? building.name;
    const name = sanitizeName(msg.name, fallback);
    if (name === building.name) return;
    const buildings: Building[] = foundry.utils.deepClone(getBuildings(scene));
    const target = buildings.find(b => b.id === msg.buildingId);
    if (target) target.name = name;
    await scene.setFlag(ID, "buildings", buildings);
    return;
  }

  // Abriss bzw. Abbruch arbeitet auf der aktuell angezeigten Szene der SL
  if (canvas.scene?.id !== scene.id) {
    await ChatMessage.create({ whisper: [user.id], speaker: speaker(), content: t("SIEDLUNG.errors.otherScene") });
    return;
  }
  const key = building.status === STATUS.DONE ? "SIEDLUNG.chat.demolishedBy" : "SIEDLUNG.chat.cancelledBy";
  const content = t(key, { user: escapeHTML(user.name), name: escapeHTML(building.name) });
  await removeBuilding(building.id);
  await ChatMessage.create({ speaker: speaker(), content });
}
