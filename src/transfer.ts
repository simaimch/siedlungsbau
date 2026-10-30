// Reine Logik für Export und Import der Definitionen (ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { GOLD_ID } from "./constants";
import { DEFAULT_DEFINITIONS } from "./data";
import { isConnected, transformCells } from "./store";
import { COMPARE_OPS } from "./triggers";
import { sortedPoints, validateInterval } from "./stats";
import { BUILTIN_TERRAIN, normalizeTerrain } from "./terrain-defs";
import type { BuildingType, Category, Cell, CostEntry, Definitions, PricedType, StatEffect, StatPoint, StatType, TerrainEntry, Law, LawCategory, LawOption, CompareOp, EffectEntry, Trigger } from "./types";

export const FORMAT_VERSION = 1;

export type SectionKey = "categories" | "resources" | "workers" | "stats" | "terrain" | "lawCategories" | "laws" | "triggers" | "buildings";

/** Reihenfolge, in der Bereiche exportiert und angewendet werden. */
export const SECTIONS: SectionKey[] = ["categories", "resources", "workers", "stats", "terrain", "lawCategories", "laws", "triggers", "buildings"];

export const SECTION_LABELS: Record<SectionKey, string> = {
  categories: "Kategorien",
  resources: "Ressourcen",
  workers: "Arbeiter",
  stats: "Werte",
  terrain: "Gelände",
  lawCategories: "Gesetzeskategorien",
  laws: "Gesetze",
  triggers: "Trigger",
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
    { version: FORMAT_VERSION, categories: defs.categories, resources: defs.resources, workers: defs.workers, stats: defs.stats, terrain: defs.terrain ?? [], lawCategories: defs.lawCategories ?? [], laws: defs.laws ?? [], triggers: defs.triggers ?? [], buildings: defs.buildings },
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

function parseTerrain(raw: unknown): Parsed<TerrainEntry> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const label = text(raw.label, 40);
  if (!id) return "„id“ fehlt.";
  const builtin = BUILTIN_TERRAIN.some(b => b.id === id);
  if (!builtin && !/^[A-Za-z]$/.test(id)) return "„id“ muss ein einzelner Buchstabe sein.";
  if (!label) return "„label“ fehlt.";
  if (typeof raw.color !== "string" || !HEX.test(raw.color)) return "„color“ muss das Format #rrggbb haben.";
  if (typeof raw.buildable !== "boolean") return "„buildable“ muss true oder false sein.";
  return { id, label, color: raw.color, buildable: raw.buildable };
}

function parseLawCategory(raw: unknown): Parsed<LawCategory> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const label = text(raw.label, 40);
  if (!id) return "„id“ fehlt.";
  if (!label) return "„label“ fehlt.";
  return { id, label };
}

function parseEntries(raw: unknown, field: string): Parsed<EffectEntry[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return `„${field}“ muss eine Liste sein.`;
  const out: EffectEntry[] = [];
  for (const e of raw) {
    if (!isObj(e)) return `„${field}“ enthält einen ungültigen Eintrag.`;
    const id = text(e.id, 100);
    if (e.kind !== "resource" && e.kind !== "worker" && e.kind !== "stat") return `„${field}“: „kind“ muss „resource“, „worker“ oder „stat“ sein.`;
    if (!id) return `„${field}“: „id“ fehlt.`;
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount === 0) return `„${field}“: „amount“ muss eine Zahl ungleich 0 sein.`;
    out.push({ kind: e.kind, id, amount: e.kind === "stat" ? Math.round(e.amount * 100) / 100 : Math.round(e.amount) || (e.amount > 0 ? 1 : -1) });
  }
  return out;
}

function parseLaw(raw: unknown): Parsed<Law> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const name = text(raw.name, 60);
  const category = text(raw.category, 100);
  if (!id) return "„id“ fehlt.";
  if (!name) return "„name“ fehlt.";
  if (!category) return "„category“ fehlt.";
  if (!Array.isArray(raw.options) || !raw.options.length) return "„options“ muss mindestens eine Ausprägung enthalten.";
  const options: LawOption[] = [];
  const seen = new Set<string>();
  for (const o of raw.options) {
    if (!isObj(o)) return "„options“ enthält einen ungültigen Eintrag.";
    const oid = text(o.id, 100);
    const oname = text(o.name, 60);
    if (!oid || !oname) return "Eine Ausprägung braucht „id“ und „name“.";
    if (seen.has(oid)) return `Die Ausprägung „${oid}“ kommt doppelt vor.`;
    seen.add(oid);
    const entries = parseEntries(o.entries, "entries");
    if (typeof entries === "string") return entries;
    options.push({ id: oid, name: oname, entries });
  }
  const description = text(raw.description, 300);
  return { id, name, category, ...(description ? { description } : {}), options };
}

