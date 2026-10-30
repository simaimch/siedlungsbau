import { ID, GOLD_ID } from "./constants";
import { DEFAULT_DEFINITIONS } from "./data";
import { DEFAULT_STATS } from "./stat-defaults";
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import { normalizeTerrain } from "./terrain-defs";
import type { BuildingType, Category, CostEntry, CostKind, Definitions, PricedType, StatEffect, StatType, TerrainEntry } from "./types";

export const SETTING_DEFINITIONS = "definitions";

/**
 * Aktuelle Definitionen (Welt-Einstellung; für alle lesbar, nur von der SL änderbar). Nur lesen, nicht verändern.
 * Fehlende Teile (z. B. aus älteren Speicherständen) werden durch Standardwerte bzw. leere Kosten ergänzt.
 */
export function getDefinitions(): Definitions {
  const raw = game.settings.get(ID, SETTING_DEFINITIONS) as Partial<Definitions> | undefined;
  const list = <T>(value: T[] | undefined, fallback: T[] | undefined): T[] => (Array.isArray(value) ? value : (fallback ?? []));
  const buildings: BuildingType[] = list(raw?.buildings, DEFAULT_DEFINITIONS.buildings).map(b => ({
    id: b.id,
    name: b.name,
    category: b.category,
    cells: b.cells,
    buildCost: list(b.buildCost, []),
    upkeep: list(b.upkeep, []),
    statEffects: list(b.statEffects, [])
  }));
  return {
    categories: list(raw?.categories, DEFAULT_DEFINITIONS.categories),
    buildings,
    resources: list(raw?.resources, DEFAULT_DEFINITIONS.resources),
    workers: list(raw?.workers, DEFAULT_DEFINITIONS.workers),
    // Ältere Speicherstände ohne Stats bekommen die Standard-Stats
    stats: list(raw?.stats, DEFAULT_DEFINITIONS.stats ?? DEFAULT_STATS),
    terrain: normalizeTerrain(raw?.terrain)
  };
}

export const getCategories = (): Category[] => getDefinitions().categories;
export const getBuildingTypes = (): BuildingType[] => getDefinitions().buildings;
export const getCategory = (id: string): Category | undefined => getCategories().find(c => c.id === id);
export const getResources = (): PricedType[] => getDefinitions().resources;
export const getWorkers = (): PricedType[] => getDefinitions().workers;
export const getStats = (): StatType[] => getDefinitions().stats;
/** Baugewicht je Ressource (fehlend = 1), für die Berechnung des Materialfortschritts. */
export const getWeights = (): Record<string, number> =>
  Object.fromEntries(getResources().map(r => [r.id, typeof r.weight === "number" && r.weight >= 0 ? r.weight : 1]));
export const getTerrainTypes = (): TerrainEntry[] => getDefinitions().terrain;

export const assetKey = (kind: CostKind): "resources" | "workers" => (kind === "resource" ? "resources" : "workers");

export const getAsset = (kind: CostKind, id: string): PricedType | undefined =>
  getDefinitions()[assetKey(kind)].find(a => a.id === id);

export const isGold = (kind: CostKind, id: string): boolean => kind === "resource" && id === GOLD_ID;

/** Kosten für die Anzeige: Name und Farbe aufgelöst, unbekannte Einträge übersprungen. */
export function costChips(entries: CostEntry[]): { name: string; color: string; amount: number; text: string }[] {
  const defs = getDefinitions();
  const chips: { name: string; color: string; amount: number; text: string }[] = [];
  for (const e of entries) {
    const asset = defs[assetKey(e.kind)].find(a => a.id === e.id);
    // Negative Mengen (Betriebskosten) bedeuten Produktion und werden mit "+" angezeigt
    if (asset) chips.push({ name: asset.name, color: asset.color, amount: e.amount, text: e.amount < 0 ? `+${-e.amount}` : String(e.amount) });
  }
  return chips;
}

/** SL: ändert eine Kopie der Definitionen und speichert sie. */
export async function saveDefinitions(mutate: (defs: Definitions) => void): Promise<void> {
  if (!game.user.isGM) return;
  const defs: Definitions = foundry.utils.deepClone(getDefinitions());
  mutate(defs);
  await commit(defs);
}

/** Speichert die Definitionen. Gelöschte Geländearten werden in allen Szenen durch das Standardgelände ersetzt. */
async function commit(next: Definitions): Promise<void> {
  const before = getTerrainTypes().map(e => e.id);
  next.terrain = normalizeTerrain(next.terrain);
  const after = new Set(next.terrain.map(e => e.id));
  await game.settings.set(ID, SETTING_DEFINITIONS, next);
  const removed = before.filter(id => !after.has(id));
  if (removed.length) await migrateRemovedTerrain(removed);
}

/** SL: Felder gelöschter Geländearten werden in allen Szenen zum Standardgelände. */
export async function migrateRemovedTerrain(ids: string[]): Promise<void> {
  if (!game.user.isGM) return;
  for (const scene of game.scenes) {
    const terrain = scene.getFlag(ID, "terrain");
    if (typeof terrain?.cells !== "string") continue;
    let cells: string = terrain.cells;
    for (const id of ids) cells = cells.split(id).join(DEFAULT_TERRAIN);
    if (cells !== terrain.cells) await scene.setFlag(ID, "terrain", { ...terrain, cells });
  }
}

/**
 * Gleicht das globale TERRAIN-Objekt (data.ts) mit den Einstellungen ab, damit alle Stellen,
 * die TERRAIN lesen (Rendering, Bauprüfung, Gelände-Generator), die Arten der SL sehen.
 */
export function syncTerrain(): void {
  for (const key of Object.keys(TERRAIN)) delete TERRAIN[key];
  for (const e of getTerrainTypes()) TERRAIN[e.id] = { label: e.label, color: e.color, buildable: e.buildable };
}


export async function resetDefinitions(): Promise<void> {
  if (!game.user.isGM) return;
  await commit(foundry.utils.deepClone(DEFAULT_DEFINITIONS));
}

/** SL: ersetzt alle Definitionen auf einmal (Import). */
export async function replaceDefinitions(defs: Definitions): Promise<void> {
  if (!game.user.isGM) return;
  await commit(defs);
}

/** Wirkungen auf Werte für die Anzeige, z. B. "+2 Moral"; unbekannte Stats werden übersprungen. */
export function effectChips(effects: StatEffect[]): { name: string; text: string; once: boolean }[] {
  const stats = getStats();
  const chips: { name: string; text: string; once: boolean }[] = [];
  for (const e of effects) {
    const stat = stats.find(s => s.id === e.id);
    if (stat) chips.push({ name: stat.name, text: e.amount > 0 ? `+${e.amount}` : `−${-e.amount}`, once: e.mode === "once" });
  }
  return chips;
}
