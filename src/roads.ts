// Wege und Straßen (reine Logik ohne Foundry-Abhängigkeiten, daher einzeln testbar).
// Fertige Wegabschnitte stehen wie das Gelände in einem Text (ein Zeichen pro Feld, "." = kein Weg);
// beauftragte Abschnitte stehen mit ihrem Baufortschritt in einer Liste.
import type { Building, Cell, CostEntry, Progress, RoadOrder, RoadType, TerrainData } from "./types";

export const NO_ROAD = ".";
/** Wegarten bekommen wie Geländearten einen Buchstaben (max. 52 Arten). */
export const ROAD_ID_POOL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** So viele Felder dürfen in einer Nachricht stehen. */
export const MAX_ROAD_CELLS = 400;
export const DEFAULT_ROAD_GAP = 20;
export const MAX_ROAD_GAP = 40;
/** Präfix der Pseudo-Gebäude, mit denen Wegaufträge durch die Wochenrechnung laufen. */
export const ROAD_PREFIX = "road:";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;
const cellKey = (x: number, y: number): string => `${x},${y}`;

/* ------------------------------------------------------------------ */
/* Wegarten                                                            */
/* ------------------------------------------------------------------ */

export function normalizeRoadCosts(raw: unknown): CostEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CostEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || (e.kind !== "resource" && e.kind !== "worker") || typeof e.id !== "string" || !e.id) continue;
    const amount = Math.round(Number(e.amount));
    if (Number.isFinite(amount) && amount > 0) out.push({ kind: e.kind, id: e.id, amount });
  }
  return out;
}

/** Liest gespeicherte Wegarten; ungültige und doppelte Einträge entfallen. */
export function normalizeRoadTypes(raw: unknown): RoadType[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RoadType[] = [];
  for (const r of raw) {
    if (!isObj(r) || typeof r.id !== "string" || r.id.length !== 1 || !ROAD_ID_POOL.includes(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      name: typeof r.name === "string" && r.name.replace(/\s+/g, " ").trim() ? r.name.replace(/\s+/g, " ").trim().slice(0, 40) : "Weg",
      color: typeof r.color === "string" && HEX.test(r.color) ? r.color : "#a08060",
      buildCost: normalizeRoadCosts(r.buildCost)
    });
  }
  return out;
}

export function nextRoadId(existing: RoadType[]): string | null {
  const used = new Set(existing.map(r => r.id));
  for (const c of ROAD_ID_POOL) if (!used.has(c)) return c;
  return null;
}

/* ------------------------------------------------------------------ */
/* Fertige Wege (Text) und Aufträge                                    */
/* ------------------------------------------------------------------ */

export const emptyRoads = (cols: number, rows: number): TerrainData => ({ cols, rows, cells: NO_ROAD.repeat(cols * rows) });

/** Liest die gespeicherten Wege für eine Karte der Größe cols × rows; unbekannte Arten und falsche Größen ergeben "kein Weg". */
export function normalizeRoads(raw: unknown, cols: number, rows: number, validIds: Set<string>): TerrainData {
  if (!isObj(raw) || typeof raw.cells !== "string" || raw.cols !== cols || raw.rows !== rows || raw.cells.length !== cols * rows) return emptyRoads(cols, rows);
  let cells = "";
  for (const ch of raw.cells) cells += ch === NO_ROAD || validIds.has(ch) ? ch : NO_ROAD;
  return { cols, rows, cells };
}

const inBounds = (cols: number, rows: number, x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cols && y < rows;

/** Art des fertigen Wegs auf dem Feld oder null. */
export function roadAt(roads: TerrainData | null, x: number, y: number): string | null {
  if (!roads || !inBounds(roads.cols, roads.rows, x, y)) return null;
  const ch = roads.cells[y * roads.cols + x];
  return ch && ch !== NO_ROAD ? ch : null;
}

/** Setzt (oder entfernt mit null) den Weg auf einem Feld und liefert neue Daten. */
export function setRoad(roads: TerrainData, x: number, y: number, id: string | null): TerrainData {
  if (!inBounds(roads.cols, roads.rows, x, y)) return roads;
  const i = y * roads.cols + x;
  return { ...roads, cells: roads.cells.slice(0, i) + (id ?? NO_ROAD) + roads.cells.slice(i + 1) };
}

function cleanProgress(raw: unknown): Progress | undefined {
  if (!isObj(raw)) return undefined;
  const part = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (isObj(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n) && n > 0) out[k] = Math.round(n);
    return out;
  };
  return { resources: part(raw.resources), workers: part(raw.workers) };
}

