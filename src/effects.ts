// Aktive Effekte der Siedlung (reine Logik ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import type { ActiveEffect, EffectEntry, EffectKind } from "./types";

export const EFFECT_KINDS: EffectKind[] = ["resource", "worker", "stat"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Menge eines Eintrags: Ressourcen und Arbeiter ganzzahlig, Werte mit zwei Nachkommastellen. */
export function normalizeAmount(kind: EffectKind, amount: number): number {
  return kind === "stat" ? round2(amount) : Math.round(amount);
}

/** Liest gespeicherte Effekte; ungültige Einträge entfallen. */
export function normalizeEffects(raw: unknown): ActiveEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: ActiveEffect[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.id !== "string" || !e.id) continue;
    const remaining = Math.floor(Number(e.remaining));
    if (!Number.isFinite(remaining) || remaining < 1) continue;
    const entries: EffectEntry[] = [];
    if (Array.isArray(e.entries)) {
      for (const x of e.entries) {
        if (!isObj(x) || !EFFECT_KINDS.includes(x.kind as EffectKind) || typeof x.id !== "string") continue;
        const amount = normalizeAmount(x.kind as EffectKind, Number(x.amount));
        if (Number.isFinite(amount) && amount !== 0) entries.push({ kind: x.kind as EffectKind, id: x.id, amount });
      }
    }
    out.push({ id: e.id, name: typeof e.name === "string" && e.name.trim() ? e.name.trim().slice(0, 60) : "Effekt", remaining, entries });
  }
  return out;
}

/** Summe aller Einträge einer Art über die aktiven Effekte, je Ziel-ID. */
export function sumEntries(effects: ActiveEffect[], kind: EffectKind): Record<string, number> {
  const sum: Record<string, number> = {};
  for (const fx of effects) {
    if (fx.remaining < 1) continue;
    for (const e of fx.entries) if (e.kind === kind) sum[e.id] = (sum[e.id] ?? 0) + e.amount;
  }
  return sum;
}

/** Eine Woche vergeht: Restdauer sinkt um 1, Effekte bei 0 laufen aus. */
export function tickEffects(effects: ActiveEffect[]): { active: ActiveEffect[]; expired: ActiveEffect[] } {
  const active: ActiveEffect[] = [];
  const expired: ActiveEffect[] = [];
  for (const fx of effects) {
    if (fx.remaining < 1) continue;
    const next = { ...fx, entries: fx.entries.map(e => ({ ...e })), remaining: fx.remaining - 1 };
    (next.remaining > 0 ? active : expired).push(next);
  }
  return { active, expired };
}
