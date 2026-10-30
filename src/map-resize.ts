import type { Cell, TerrainData } from "./types";

export interface Expand { left: number; right: number; top: number; bottom: number }

export const MAX_SIDE = 200;

/** Macht aus beliebiger Eingabe eine nicht-negative ganze Zahl. */
const count = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));

export function normalizeExpand(e: Partial<Record<keyof Expand, unknown>>, cols: number, rows: number): Expand {
  const r: Expand = { left: count(e.left), right: count(e.right), top: count(e.top), bottom: count(e.bottom) };
  // Gesamtgröße begrenzen: zuerst wird gekürzt, was zuletzt zu viel wäre
  let over = cols + r.left + r.right - MAX_SIDE;
  for (const k of ["right", "left"] as const) { const cut = Math.min(over, r[k]); if (cut > 0) { r[k] -= cut; over -= cut; } }
  over = rows + r.top + r.bottom - MAX_SIDE;
  for (const k of ["bottom", "top"] as const) { const cut = Math.min(over, r[k]); if (cut > 0) { r[k] -= cut; over -= cut; } }
  return r;
}

/** Erweitert die Karte; neue Felder übernehmen das Gelände der angrenzenden Randzeile/-spalte (Ecken die der Ecke). */
export function expandTerrain(t: TerrainData, e: Expand): TerrainData {
  const cols = t.cols + e.left + e.right;
  const rows = t.rows + e.top + e.bottom;
  const out: string[] = [];
  for (let y = 0; y < rows; y++) {
    const sy = Math.min(t.rows - 1, Math.max(0, y - e.top));
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(t.cols - 1, Math.max(0, x - e.left));
      out.push(t.cells[sy * t.cols + sx]);
    }
  }
  return { cols, rows, cells: out.join("") };
}

export const shiftCells = (cells: Cell[], dx: number, dy: number): Cell[] => cells.map(([x, y]) => [x + dx, y + dy]);
