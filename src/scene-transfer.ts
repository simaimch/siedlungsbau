// Export und Import einer ganzen Siedlungsszene (reine Logik ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { normalizeEffects } from "./effects";
import { clampStat } from "./stats";
import { normalizeLawStates } from "./laws";
import { normalizeTriggerSwitches } from "./triggers";
import { normalizeMapGenOptions } from "./mapgen";
import { applyImport, parseImport } from "./transfer";
import type { MapGenOptions } from "./mapgen";
import type { ActiveEffect, Building, Cell, CostEntry, Definitions, SettlementState, StatEffect, StatType, TerrainData } from "./types";

export const SCENE_FORMAT = "siedlungsbau-scene";
export const SCENE_FORMAT_VERSION = 1;
export const MIN_SIDE = 5;
export const MAX_SIDE = 200;

/** Was in der Szene gespeichert ist (ohne Definitionen). */
export interface SceneData {
  name: string;
  terrain: TerrainData;
  mapgen?: MapGenOptions;
  settlement: SettlementState;
  buildings: Building[];
}

/** Bekannte Einträge der Welt; Verweise auf Unbekanntes werden beim Import bereinigt. */
export interface Known {
  buildingTypes: Map<string, { category: string }>;
  resources: Set<string>;
  workers: Set<string>;
  stats: Map<string, StatType>;
  /** Gesetz-ID → IDs seiner Ausprägungen */
  laws: Map<string, Set<string>>;
  triggers: Set<string>;
  terrain: Set<string>;
  defaultTerrain: string;
}

export interface SceneCleanup {
  /** Felder mit unbekannter Geländeart (jetzt Standardgelände) */
  terrainCells: number;
  /** Gebäude mit unbekanntem Typ */
  removedBuildings: string[];
  /** Vorräte, Werte, Effekte, Gesetze, Trigger-Schaltungen und Kostenposten mit unbekannten Verweisen */
  entries: number;
}

export interface SceneParse {
  data: SceneData | null;
  errors: string[];
  cleanup: SceneCleanup;
  /** Eingebettete Definitionen im Format des Daten-Exports (falls vorhanden) */
  definitions: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const name = (v: unknown, fallback: string, max = 60): string => (typeof v === "string" && v.replace(/\s+/g, " ").trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : fallback);

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ExportInput extends SceneData {
  /** Definitionen als Text im Format des Daten-Exports (optional) */
  definitions?: unknown;
}

/** Formatiertes JSON; Rasterfelder ([x, y]) stehen dabei jeweils in einer Zeile. */
export function exportScene(input: ExportInput): string {
  const { definitions, ...scene } = input;
  const out: Record<string, unknown> = {
    format: SCENE_FORMAT,
    version: SCENE_FORMAT_VERSION,
    name: scene.name,
    cols: scene.terrain.cols,
    rows: scene.terrain.rows,
    terrain: scene.terrain.cells,
    ...(scene.mapgen ? { mapgen: scene.mapgen } : {}),
    settlement: scene.settlement,
    buildings: scene.buildings
  };
  if (definitions !== undefined) out.definitions = definitions;
  return JSON.stringify(out, null, 2).replace(/\[\s*(-?\d+),\s*(-?\d+)\s*\]/g, "[$1, $2]");
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function costList(raw: unknown, known: Known, cleanup: SceneCleanup): CostEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CostEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || (e.kind !== "resource" && e.kind !== "worker") || typeof e.id !== "string" || typeof e.amount !== "number" || !Number.isFinite(e.amount)) {
      cleanup.entries++;
      continue;
    }
    if (!(e.kind === "resource" ? known.resources : known.workers).has(e.id)) {
      cleanup.entries++;
      continue;
    }
    out.push({ kind: e.kind, id: e.id, amount: Math.round(e.amount) });
  }
  return out;
}

function statEffectList(raw: unknown, known: Known, cleanup: SceneCleanup): StatEffect[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StatEffect[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.amount !== "number" || !Number.isFinite(e.amount) || !known.stats.has(e.id)) {
      cleanup.entries++;
      continue;
    }
    out.push({ id: e.id, amount: Math.round(e.amount * 100) / 100, ...(e.mode === "once" ? { mode: "once" as const } : {}) });
  }
  return out;
}

function amounts(raw: unknown, allowed: Set<string>, cleanup: SceneCleanup): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!allowed.has(id) || typeof v !== "number" || !Number.isFinite(v)) {
      cleanup.entries++;
      continue;
    }
    out[id] = Math.max(0, Math.round(v));
  }
  return out;
}