function parseTrigger(raw: unknown): Parsed<Trigger> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const name = text(raw.name, 60);
  if (!id) return "„id“ fehlt.";
  if (!name) return "„name“ fehlt.";
  if (!Array.isArray(raw.conditions) || !raw.conditions.length) return "„conditions“ muss mindestens eine Bedingung enthalten.";
  const conditions: Trigger["conditions"] = [];
  for (const c of raw.conditions) {
    if (!isObj(c)) return "„conditions“ enthält einen ungültigen Eintrag.";
    const cid = text(c.id, 100);
    if (c.kind !== "resource" && c.kind !== "worker" && c.kind !== "stat") return "„conditions“: „kind“ muss „resource“, „worker“ oder „stat“ sein.";
    if (!cid) return "„conditions“: „id“ fehlt.";
    if (!COMPARE_OPS.includes(c.op as CompareOp)) return "„conditions“: „op“ muss <, <=, >, >=, == oder != sein.";
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) return "„conditions“: „value“ muss eine Zahl sein.";
    conditions.push({ kind: c.kind, id: cid, op: c.op as CompareOp, value: Math.round(c.value * 100) / 100 });
  }
  const base = parseEntries(raw.entries, "entries");
  if (typeof base === "string") return base;
  if (!base.length) return "„entries“ muss mindestens eine Wirkung enthalten.";
  const rawEntries = raw.entries as Record<string, unknown>[];
  const entries: Trigger["entries"] = base.map((e, i) => (e.kind === "stat" && rawEntries[i].mode === "modifier" ? { ...e, mode: "modifier" as const } : e));
  const description = text(raw.description, 300);
  return {
    id, name, ...(description ? { description } : {}), conditions, entries,
    ...(raw.hidden === true ? { hidden: true } : {}), ...(raw.defaultOn === false ? { defaultOn: false } : {})
  };
}

function parseAsset(raw: unknown): Parsed<PricedType> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const name = text(raw.name, 40);
  if (!id) return "„id“ fehlt.";
  if (!name) return "„name“ fehlt.";
  if (typeof raw.color !== "string" || !HEX.test(raw.color)) return "„color“ muss das Format #rrggbb haben.";
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value < 0) return "„value“ muss eine Zahl ≥ 0 sein.";
  const out: PricedType = { id, name, color: raw.color, value: Math.round(raw.value * 100) / 100 };
  if (raw.weight !== undefined) {
    if (typeof raw.weight !== "number" || !Number.isFinite(raw.weight) || raw.weight < 0) return "„weight“ muss eine Zahl ≥ 0 sein.";
    out.weight = Math.round(raw.weight * 1000) / 1000;
  }
  return out;
}

const STAT_ERRORS = {
  range: "„min“ und „max“ müssen Zahlen sein, min < max.",
  pointRange: "Ein Stützpunkt liegt außerhalb von min/max.",
  pointName: "Ein Stützpunkt hat keinen Namen.",
  pointColor: "Ein Stützpunkt hat eine ungültige „color“ (erwartet #rrggbb).",
  pointDuplicate: "Zwei Stützpunkte haben denselben „value“."
} as const;

