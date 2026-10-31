import { ID, STATUS } from "./constants";
import { costsOf, getBuildings, getType } from "./store";
import { applyOnceEffects } from "./settlement";
import { escapeHTML } from "./util";
import type { Building } from "./types";

const norm = (list: unknown[] | undefined): string =>
  JSON.stringify([...(list ?? [])].map(e => JSON.stringify(Object.entries(e as object).sort(([a], [b]) => a.localeCompare(b)))).sort());

/** Ein Gebäude im Bau trägt beim Beauftragen festgehaltene Kosten und Wirkungen; hier: weichen sie von der Definition ab? */
export function differsFromDefinition(b: Building): boolean {
  if (b.status !== STATUS.ORDERED) return false;
  const type = getType(b.typeId);
  if (!type) return false;
  return (
    (b.buildCost !== undefined && norm(b.buildCost) !== norm(type.buildCost)) ||
    (b.upkeep !== undefined && norm(b.upkeep) !== norm(type.upkeep)) ||
    (b.statEffects !== undefined && norm(b.statEffects) !== norm(type.statEffects))
  );
}

/** SL: übernimmt Baukosten, Betrieb und Wirkungen der Definition für ein Gebäude im Bau (Fortschritt bleibt erhalten). */
export async function syncBuildingToDefinition(id: string): Promise<boolean> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene) return false;
  const buildings: Building[] = foundry.utils.deepClone(getBuildings(scene));
  const b = buildings.find(x => x.id === id);
  const type = b ? getType(b.typeId) : undefined;
  if (!b || !type || b.status !== STATUS.ORDERED) return false;
  b.buildCost = foundry.utils.deepClone(type.buildCost);
  b.upkeep = foundry.utils.deepClone(type.upkeep);
  b.statEffects = foundry.utils.deepClone(type.statEffects ?? []);
  await scene.setFlag(ID, "buildings", buildings);
  return true;
}

/**
 * SL: schaltet ein fertiges Gebäude ab bzw. wieder an. Abgeschaltete Gebäude haben weder Betrieb noch Wirkungen;
 * bereits angewendete einmalige Wirkungen auf Werte werden dabei zurückgenommen bzw. wieder angewendet.
 */
export async function setBuildingDisabled(id: string, disabled: boolean): Promise<void> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene) return;
  const buildings: Building[] = foundry.utils.deepClone(getBuildings(scene));
  const b = buildings.find(x => x.id === id);
  if (!b || b.status !== STATUS.DONE || !!b.disabled === disabled) return;
  if (disabled) b.disabled = true;
  else delete b.disabled;
  await scene.setFlag(ID, "buildings", buildings);
  const lines = await applyOnceEffects(costsOf(b).statEffects, disabled);
  const key = disabled ? "SIEDLUNG.chat.disabled" : "SIEDLUNG.chat.enabled";
  let content = game.i18n.format(key, { name: escapeHTML(b.name) });
  if (lines.length) content += `<ul>${lines.join("")}</ul>`;
  await ChatMessage.create({ speaker: { alias: game.i18n.localize("SIEDLUNG.title") }, content });
}
