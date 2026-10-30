// Gesetze der Siedlung (reine Logik ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { EFFECT_KINDS, normalizeAmount } from "./effects";
import type { ActiveEffect, EffectEntry, EffectKind, Law, LawCategory, LawOption, LawState } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function normalizeEntries(raw: unknown): EffectEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: EffectEntry[] = [];
  for (const x of raw) {
    if (!isObj(x) || !EFFECT_KINDS.includes(x.kind as EffectKind) || typeof x.id !== "string" || !x.id) continue;
    const amount = normalizeAmount(x.kind as EffectKind, Number(x.amount));
    if (Number.isFinite(amount) && amount !== 0) out.push({ kind: x.kind as EffectKind, id: x.id, amount });
  }
  return out;
}

export function normalizeLawCategories(raw: unknown): LawCategory[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LawCategory[] = [];
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== "string" || !c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, label: str(c.label, 40) || "Kategorie" });
  }
  return out;
}

/** Gesetze brauchen eine ID, einen Namen und mindestens eine Ausprägung; ungültige Einträge entfallen. */
export function normalizeLaws(raw: unknown): Law[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Law[] = [];
  for (const l of raw) {
    if (!isObj(l) || typeof l.id !== "string" || !l.id || seen.has(l.id) || typeof l.category !== "string") continue;
    const optionIds = new Set<string>();
    const options: LawOption[] = [];
    if (Array.isArray(l.options)) {
      for (const o of l.options) {
        if (!isObj(o) || typeof o.id !== "string" || !o.id || optionIds.has(o.id)) continue;
        optionIds.add(o.id);
        options.push({ id: o.id, name: str(o.name, 60) || "Ausprägung", entries: normalizeEntries(o.entries) });
      }
    }
    if (!options.length) continue;
    seen.add(l.id);
    const law: Law = { id: l.id, name: str(l.name, 60) || "Gesetz", category: l.category, options };
    const description = str(l.description, 300);
    if (description) law.description = description;
    out.push(law);
  }
  return out;
}

export const defaultLawState = (): LawState => ({ option: null, since: null, hidden: false, locked: false, disabled: [], hiddenOptions: [] });

const idList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);

export function normalizeLawStates(raw: unknown): Record<string, LawState> {
  const out: Record<string, LawState> = {};
  if (!isObj(raw)) return out;
  for (const [id, s] of Object.entries(raw)) {
    if (!isObj(s)) continue;
    out[id] = {
      option: typeof s.option === "string" ? s.option : null,
      since: typeof s.since === "number" && Number.isFinite(s.since) ? s.since : null,
      hidden: s.hidden === true,
      locked: s.locked === true,
      disabled: idList(s.disabled),
      hiddenOptions: idList(s.hiddenOptions)
    };
  }
  return out;
}

/** Aktive Ausprägung; unbekannte oder fehlende Auswahl fällt auf die erste zurück. */
export function currentOption(law: Law, st: LawState | undefined): LawOption {
  return law.options.find(o => o.id === st?.option) ?? law.options[0];
}

/** Aktive Ausprägungen aller Gesetze als dauerhafte Effekte (werden nicht heruntergezählt). */
export function lawEffects(laws: Law[], states: Record<string, LawState>): ActiveEffect[] {
  return laws
    .map(law => {
      const opt = currentOption(law, states[law.id]);
      return { id: `law:${law.id}`, name: `${law.name}: ${opt.name}`, remaining: 1, entries: opt.entries.map(e => ({ ...e })) };
    })
    .filter(fx => fx.entries.length);
}

/* ---------- Änderungen ---------- */

export interface LawRules {
  /** Wie viele Gesetze Spieler pro Woche ändern dürfen */
  perWeek: number;
  /** Wochen, bis dieselbe Ausprägung eines Gesetzes erneut geändert werden darf */
  cooldown: number;
}

export interface ChangeContext {
  week: number;
  /** Bereits in dieser Woche von Spielern geänderte Gesetze */
  changesThisWeek: number;
  isGM: boolean;
  rules: LawRules;
}

export type ChangeCheck = { ok: true } | { ok: false; reason: "unknown" | "same" | "hidden" | "locked" | "optionDisabled" | "optionHidden" | "cooldown" | "quota"; weeks?: number };

/** Wochen, die noch bis zur nächsten Änderung durch Spieler fehlen (0 = jetzt möglich). */
export function weeksUntilChange(st: LawState | undefined, week: number, cooldown: number): number {
  if (!st || st.since === null || cooldown <= 0) return 0;
  return Math.max(0, st.since + cooldown - week);
}

/** Prüft, ob die Ausprägung gewechselt werden darf. Die SL darf alles außer ein Gesetz auf sich selbst oder Unbekanntes zu setzen. */
export function checkChange(law: Law, optionId: string, st: LawState | undefined, ctx: ChangeContext): ChangeCheck {
  if (!law.options.some(o => o.id === optionId)) return { ok: false, reason: "unknown" };
  if (currentOption(law, st).id === optionId) return { ok: false, reason: "same" };
  if (ctx.isGM) return { ok: true };
  if (st?.hidden) return { ok: false, reason: "hidden" };
  if (st?.locked) return { ok: false, reason: "locked" };
  if (st?.disabled.includes(optionId)) return { ok: false, reason: "optionDisabled" };
  if (st?.hiddenOptions.includes(optionId)) return { ok: false, reason: "optionHidden" };
  const wait = weeksUntilChange(st, ctx.week, ctx.rules.cooldown);
  if (wait > 0) return { ok: false, reason: "cooldown", weeks: wait };
  if (ctx.changesThisWeek >= ctx.rules.perWeek) return { ok: false, reason: "quota" };
  return { ok: true };
}

/**
 * Neuer Zustand nach einer Änderung. Änderungen der SL starten weder Wartezeit noch zählen sie
 * zum Wochenlimit der Spieler.
 */
export function applyChange(st: LawState | undefined, optionId: string, week: number, isGM: boolean): LawState {
  const next = { ...(st ?? defaultLawState()), option: optionId };
  if (!isGM) next.since = week;
  return next;
}

/* ---------- Sichtbarkeit ---------- */

export const isLawVisible = (st: LawState | undefined, isGM: boolean): boolean => isGM || !st?.hidden;

/** Für Spieler: versteckte Ausprägungen entfallen, außer sie sind gerade aktiv. */
export function isOptionVisible(law: Law, opt: LawOption, st: LawState | undefined, isGM: boolean): boolean {
  return isGM || !st?.hiddenOptions.includes(opt.id) || currentOption(law, st).id === opt.id;
}
