// Reine Logik für Export und Import der Definitionen (ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { GOLD_ID } from "./constants";
import { DEFAULT_DEFINITIONS } from "./data";
import { isConnected, transformCells } from "./store";
import type { BuildingType, Category, Cell, CostEntry, Definitions, PricedType } from "./types";

export const FORMAT_VERSION = 1;

export type SectionKey = "categories" | "resources" | "workers" | "buildings";

/** Reihenfolge, in der Bereiche exportiert und angewendet werden. */
export const SECTIONS: SectionKey[] = ["categories", "resources", "workers", "buildings"];

export const SECTION_LABELS: Record<SectionKey, string> = {
  categories: "Kategorien",
  resources: "Ressourcen",
  workers: "Arbeiter",
  buildings: "Gebäude"
};

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_SHAPE = 50;

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** Formatiertes JSON; Rasterfelder ([x, y]) stehen dabei jeweils in einer Zeile. */
export function exportDefinitions(defs: Definitions): string {
  const json = JSON.stringify(
    { version: FORMAT_VERSION, categories: defs.categories, resources: defs.resources, workers: defs.workers, buildings: defs.buildings },
    null,
    2
  );
  return json.replace(/\[\s*(-?\d+),\s*(-?\d+)\s*\]/g, "[$1, $2]");
}

/* ------------------------------------------------------------------ */
/* Import: Einlesen und Prüfen                                         */
/* ------------------------------------------------------------------ */

export interface ParsedImport {
  /** Nur die im Import vorhandenen Bereiche. */
  data: Partial<Definitions>;
  errors: string[];
}

type Parsed<T> = T | string; // string = Fehlermeldung

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function parseCategory(raw: unknown): Parsed<Category> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const label = text(raw.label, 40);
  if (!id) return "„id“ fehlt.";
  if (!label) return "„label“ fehlt.";
  if (typeof raw.color !== "string" || !HEX.test(raw.color)) return "„color“ muss das Format #rrggbb haben.";
  return { id, label, color: raw.color };
}

function parseAsset(raw: unknown): Parsed<PricedType> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const name = text(raw.name, 40);
  if (!id) return "„id“ fehlt.";
  if (!name) return "„name“ fehlt.";
  if (typeof raw.color !== "string" || !HEX.test(raw.color)) return "„color“ muss das Format #rrggbb haben.";
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value < 0) return "„value“ muss eine Zahl ≥ 0 sein.";
  return { id, name, color: raw.color, value: Math.round(raw.value * 100) / 100 };
}

function parseCosts(raw: unknown, field: string, allowNegative: boolean): Parsed<CostEntry[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return `„${field}“ muss eine Liste sein.`;
  const out: CostEntry[] = [];
  for (const e of raw) {
    if (!isObj(e)) return `„${field}“ enthält einen ungültigen Posten.`;
    const id = text(e.id, 100);
    if (e.kind !== "resource" && e.kind !== "worker") return `„${field}“: „kind“ muss „resource“ oder „worker“ sein.`;
    if (!id) return `„${field}“: „id“ fehlt.`;
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount)) return `„${field}“: „amount“ muss eine Zahl sein.`;
    const amount = Math.round(e.amount);
    if (amount === 0) return `„${field}“: „amount“ darf nicht 0 sein.`;
    if (amount < 0 && !allowNegative) return `„${field}“: negative Mengen sind nur bei „upkeep“ erlaubt.`;
    out.push({ kind: e.kind, id, amount });
  }
  return out;
}

function parseBuilding(raw: unknown): Parsed<BuildingType> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const name = text(raw.name, 60);
  const category = text(raw.category, 100);
  if (!id) return "„id“ fehlt.";
  if (!name) return "„name“ fehlt.";
  if (!category) return "„category“ fehlt.";
  if (!Array.isArray(raw.cells) || !raw.cells.length) return "„cells“ fehlt oder ist leer.";

  const unique = new Map<string, Cell>();
  for (const c of raw.cells) {
    if (!Array.isArray(c) || c.length !== 2 || !c.every(Number.isInteger)) return "„cells“ enthält ein ungültiges Feld (erwartet [x, y] mit ganzen Zahlen).";
    unique.set(`${c[0]},${c[1]}`, [c[0], c[1]]);
  }
  const cells = transformCells([...unique.values()], 0, false); // verschiebt auf den Ursprung
  if (!isConnected(cells)) return "Die Felder in „cells“ hängen nicht über Kanten zusammen.";
  if (Math.max(...cells.map(c => c[0])) >= MAX_SHAPE || Math.max(...cells.map(c => c[1])) >= MAX_SHAPE) return `Die Form ist größer als ${MAX_SHAPE}×${MAX_SHAPE} Felder.`;

  const buildCost = parseCosts(raw.buildCost, "buildCost", false);
  if (typeof buildCost === "string") return buildCost;
  const upkeep = parseCosts(raw.upkeep, "upkeep", true);
  if (typeof upkeep === "string") return upkeep;
  return { id, name, category, cells, buildCost, upkeep };
}

function parseSection<T extends { id: string }>(key: SectionKey, raw: unknown, parse: (e: unknown) => Parsed<T>, errors: string[]): T[] | undefined {
  const label = SECTION_LABELS[key];
  if (!Array.isArray(raw)) {
    errors.push(`${label} („${key}“): muss eine Liste sein.`);
    return undefined;
  }
  const out: T[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, i) => {
    const r = parse(entry);
    if (typeof r === "string") errors.push(`${label} #${i + 1}: ${r}`);
    else if (ids.has(r.id)) errors.push(`${label} #${i + 1}: Die ID „${r.id}“ kommt mehrfach vor.`);
    else {
      ids.add(r.id);
      out.push(r);
    }
  });
  return out;
}

