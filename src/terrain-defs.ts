// Reine Logik für die Geländearten (ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import type { TerrainEntry } from "./types";

/**
 * Mitgelieferte Geländearten. Wird beim Laden des Moduls festgehalten, bevor TERRAIN zur Laufzeit
 * mit den Einstellungen der SL abgeglichen wird. Sie lassen sich ändern, aber nicht löschen.
 */
export const BUILTIN_TERRAIN: TerrainEntry[] = Object.entries(TERRAIN).map(([id, t]) => ({
  id,
  label: t.label,
  color: t.color,
  buildable: t.buildable
}));

export const isBuiltinTerrain = (id: string): boolean => BUILTIN_TERRAIN.some(b => b.id === id);

/** Das Standardgelände (Gras) ist die Ersatzart für gelöschte Arten und kann nicht unbaubar werden. */
export const isDefaultTerrain = (id: string): boolean => id === DEFAULT_TERRAIN;

/** Pro Feld wird ein Zeichen gespeichert; neue Arten bekommen einen freien Buchstaben (max. 52 Arten). */
export const TERRAIN_ID_POOL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const ID_RE = /^[A-Za-z]$/;
const HEX = /^#[0-9a-f]{6}$/i;

export function nextTerrainId(existing: TerrainEntry[]): string | null {
  const used = new Set(existing.map(e => e.id));
  for (const c of TERRAIN_ID_POOL) if (!used.has(c)) return c;
  return null;
}

/**
 * Prüft eine gespeicherte Liste von Geländearten: ungültige und doppelte Einträge entfallen,
 * fehlende mitgelieferte Arten werden ergänzt. Fehlt die Liste ganz, gelten die mitgelieferten Arten.
 */
export function normalizeTerrain(input: unknown): TerrainEntry[] {
  const out: TerrainEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input)) {
    for (const e of input) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const builtin = BUILTIN_TERRAIN.find(b => b.id === id);
      if (!(ID_RE.test(id) || builtin) || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 40) : (builtin?.label ?? id),
        color: typeof r.color === "string" && HEX.test(r.color) ? r.color : (builtin?.color ?? "#888888"),
        buildable: typeof r.buildable === "boolean" ? r.buildable : (builtin?.buildable ?? true)
      });
    }
  }
  for (const b of BUILTIN_TERRAIN) if (!seen.has(b.id)) out.push({ ...b });
  return out;
}
