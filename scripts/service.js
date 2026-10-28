import { ID, SOCKET, STATUS } from "./constants.js";
import { getBuildings, getType, canonical, checkPlacement } from "./store.js";

const t = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const speaker = () => ({ alias: t("SIEDLUNG.title") });

/** Spieler/SL: Auftrag stellen. Spieler schicken ihn per Socket an die aktive SL. */
export function requestOrder(typeId, cells) {
  const msg = { action: "order", sceneId: canvas.scene.id, typeId, cells, userId: game.user.id };
  if (game.user.isGM) return handleOrder(msg);
  if (!game.users.activeGM) return ui.notifications.error(t("SIEDLUNG.errors.noGM"));
  game.socket.emit(SOCKET, msg);
}

export function registerSocket() {
  game.socket.on(SOCKET, msg => {
    if (game.user !== game.users.activeGM) return;
    if (msg?.action === "order") handleOrder(msg);
  });
}

/** Läuft nur auf dem Client der aktiven SL und prüft alles erneut. */
async function handleOrder({ sceneId, typeId, cells, userId }) {
  const scene = game.scenes.get(sceneId);
  const type = getType(typeId);
  const user = game.users.get(userId);
  if (!scene || !type || !user) return;
  const valid = Array.isArray(cells) && cells.length === type.cells.length
    && cells.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger));
  if (!valid || canonical(cells) !== canonical(type.cells)) return;

  const res = checkPlacement(scene, cells);
  if (!res.ok) {
    return ChatMessage.create({
      whisper: [userId],
      speaker: speaker(),
      content: t("SIEDLUNG.chat.rejected", { name: type.name, reason: t(res.reason) })
    });
  }

  const buildings = foundry.utils.deepClone(getBuildings(scene));
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

export async function completeBuilding(id) {
  if (!game.user.isGM) return;
  const buildings = foundry.utils.deepClone(getBuildings());
  const b = buildings.find(x => x.id === id);
  if (!b || b.status === STATUS.DONE) return;
  b.status = STATUS.DONE;
  await canvas.scene.setFlag(ID, "buildings", buildings);
  await ChatMessage.create({ speaker: speaker(), content: t("SIEDLUNG.chat.completed", { name: b.name }) });
}

export async function removeBuilding(id) {
  if (!game.user.isGM) return;
  const buildings = getBuildings().filter(x => x.id !== id);
  await canvas.scene.setFlag(ID, "buildings", buildings);
}

/** SL: erstellt eine leere Szene mit Quadratraster, 1 Feld = 5 m. */
export async function createSettlementScene() {
  if (!game.user.isGM) return;
  const input = (name, label, value, extra = "") =>
    `<div class="form-group"><label>${label}</label><input name="${name}" value="${value}" ${extra}></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("SIEDLUNG.tools.createScene") },
    content: input("sceneName", t("SIEDLUNG.scene.name"), "Siedlung")
      + input("cols", t("SIEDLUNG.scene.cols"), 40, 'type="number" min="5" max="200"')
      + input("rows", t("SIEDLUNG.scene.rows"), 30, 'type="number" min="5" max="200"'),
    ok: {
      label: t("SIEDLUNG.scene.create"),
      callback: (event, button) => ({
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
    tokenVision: false
  });
  await scene.view();
}
