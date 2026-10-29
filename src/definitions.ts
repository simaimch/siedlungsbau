import { ID, GOLD_ID } from "./constants";
import { DEFAULT_DEFINITIONS } from "./data";
import type { BuildingType, Category, CostEntry, CostKind, Definitions, PricedType } from "./types";

export const SETTING_DEFINITIONS = "definitions";

/**
 * Aktuelle Definitionen (Welt-Einstellung; für alle lesbar, nur von der SL änderbar). Nur lesen, nicht verändern.
 * Fehlende Teile (z. B. aus älteren Speicherständen) werden durch Standardwerte bzw. leere Kosten ergänzt.
 */
export function getDefinitions(): Definitions {
  const raw = game.settings.get(ID, SETTING_DEFINITIONS) as Partial<Definitions> | undefined;
  const list = <T>(value: T[] | undefined, fallback: T[]): T[] => (Array.isArray(value) ? value : fallback);
  const buildings: BuildingType[] = list(raw?.buildings, DEFAULT_DEFINITIONS.buildings).map(b => ({
    id: b.id,
    name: b.name,
    category: b.category,
    cells: b.cells,
    buildCost: list(b.buildCost, []),
    upkeep: list(b.upkeep, [])
  }));
  return {
    categories: list(raw?.categories, DEFAULT_DEFINITIONS.categories),
    buildings,
    resources: list(raw?.resources, DEFAULT_DEFINITIONS.resources),
    workers: list(raw?.workers, DEFAULT_DEFINITIONS.workers)
  };
}

export const getCategories = (): Category[] => getDefinitions().categories;
export const getBuildingTypes = (): BuildingType[] => getDefinitions().buildings;
export const getCategory = (id: string): Category | undefined => getCategories().find(c => c.id === id);
export const getResources = (): PricedType[] => getDefinitions().resources;
export const getWorkers = (): PricedType[] => getDefinitions().workers;

export const assetKey = (kind: CostKind): "resources" | "workers" => (kind === "resource" ? "resources" : "workers");

export const getAsset = (kind: CostKind, id: string): PricedType | undefined =>
  getDefinitions()[assetKey(kind)].find(a => a.id === id);

export const isGold = (kind: CostKind, id: string): boolean => kind === "resource" && id === GOLD_ID;

/** Kosten für die Anzeige: Name und Farbe aufgelöst, unbekannte Einträge übersprungen. */
export function costChips(entries: CostEntry[]): { name: string; color: string; amount: number }[] {
  const defs = getDefinitions();
  const chips: { name: string; color: string; amount: number }[] = [];
  for (const e of entries) {
    const asset = defs[assetKey(e.kind)].find(a => a.id === e.id);
    if (asset) chips.push({ name: asset.name, color: asset.color, amount: e.amount });
  }
  return chips;
}

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