function parseBuildings(raw: unknown, cols: number, rows: number, known: Known, errors: string[], cleanup: SceneCleanup): Building[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push("„buildings“ muss eine Liste sein.");
    return [];
  }
  const out: Building[] = [];
  const ids = new Set<string>();
  const taken = new Map<string, string>();
  raw.forEach((b, i) => {
    const label = `Gebäude ${i + 1}`;
    if (!isObj(b)) return void errors.push(`${label}: kein Objekt.`);
    if (typeof b.id !== "string" || !b.id) return void errors.push(`${label}: „id“ fehlt.`);
    if (ids.has(b.id)) return void errors.push(`${label}: Die ID „${b.id}“ kommt doppelt vor.`);
    ids.add(b.id);
    const bname = name(b.name, "Gebäude");
    if (typeof b.typeId !== "string" || !b.typeId) return void errors.push(`${bname}: „typeId“ fehlt.`);
    if (b.status !== "ordered" && b.status !== "done") return void errors.push(`${bname}: „status“ muss „ordered“ oder „done“ sein.`);
    if (!Array.isArray(b.cells) || !b.cells.length) return void errors.push(`${bname}: „cells“ muss mindestens ein Feld enthalten.`);
    const cells: Cell[] = [];
    for (const c of b.cells) {
      const x = Array.isArray(c) ? int(c[0]) : null;
      const y = Array.isArray(c) ? int(c[1]) : null;
      if (x === null || y === null) return void errors.push(`${bname}: „cells“ enthält ein ungültiges Feld.`);
      if (x < 0 || y < 0 || x >= cols || y >= rows) return void errors.push(`${bname}: Feld [${x}, ${y}] liegt außerhalb der Karte (${cols} × ${rows}).`);
      const key = `${x},${y}`;
      if (taken.has(key)) return void errors.push(`${bname}: Feld [${x}, ${y}] ist auch von „${taken.get(key)}“ belegt.`);
      cells.push([x, y]);
    }
    for (const [x, y] of cells) taken.set(`${x},${y}`, bname);
    const type = known.buildingTypes.get(b.typeId);
    if (!type) {
      cleanup.removedBuildings.push(bname);
      return;
    }
    const building: Building = { id: b.id, typeId: b.typeId, name: bname, category: type.category, cells, status: b.status };
    const buildCost = costList(b.buildCost, known, cleanup);
    const upkeep = costList(b.upkeep, known, cleanup);
    const statEffects = statEffectList(b.statEffects, known, cleanup);
    if (buildCost) building.buildCost = buildCost;
    if (upkeep) building.upkeep = upkeep;
    if (statEffects) building.statEffects = statEffects;
    if (b.status === "ordered" && isObj(b.progress)) {
      building.progress = { resources: amounts(b.progress.resources, known.resources, cleanup), workers: amounts(b.progress.workers, known.workers, cleanup) };
    }
    out.push(building);
  });
  return out;
}

function parseSettlement(raw: unknown, known: Known, errors: string[], cleanup: SceneCleanup): SettlementState {
  const s: SettlementState = { week: 1, resources: {}, workers: {}, stats: {}, effects: [], laws: {}, lawChanges: 0, triggers: {} };
  if (raw === undefined) return s;
  if (!isObj(raw)) {
    errors.push("„settlement“ muss ein Objekt sein.");
    return s;
  }
  if (raw.week !== undefined) {
    const w = int(raw.week);
    if (w === null || w < 1) errors.push("„settlement.week“ muss eine ganze Zahl ≥ 1 sein.");
    else s.week = w;
  }
  s.resources = amounts(raw.resources, known.resources, cleanup);
  s.workers = amounts(raw.workers, known.workers, cleanup);
  if (isObj(raw.stats)) {
    for (const [id, v] of Object.entries(raw.stats)) {
      const stat = known.stats.get(id);
      if (!stat || typeof v !== "number" || !Number.isFinite(v)) cleanup.entries++;
      else s.stats[id] = clampStat(stat, v);
    }
  }
  s.effects = normalizeEffects(raw.effects).flatMap((fx): ActiveEffect[] => {
    const entries = fx.entries.filter(e => (e.kind === "stat" ? known.stats.has(e.id) : (e.kind === "resource" ? known.resources : known.workers).has(e.id)));
    cleanup.entries += fx.entries.length - entries.length;
    return entries.length ? [{ ...fx, entries }] : [];
  });
  for (const [id, st] of Object.entries(normalizeLawStates(raw.laws))) {
    const options = known.laws.get(id);
    if (!options) {
      cleanup.entries++;
      continue;
    }
    s.laws[id] = {
      ...st,
      option: st.option !== null && options.has(st.option) ? st.option : null,
      disabled: st.disabled.filter(o => options.has(o)),
      hiddenOptions: st.hiddenOptions.filter(o => options.has(o))
    };
  }
  const changes = int(raw.lawChanges);
  s.lawChanges = changes !== null && changes > 0 ? changes : 0;
  for (const [id, on] of Object.entries(normalizeTriggerSwitches(raw.triggers))) {
    if (known.triggers.has(id)) s.triggers[id] = on;
    else cleanup.entries++;
  }
  return s;
}