/** Liest einen Import ein. Bereiche, die fehlen, werden übersprungen; ungültige Einträge verhindern den Import. */
export function parseImport(input: string): ParsedImport {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (err) {
    return { data: {}, errors: [`Kein gültiges JSON: ${(err as Error).message}`] };
  }
  if (!isObj(raw)) return { data: {}, errors: ["Der Import muss ein JSON-Objekt sein."] };

  const data: Partial<Definitions> = {};
  const parsers = { categories: parseCategory, resources: parseAsset, workers: parseAsset, buildings: parseBuilding } as const;
  for (const key of SECTIONS) {
    if (raw[key] === undefined) continue;
    const list = parseSection(key, raw[key], parsers[key] as (e: unknown) => Parsed<{ id: string }>, errors);
    if (list) (data as Record<string, unknown>)[key] = list;
  }
  if (!errors.length && !Object.keys(data).length) {
    errors.push("Der Import enthält keinen bekannten Bereich (categories, resources, workers, buildings).");
  }
  return { data, errors };
}

/* ------------------------------------------------------------------ */
/* Import: Abgleich und Anwendung                                      */
/* ------------------------------------------------------------------ */

export interface MissingEntry {
  section: SectionKey;
  id: string;
  name: string;
}

const nameOf = (key: SectionKey, e: Category | PricedType | BuildingType): string =>
  key === "categories" ? (e as Category).label : (e as PricedType | BuildingType).name;

/**
 * Bestehende Einträge, die im Import fehlen – nur in Bereichen, die der Import enthält.
 * Die Goldmünzen sind unlöschbar und werden deshalb nicht als fehlend gemeldet.
 */
export function findMissing(current: Definitions, imported: Partial<Definitions>): MissingEntry[] {
  const missing: MissingEntry[] = [];
  for (const key of SECTIONS) {
    const incoming = imported[key] as { id: string }[] | undefined;
    if (!incoming) continue;
    const ids = new Set(incoming.map(e => e.id));
    for (const e of current[key] as (Category | PricedType | BuildingType)[]) {
      if (ids.has(e.id) || (key === "resources" && e.id === GOLD_ID)) continue;
      missing.push({ section: key, id: e.id, name: nameOf(key, e) });
    }
  }
  return missing;
}

/** "replace": Bereiche des Imports ersetzen die bestehenden (fehlende Einträge werden gelöscht). "merge": nach ID zusammenführen. */
export type ImportMode = "replace" | "merge";

export interface Cleanup {
  /** Kostenposten, die auf nicht mehr vorhandene Ressourcen oder Arbeiter verwiesen */
  costEntries: number;
  /** Gebäude, deren Kategorie nicht (mehr) existiert */
  removedBuildings: string[];
  /** Goldmünzen wurden wiederhergestellt, weil der Import sie nicht enthielt */
  restoredGold: boolean;
}

export interface ApplyResult {
  defs: Definitions;
  cleanup: Cleanup;
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const out = existing.slice();
  for (const e of incoming) {
    const i = out.findIndex(x => x.id === e.id);
    if (i >= 0) out[i] = e;
    else out.push(e);
  }
  return out;
}

export function applyImport(current: Definitions, imported: Partial<Definitions>, mode: ImportMode): ApplyResult {
  const next: Definitions = structuredClone(current);
  for (const key of SECTIONS) {
    const incoming = imported[key] as { id: string }[] | undefined;
    if (!incoming) continue;
    const copy = structuredClone(incoming);
    (next as unknown as Record<string, unknown>)[key] = mode === "replace" ? copy : mergeById(next[key] as { id: string }[], copy);
  }

  // Goldmünzen sind die Basiswährung: immer vorhanden, Marktwert 1
  let restoredGold = false;
  if (!next.resources.some(r => r.id === GOLD_ID)) {
    const gold = current.resources.find(r => r.id === GOLD_ID) ?? DEFAULT_DEFINITIONS.resources.find(r => r.id === GOLD_ID);
    if (gold) {
      next.resources.unshift(structuredClone(gold));
      restoredGold = true;
    }
  }
  const gold = next.resources.find(r => r.id === GOLD_ID);
  if (gold) gold.value = 1;

  // Bereinigen: Verweise auf nicht (mehr) vorhandene Einträge entfernen
  const categoryIds = new Set(next.categories.map(c => c.id));
  const resourceIds = new Set(next.resources.map(r => r.id));
  const workerIds = new Set(next.workers.map(w => w.id));
  const removedBuildings: string[] = [];
  next.buildings = next.buildings.filter(b => {
    if (categoryIds.has(b.category)) return true;
    removedBuildings.push(b.name);
    return false;
  });
  let costEntries = 0;
  for (const b of next.buildings) {
    for (const list of ["buildCost", "upkeep"] as const) {
      const kept = b[list].filter(e => (e.kind === "resource" ? resourceIds : workerIds).has(e.id));
      costEntries += b[list].length - kept.length;
      b[list] = kept;
    }
  }
  return { defs: next, cleanup: { costEntries, removedBuildings, restoredGold } };
}
