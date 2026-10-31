import { ID, GOLD_ID } from "./constants";
import { DEFAULT_DEFINITIONS } from "./data";
import { DEFAULT_STATS } from "./stat-defaults";
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import { normalizeTerrain } from "./terrain-defs";
import { normalizeLawCategories, normalizeLaws } from "./laws";
import { normalizeTriggers } from "./triggers";
import { normalizeRoadTypes } from "./roads";
import { normalizeShortage } from "./shortage";
import { defaultRoadsFor } from "./road-defaults";
import { DEFAULT_LAWS, DEFAULT_LAW_CATEGORIES } from "./law-defaults";
import type { BuildingType, Category, CostEntry, CostKind, Definitions, PricedType, StatEffect, StatType, TerrainEntry, Law, LawCategory, EffectEntry, Trigger, RoadType } from "./types";

export const SETTING_DEFINITIONS = "definitions";

/**
 * Aktuelle Definitionen (Welt-Einstellung; für alle lesbar, nur von der SL änderbar). Nur lesen, nicht verändern.
 * Fehlende Teile (z. B. aus älteren Speicherständen) werden durch Standardwerte bzw. leere Kosten ergänzt.
 */
export function getDefinitions(): Required<Definitions> {
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
  const resources = list(raw?.resources, DEFAULT_DEFINITIONS.resources).map(r => {
    const { shortage, ...rest } = r;
    const rule = normalizeShortage(shortage, r.id);
    return rule ? { ...rest, shortage: rule } : rest;
  });
  const workers = list(raw?.workers, DEFAULT_DEFINITIONS.workers);
  return {
    categories: list(raw?.categories, DEFAULT_DEFINITIONS.categories),
    buildings,
    resources,
    workers,
    // Ältere Speicherstände ohne Stats bekommen die Standard-Stats
    stats: list(raw?.stats, DEFAULT_DEFINITIONS.stats ?? DEFAULT_STATS),
    terrain: normalizeTerrain(raw?.terrain),
    // Fehlen Gesetze ganz (ältere Speicherstände), gilt das mitgelieferte Beispiel; eine leere Liste bleibt leer
    lawCategories: Array.isArray(raw?.lawCategories) ? normalizeLawCategories(raw?.lawCategories) : structuredClone(DEFAULT_LAW_CATEGORIES),
    laws: Array.isArray(raw?.laws) ? normalizeLaws(raw?.laws) : structuredClone(DEFAULT_LAWS),
    triggers: normalizeTriggers(raw?.triggers),
    // Fehlen Wegarten ganz (ältere Speicherstände), gelten die mitgelieferten; eine leere Liste bleibt leer
    roads: Array.isArray(raw?.roads) ? normalizeRoadTypes(raw?.roads) : defaultRoadsFor(new Set(resources.map(r => r.id)), new Set(workers.map(w => w.id)))
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
export const getLawCategories = (): LawCategory[] => getDefinitions().lawCategories;
export const getLaws = (): Law[] => getDefinitions().laws;
export const getRoadTypes = (): RoadType[] => getDefinitions().roads;
export const getTriggers = (): Trigger[] => getDefinitions().triggers;
export const getTerrainTypes = (): TerrainEntry[] => getDefinitions().terrain;

export const assetKey = (kind: CostKind): "resources" | "workers" => (kind === "resource" ? "resources" : "workers");

export const getAsset = (kind: CostKind, id: string): PricedType | undefined =>
  getDefinitions()[assetKey(kind)].find(a => a.id === id);

export const isGold = (kind: CostKind, id: string): boolean => kind === "resource" && id === GOLD_ID;

const KIND_RANK: Record<string, number> = { resource: 0, worker: 1, stat: 2 };

/** Sortierwert nach der Reihenfolge der Definitionen: erst Ressourcen, dann Arbeiter, dann Werte, jeweils in Listenreihenfolge. */
export function orderIndex(kind: string, id: string): number {
  const defs = getDefinitions();
  const list = kind === "resource" ? defs.resources : kind === "worker" ? defs.workers : defs.stats;
  const i = list.findIndex(a => a.id === id);
  return (KIND_RANK[kind] ?? 3) * 100000 + (i < 0 ? 99999 : i);
}

/** Sortiert Posten (Kosten, Wirkungen) nach der Reihenfolge der Definitionen; die Eingabe bleibt unverändert. */
export function sortEntries<T extends { kind: string; id: string }>(entries: T[]): T[] {
  const keyed = entries.map(e => ({ e, k: orderIndex(e.kind, e.id) }));
  return keyed.sort((a, b) => a.k - b.k).map(x => x.e);
}

/** Kosten für die Anzeige: Name und Farbe aufgelöst, unbekannte Einträge übersprungen. */
export function costChips(entries: CostEntry[]): { name: string; color: string; amount: number; text: string }[] {
  const defs = getDefinitions();
  const chips: { name: string; color: string; amount: number; text: string }[] = [];
  for (const e of sortEntries(entries)) {
    const asset = defs[assetKey(e.kind)].find(a => a.id === e.id);
    // Negative Mengen (Betriebskosten) bedeuten Produktion und werden mit "+" angezeigt
    if (asset) chips.push({ name: asset.name, color: asset.color, amount: e.amount, text: e.amount < 0 ? `+${-e.amount}` : String(e.amount) });
  }
  return chips;
}

/** SL: ändert eine Kopie der Definitionen und speichert sie. */
export async function saveDefinitions(mutate: (defs: Required<Definitions>) => void): Promise<void> {
  if (!game.user.isGM) return;
  const defs: Required<Definitions> = foundry.utils.deepClone(getDefinitions());
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

/** Einträge von Effekten und Ausprägungen für die Anzeige: Name, Farbe (nur Ressourcen/Arbeiter), Vorzeichen-Text. */
export function entryChips(entries: EffectEntry[]): { name: string; color: string; text: string; perWeek: boolean }[] {
  return sortEntries(entries).map(e => {
    const target = e.kind === "stat" ? getStats().find(s => s.id === e.id) : getAsset(e.kind, e.id);
    return {
      name: target?.name ?? e.id,
      color: e.kind === "stat" ? "" : ((target as { color?: string } | undefined)?.color ?? "#888"),
      text: e.amount > 0 ? `+${e.amount}` : `−${-e.amount}`,
      perWeek: e.kind === "resource"
    };
  });
}