/** Liest den Text, prüft ihn und bereinigt Verweise auf unbekannte Einträge. Bei Fehlern ist data null. */
export function parseSceneImport(text: string, known: Known): SceneParse {
  const cleanup: SceneCleanup = { terrainCells: 0, removedBuildings: [], entries: 0 };
  const fail = (...errors: string[]): SceneParse => ({ data: null, errors, cleanup, definitions: null });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return fail(`Kein gültiges JSON: ${(err as Error).message}`);
  }
  if (!isObj(raw)) return fail("Der Import muss ein JSON-Objekt sein.");
  if (raw.format !== SCENE_FORMAT) return fail(`Das ist keine Siedlungsszene („format“ muss „${SCENE_FORMAT}“ sein). Daten-Exporte der Definitionen gehören in die Moduleinstellungen.`);
  if (int(raw.version) === null || (raw.version as number) > SCENE_FORMAT_VERSION) return fail("Unbekannte Version der Siedlungsszene.");

  const errors: string[] = [];
  const cols = int(raw.cols);
  const rows = int(raw.rows);
  if (cols === null || rows === null || cols < MIN_SIDE || rows < MIN_SIDE || cols > MAX_SIDE || rows > MAX_SIDE) {
    return fail(`„cols“ und „rows“ müssen ganze Zahlen von ${MIN_SIDE} bis ${MAX_SIDE} sein.`);
  }
  if (typeof raw.terrain !== "string" || raw.terrain.length !== cols * rows) {
    return fail(`„terrain“ muss ein Text mit genau ${cols * rows} Zeichen sein (${cols} × ${rows}).`);
  }
  let cells = "";
  for (const ch of raw.terrain) {
    if (known.terrain.has(ch)) cells += ch;
    else {
      cells += known.defaultTerrain;
      cleanup.terrainCells++;
    }
  }

  const buildings = parseBuildings(raw.buildings, cols, rows, known, errors, cleanup);
  const settlement = parseSettlement(raw.settlement, known, errors, cleanup);
  if (errors.length) return { data: null, errors, cleanup, definitions: null };

  const data: SceneData = { name: name(raw.name, "Siedlung"), terrain: { cols, rows, cells }, settlement, buildings };
  if (isObj(raw.mapgen)) data.mapgen = normalizeMapGenOptions(raw.mapgen);
  return { data, errors, cleanup, definitions: raw.definitions !== undefined ? JSON.stringify(raw.definitions) : null };
}

/* ------------------------------------------------------------------ */
/* Vorbereitung des Imports mit optionalen Definitionen                */
/* ------------------------------------------------------------------ */

/** Bekannte Einträge aus den Definitionen der Welt. */
export function knownFromDefinitions(defs: Required<Definitions>, defaultTerrain: string): Known {
  return {
    buildingTypes: new Map(defs.buildings.map(b => [b.id, { category: b.category }])),
    resources: new Set(defs.resources.map(r => r.id)),
    workers: new Set(defs.workers.map(w => w.id)),
    stats: new Map(defs.stats.map(s => [s.id, s])),
    laws: new Map(defs.laws.map(l => [l.id, new Set(l.options.map(o => o.id))])),
    triggers: new Set(defs.triggers.map(x => x.id)),
    terrain: new Set(defs.terrain.map(e => e.id)),
    defaultTerrain
  };
}

export interface PreparedImport extends SceneParse {
  /** Zusammengeführte Definitionen, falls der Import welche enthält und sie übernommen werden sollen */
  mergedDefinitions: Required<Definitions> | null;
  /** Der Import enthält Definitionen (unabhängig davon, ob sie übernommen werden) */
  hasDefinitions: boolean;
}

/**
 * Prüft einen Import gegen die aktuellen Definitionen. Mit includeDefinitions werden die mitgelieferten Definitionen
 * zuerst per ID zusammengeführt (bestehende Einträge bleiben), und die Szene wird gegen das Ergebnis geprüft.
 */
export function prepareImport(text: string, current: Required<Definitions>, includeDefinitions: boolean, defaultTerrain: string): PreparedImport {
  let first = parseSceneImport(text, knownFromDefinitions(current, defaultTerrain));
  const hasDefinitions = first.definitions !== null;
  if (!includeDefinitions || !first.definitions) return { ...first, mergedDefinitions: null, hasDefinitions };

  const defs = parseImport(first.definitions);
  if (defs.errors.length) {
    return { ...first, data: null, errors: ["Die mitgelieferten Definitionen sind fehlerhaft:", ...defs.errors], mergedDefinitions: null, hasDefinitions };
  }
  const merged = applyImport(current, defs.data, "merge").defs as Required<Definitions>;
  first = parseSceneImport(text, knownFromDefinitions(merged, defaultTerrain));
  return { ...first, mergedDefinitions: merged, hasDefinitions };
}