function parseStat(raw: unknown): Parsed<StatType> {
  if (!isObj(raw)) return "Kein Objekt.";
  const id = text(raw.id, 100);
  const name = text(raw.name, 40);
  if (!id) return "„id“ fehlt.";
  if (!name) return "„name“ fehlt.";
  if (raw.kind === "open") return { id, name, kind: "open" };
  if (raw.kind !== "interval") return "„kind“ muss „interval“ oder „open“ sein.";
  if (typeof raw.min !== "number" || typeof raw.max !== "number") return STAT_ERRORS.range;
  if (!Array.isArray(raw.points)) return "„points“ muss eine Liste sein.";

  const points: StatPoint[] = [];
  for (const p of raw.points) {
    if (!isObj(p) || typeof p.value !== "number" || typeof p.name !== "string" || typeof p.color !== "string") {
      return "Ein Stützpunkt ist ungültig (erwartet value, name, color).";
    }
    points.push({ value: Math.round(p.value * 100) / 100, name: p.name.trim().slice(0, 40), color: p.color });
  }
  const error = validateInterval(raw.min, raw.max, points);
  if (error) return STAT_ERRORS[error];
  return { id, name, kind: "interval", min: raw.min, max: raw.max, points: sortedPoints(points) };
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

function parseEffects(raw: unknown): Parsed<StatEffect[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return "„statEffects“ muss eine Liste sein.";
  const out: StatEffect[] = [];
  for (const e of raw) {
    if (!isObj(e)) return "„statEffects“ enthält einen ungültigen Eintrag.";
    const id = text(e.id, 100);
    if (!id) return "„statEffects“: „id“ fehlt.";
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount === 0) return "„statEffects“: „amount“ muss eine Zahl ungleich 0 sein.";
    if (e.mode !== undefined && e.mode !== "weekly" && e.mode !== "once") return "„statEffects“: „mode“ muss „weekly“ oder „once“ sein.";
    out.push({ id, amount: Math.round(e.amount * 100) / 100, mode: e.mode === "once" ? "once" : "weekly" });
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
  const statEffects = parseEffects(raw.statEffects);
  if (typeof statEffects === "string") return statEffects;
  return { id, name, category, cells, buildCost, upkeep, statEffects };
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
  const parsers = { categories: parseCategory, resources: parseAsset, workers: parseAsset, stats: parseStat, terrain: parseTerrain, lawCategories: parseLawCategory, laws: parseLaw, triggers: parseTrigger, buildings: parseBuilding } as const;
  for (const key of SECTIONS) {
    if (raw[key] === undefined) continue;
    const list = parseSection(key, raw[key], parsers[key] as (e: unknown) => Parsed<{ id: string }>, errors);
    if (list) (data as Record<string, unknown>)[key] = list;
  }
  if (!errors.length && !Object.keys(data).length) {
    errors.push("Der Import enthält keinen bekannten Bereich (categories, resources, workers, stats, terrain, lawCategories, laws, triggers, buildings).");
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

const nameOf = (key: SectionKey, e: Category | PricedType | BuildingType | StatType | TerrainEntry | LawCategory | Law | Trigger): string =>
  key === "categories" || key === "terrain" || key === "lawCategories" ? (e as Category | TerrainEntry | LawCategory).label : (e as PricedType | BuildingType | StatType | Law | Trigger).name;

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
    for (const e of (current[key] ?? []) as (Category | PricedType | BuildingType | StatType | TerrainEntry | LawCategory | Law | Trigger)[]) {
      // Goldmünzen und mitgelieferte Geländearten sind unlöschbar und gelten nicht als fehlend
      if (ids.has(e.id) || (key === "resources" && e.id === GOLD_ID) || (key === "terrain" && BUILTIN_TERRAIN.some(b => b.id === e.id))) continue;
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
  /** Wirkungen auf Werte, die nicht (mehr) existieren */
  statEffects: number;
  /** Gesetze, deren Kategorie nicht (mehr) existiert */
  removedLaws: string[];
  /** Einträge in Ausprägungen von Gesetzen, die auf nicht mehr vorhandene Ressourcen, Arbeiter oder Werte verwiesen */
  lawEntries: number;
  /** Trigger, die keine gültige Bedingung oder Wirkung mehr haben */
  removedTriggers: string[];
  /** Bedingungen und Wirkungen von Triggern, die auf nicht mehr vorhandene Einträge verwiesen */
  triggerParts: number;
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
    (next as unknown as Record<string, unknown>)[key] = mode === "replace" ? copy : mergeById((next[key] ?? []) as { id: string }[], copy);
  }

  // Mitgelieferte Geländearten bleiben immer erhalten
  next.terrain = normalizeTerrain(next.terrain);

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
  const statIds = new Set(next.stats.map(s => s.id));
  let statEffects = 0;
  for (const b of next.buildings) {
    const kept = (b.statEffects ?? []).filter(e => statIds.has(e.id));
    statEffects += (b.statEffects ?? []).length - kept.length;
    b.statEffects = kept;
  }
  // Gesetze: Kategorie muss existieren, Einträge müssen auf Vorhandenes zeigen
  next.lawCategories = next.lawCategories ?? [];
  next.laws = next.laws ?? [];
  const lawCategoryIds = new Set(next.lawCategories.map(c => c.id));
  const removedLaws: string[] = [];
  next.laws = next.laws.filter(l => {
    if (lawCategoryIds.has(l.category)) return true;
    removedLaws.push(l.name);
    return false;
  });
  const targets = { resource: resourceIds, worker: workerIds, stat: statIds } as const;
  let lawEntries = 0;
  for (const l of next.laws) {
    for (const o of l.options) {
      const kept = o.entries.filter(e => targets[e.kind].has(e.id));
      lawEntries += o.entries.length - kept.length;
      o.entries = kept;
    }
  }
  // Trigger: Bedingungen und Wirkungen müssen auf Vorhandenes zeigen, sonst entfällt der Verweis (ohne Rest der Trigger)
  next.triggers = next.triggers ?? [];
  let triggerParts = 0;
  const removedTriggers: string[] = [];
  next.triggers = next.triggers.filter(tr => {
    const conditions = tr.conditions.filter(c => targets[c.kind].has(c.id));
    const entries = tr.entries.filter(e => targets[e.kind].has(e.id));
    triggerParts += tr.conditions.length - conditions.length + tr.entries.length - entries.length;
    tr.conditions = conditions;
    tr.entries = entries;
    if (conditions.length && entries.length) return true;
    removedTriggers.push(tr.name);
    return false;
  });
  return { defs: next, cleanup: { costEntries, removedBuildings, restoredGold, statEffects, removedLaws, lawEntries, removedTriggers, triggerParts } };
}