/** Liest gespeicherte Aufträge: nur gültige Felder und Arten, pro Feld höchstens einer (der erste gilt). */
export function normalizeRoadOrders(raw: unknown, cols: number, rows: number, validIds: Set<string>): RoadOrder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RoadOrder[] = [];
  for (const o of raw) {
    if (!isObj(o) || typeof o.typeId !== "string" || !validIds.has(o.typeId)) continue;
    const x = o.x as number, y = o.y as number;
    if (!inBounds(cols, rows, x, y) || seen.has(cellKey(x, y))) continue;
    seen.add(cellKey(x, y));
    const progress = cleanProgress(o.progress);
    out.push({ x, y, typeId: o.typeId, ...(progress ? { progress } : {}) });
  }
  return out;
}

/** Alle Felder auf der Linie von a nach b (einschließlich beider Enden, diagonale Schritte möglich). */
export function strokeCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x), dy = Math.abs(b[1] - y);
  const sx = x < b[0] ? 1 : -1, sy = y < b[1] ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 100000; guard++) {
    out.push([x, y]);
    if (x === b[0] && y === b[1]) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

/** Umgebung eines Felds für die Prüfung, ob dort ein Weg beauftragt werden darf. */
export interface RoadCellContext {
  cols: number;
  rows: number;
  buildable: (x: number, y: number) => boolean;
  hasBuilding: (x: number, y: number) => boolean;
  hasRoad: (x: number, y: number) => boolean;
  hasOrder: (x: number, y: number) => boolean;
}

export type RoadCellReason = "outOfBounds" | "terrain" | "building" | "occupied";

/** Darf auf dem Feld ein Weg beauftragt werden? null = ja, sonst der Grund. */
export function roadCellProblem(x: number, y: number, ctx: RoadCellContext): RoadCellReason | null {
  if (!inBounds(ctx.cols, ctx.rows, x, y)) return "outOfBounds";
  if (!ctx.buildable(x, y)) return "terrain";
  if (ctx.hasBuilding(x, y)) return "building";
  if (ctx.hasRoad(x, y) || ctx.hasOrder(x, y)) return "occupied";
  return null;
}

/** Entfernt Wege und Aufträge unter Gebäuden bzw. auf nicht baubarem Gelände. Liefert null, wenn nichts zu tun ist. */
export function pruneRoads(
  roads: TerrainData, orders: RoadOrder[], blocked: (x: number, y: number) => boolean
): { roads: TerrainData; orders: RoadOrder[]; removed: number } | null {
  let next = roads;
  let removed = 0;
  for (let y = 0; y < roads.rows; y++) {
    for (let x = 0; x < roads.cols; x++) {
      if (roadAt(next, x, y) !== null && blocked(x, y)) {
        next = setRoad(next, x, y, null);
        removed++;
      }
    }
  }
  const keep = orders.filter(o => !blocked(o.x, o.y));
  removed += orders.length - keep.length;
  return removed ? { roads: next, orders: keep, removed } : null;
}

/* ------------------------------------------------------------------ */
/* Karte erweitern                                                     */
/* ------------------------------------------------------------------ */

export interface Expansion { left: number; right: number; top: number; bottom: number }

/** Erweitert die Wege: neue Felder sind frei, alles andere wandert mit (links/oben). */
export function expandRoads(roads: TerrainData, e: Expansion): TerrainData {
  const cols = roads.cols + e.left + e.right;
  const rows = roads.rows + e.top + e.bottom;
  const out: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const sx = x - e.left, sy = y - e.top;
      out.push(sx >= 0 && sy >= 0 && sx < roads.cols && sy < roads.rows ? roads.cells[sy * roads.cols + sx] : NO_ROAD);
    }
  }
  return { cols, rows, cells: out.join("") };
}

export const shiftOrders = (orders: RoadOrder[], dx: number, dy: number): RoadOrder[] => orders.map(o => ({ ...o, x: o.x + dx, y: o.y + dy }));

/* ------------------------------------------------------------------ */
/* Wochenrechnung: Aufträge laufen als Pseudo-Gebäude durch computeWeek */
/* ------------------------------------------------------------------ */

export const roadOrderId = (o: { x: number; y: number }): string => `${ROAD_PREFIX}${o.x},${o.y}`;
export const isRoadId = (id: string): boolean => id.startsWith(ROAD_PREFIX);

/** Ein Auftrag als Gebäude im Bau (ein Feld, Kosten der Wegart). */
export function orderAsBuilding(o: RoadOrder, type: RoadType): Building {
  return {
    id: roadOrderId(o),
    typeId: ROAD_PREFIX + o.typeId,
    name: roadOrderId(o),
    category: "",
    cells: [[o.x, o.y]],
    status: "ordered",
    buildCost: type.buildCost.map(c => ({ ...c })),
    upkeep: [],
    statEffects: [],
    ...(o.progress ? { progress: { resources: { ...o.progress.resources }, workers: { ...o.progress.workers } } } : {})
  };
}

