// Getriggerte Effekte (reine Logik ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { EFFECT_KINDS, normalizeAmount } from "./effects";
import type { ActiveEffect, CompareOp, EffectKind, StatEffect, Trigger, TriggerCondition, TriggerEntry } from "./types";

export const COMPARE_OPS: CompareOp[] = ["<", "<=", ">", ">=", "==", "!="];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Liest gespeicherte Bedingungen; ungültige entfallen. */
export function normalizeConditions(raw: unknown): TriggerCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: TriggerCondition[] = [];
  for (const c of raw) {
    if (!isObj(c) || !EFFECT_KINDS.includes(c.kind as EffectKind) || typeof c.id !== "string" || !c.id) continue;
    const value = Number(c.value);
    if (!COMPARE_OPS.includes(c.op as CompareOp) || !Number.isFinite(value)) continue;
    out.push({ kind: c.kind as EffectKind, id: c.id, op: c.op as CompareOp, value: round2(value) });
  }
  return out;
}

/** Liest gespeicherte Einträge; der Modus gilt nur für Werte ("modifier" bleibt, alles andere ist "weekly"). */
export function normalizeTriggerEntries(raw: unknown): TriggerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TriggerEntry[] = [];
  for (const x of raw) {
    if (!isObj(x) || !EFFECT_KINDS.includes(x.kind as EffectKind) || typeof x.id !== "string" || !x.id) continue;
    const kind = x.kind as EffectKind;
    const amount = normalizeAmount(kind, Number(x.amount));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const entry: TriggerEntry = { kind, id: x.id, amount };
    if (kind === "stat" && x.mode === "modifier") entry.mode = "modifier";
    out.push(entry);
  }
  return out;
}

/** Ein Trigger braucht ID, Namen, mindestens eine Bedingung und eine Wirkung; ungültige Einträge entfallen. */
export function normalizeTriggers(raw: unknown): Trigger[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Trigger[] = [];
  for (const t of raw) {
    if (!isObj(t) || typeof t.id !== "string" || !t.id || seen.has(t.id)) continue;
    const conditions = normalizeConditions(t.conditions);
    const entries = normalizeTriggerEntries(t.entries);
    if (!conditions.length || !entries.length) continue;
    seen.add(t.id);
    const trigger: Trigger = { id: t.id, name: str(t.name, 60) || "Trigger", conditions, entries };
    const description = str(t.description, 300);
    if (description) trigger.description = description;
    if (t.hidden === true) trigger.hidden = true;
    if (t.defaultOn === false) trigger.defaultOn = false;
    out.push(trigger);
  }
  return out;
}

/** Gespeicherte Schaltung pro Siedlung: nur echte Wahrheitswerte bleiben erhalten. */
export function normalizeTriggerSwitches(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") out[k] = v;
  return out;
}

export function compare(op: CompareOp, a: number, b: number): boolean {
  const eps = 1e-9;
  switch (op) {
    case "<": return a < b - eps;
    case "<=": return a <= b + eps;
    case ">": return a > b + eps;
    case ">=": return a >= b - eps;
    case "==": return Math.abs(a - b) <= eps;
    case "!=": return Math.abs(a - b) > eps;
  }
}

/** Momentaufnahme der Siedlung für die Bedingungen; fehlende Einträge gelten als unbekannt (Bedingung nicht erfüllt). */
export interface Snapshot {
  stat: Record<string, number>;
  resource: Record<string, number>;
  worker: Record<string, number>;
}

export const conditionMet = (c: TriggerCondition, snap: Snapshot): boolean => {
  const have = snap[c.kind]?.[c.id];
  return typeof have === "number" && compare(c.op, have, c.value);
};

/** Ist der Trigger in dieser Siedlung eingeschaltet? Eigene Schaltung vor der Voreinstellung des Triggers. */
export const isTriggerOn = (t: Trigger, switches: Record<string, boolean>): boolean => switches[t.id] ?? t.defaultOn !== false;

/** Alle eingeschalteten Trigger, deren Bedingungen gleichzeitig erfüllt sind. Alle werden gegen dieselbe Momentaufnahme geprüft. */
export function firedTriggers(triggers: Trigger[], switches: Record<string, boolean>, snap: Snapshot): Trigger[] {
  return triggers.filter(t => isTriggerOn(t, switches) && t.conditions.length > 0 && t.conditions.every(c => conditionMet(c, snap)));
}

/**
 * Zerlegt die Wirkungen ausgelöster Trigger:
 * - effect: Zuschläge und Ressourcen/Arbeiter wie ein dauerhafter Effekt (Werte nur im Modus "modifier"),
 * - statWeekly: Änderungen des Basiswerts pro Woche.
 */
export function triggerEffects(fired: Trigger[]): { effect: ActiveEffect | null; statWeekly: StatEffect[] } {
  const entries: ActiveEffect["entries"] = [];
  const statWeekly: StatEffect[] = [];
  for (const t of fired) {
    for (const e of t.entries) {
      if (e.kind === "stat" && e.mode !== "modifier") statWeekly.push({ id: e.id, amount: e.amount, mode: "weekly" });
      else entries.push({ kind: e.kind, id: e.id, amount: e.amount });
    }
  }
  return { effect: entries.length ? { id: "triggers", name: "Trigger", remaining: 1, entries } : null, statWeekly };
}
