import { ID } from "./constants";
import { DEFAULT_DEFINITIONS } from "./data";
import type { BuildingType, Category, Definitions } from "./types";

export const SETTING_DEFINITIONS = "definitions";

/** Aktuelle Definitionen (Welt-Einstellung; für alle lesbar, nur von der SL änderbar). Nur lesen, nicht verändern. */
export function getDefinitions(): Definitions {
  const raw = game.settings.get(ID, SETTING_DEFINITIONS) as Partial<Definitions> | undefined;
  return {
    categories: Array.isArray(raw?.categories) ? raw.categories : DEFAULT_DEFINITIONS.categories,
    buildings: Array.isArray(raw?.buildings) ? raw.buildings : DEFAULT_DEFINITIONS.buildings
  };
}

export const getCategories = (): Category[] => getDefinitions().categories;
export const getBuildingTypes = (): BuildingType[] => getDefinitions().buildings;
export const getCategory = (id: string): Category | undefined => getCategories().find(c => c.id === id);

/** SL: ändert eine Kopie der Definitionen und speichert sie. */
export async function saveDefinitions(mutate: (defs: Definitions) => void): Promise<void> {
  if (!game.user.isGM) return;
  const defs: Definitions = foundry.utils.deepClone(getDefinitions());
  mutate(defs);
  await game.settings.set(ID, SETTING_DEFINITIONS, defs);
}

export async function resetDefinitions(): Promise<void> {
  if (!game.user.isGM) return;
  await game.settings.set(ID, SETTING_DEFINITIONS, foundry.utils.deepClone(DEFAULT_DEFINITIONS));
}