export interface RoadWeek {
  roads: TerrainData;
  orders: RoadOrder[];
  /** In dieser Woche fertig gewordene Abschnitte */
  completed: number;
  /** Weiterhin im Bau */
  pending: number;
}

/** Überträgt das Ergebnis der Wochenrechnung (Pseudo-Gebäude) zurück in Wege und Aufträge. */
export function applyRoadWeek(roads: TerrainData, orders: RoadOrder[], result: Building[]): RoadWeek {
  const byId = new Map(result.filter(b => isRoadId(b.id)).map(b => [b.id, b]));
  let next = roads;
  let completed = 0;
  const left: RoadOrder[] = [];
  for (const o of orders) {
    const b = byId.get(roadOrderId(o));
    if (!b) {
      left.push(o);
      continue;
    }
    if (b.status === "done") {
      next = setRoad(next, o.x, o.y, o.typeId);
      completed++;
    } else {
      left.push({ ...o, ...(b.progress ? { progress: b.progress } : {}) });
    }
  }
  return { roads: next, orders: left, completed, pending: left.length };
}

/* ------------------------------------------------------------------ */
/* Darstellung                                                         */
/* ------------------------------------------------------------------ */

export type RoadPiece =
  | { kind: "rect"; x: number; y: number; w: number; h: number; typeId: string; ordered: boolean }
  | { kind: "diag"; x1: number; y1: number; x2: number; y2: number; width: number; typeId: string; ordered: boolean };

export interface RoadCell { typeId: string; ordered: boolean }

/**
 * Zeichenteile (in Feldeinheiten) für alle Wegfelder. Jedes Feld füllt sich bis auf den Abstand gap (0..0.4) zu allen Rändern.
 * Ist ein Nachbar (oben, unten, links, rechts) ebenfalls ein Weg, reicht das Feld bis zum Rand zu ihm.
 * Vier Wegfelder im 2×2-Quadrat verschmelzen zu einer Fläche (die Ecke in der Mitte wird gefüllt).
 * Diagonal verbindet ein Weg nur, wenn keines der beiden Felder dazwischen ein Gebäude trägt oder selbst ein Weg ist.
 */
export function roadGeometry(
  cols: number, rows: number, cellAt: (x: number, y: number) => RoadCell | null, hasBuilding: (x: number, y: number) => boolean, gapRaw: number
): RoadPiece[] {
  const g = Math.max(0, Math.min(MAX_ROAD_GAP / 100, Number.isFinite(gapRaw) ? gapRaw : DEFAULT_ROAD_GAP / 100));
  const at = (x: number, y: number): RoadCell | null => (inBounds(cols, rows, x, y) ? cellAt(x, y) : null);
  const pieces: RoadPiece[] = [];
  const inner = 1 - 2 * g;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = at(x, y);
      if (!c) continue;
      const base = { typeId: c.typeId, ordered: c.ordered };
      pieces.push({ kind: "rect", x: x + g, y: y + g, w: inner, h: inner, ...base });
      if (g > 0) {
        if (at(x + 1, y)) pieces.push({ kind: "rect", x: x + 1 - g, y: y + g, w: g, h: inner, ...base });
        if (at(x - 1, y)) pieces.push({ kind: "rect", x, y: y + g, w: g, h: inner, ...base });
        if (at(x, y + 1)) pieces.push({ kind: "rect", x: x + g, y: y + 1 - g, w: inner, h: g, ...base });
        if (at(x, y - 1)) pieces.push({ kind: "rect", x: x + g, y, w: inner, h: g, ...base });
      }
      // Vier Felder im Quadrat bilden eine große Fläche: die Lücke an der gemeinsamen Ecke wird geschlossen
      if (g > 0 && at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1)) {
        pieces.push({ kind: "rect", x: x + 1 - g, y: y + 1 - g, w: 2 * g, h: 2 * g, ...base });
      }
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        if (!at(x + dx, y + dy)) continue;
        const sideA = [x + dx, y], sideB = [x, y + dy];
        if (hasBuilding(sideA[0], sideA[1]) || hasBuilding(sideB[0], sideB[1])) continue;
        if (at(sideA[0], sideA[1]) || at(sideB[0], sideB[1])) continue;
        // Von der Feldmitte bis zur gemeinsamen Ecke; die Hälfte des Nachbarn schließt dort bündig an
        pieces.push({ kind: "diag", x1: x + 0.5, y1: y + 0.5, x2: x + (dx > 0 ? 1 : 0), y2: y + (dy > 0 ? 1 : 0), width: inner, ...base });
      }
    }
  }
  return pieces;
}
