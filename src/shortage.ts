// Reine Logik: Engpass-Prüfung. Bei einem Engpass werden Verbraucher vorübergehend abgeschaltet, bis die Bilanz stimmt.
import { GOLD_ID } from "./constants";
import { computeWeek } from "./week";
import { normalizeAmount } from "./effects";
import type { CostsOf, Weights } from "./week";
import type { ActiveEffect, Building, EffectEntry, EffectKind, PricedType, SettlementState, ShortageMode, ShortageRule, StatEffect, StatType } from "./types";

export const SETTING_MAX_CHECKS = "shortageChecks";
export const DEFAULT_MAX_CHECKS = 10;
export const MAX_CHECKS_LIMIT = 100;
export const MAX_SHORTAGE_WEEKS = 99;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const KINDS: EffectKind[] = ["resource", "worker", "stat"];

/** Verhalten einer Ressource bei Engpass: Standard ist die Prüfung, bei Gold Schulden. */
export function shortageMode(r: Pick<PricedType, "id" | "shortage">): ShortageMode {
  return r.shortage?.mode ?? (r.id === GOLD_ID ? "debt" : "check");
}

export const defaultShortage = (id: string): ShortageRule => ({ mode: id === GOLD_ID ? "debt" : "check" });

/** Liest eine gespeicherte Regel; ungültiges fällt auf den Standard zurück. Der Standard selbst wird nicht gespeichert. */
export function normalizeShortage(raw: unknown, id: string): ShortageRule | undefined {
  if (!isObj(raw)) return undefined;
  const mode: ShortageMode = raw.mode === "check" || raw.mode === "debt" || raw.mode === "ignore" ? raw.mode : defaultShortage(id).mode;
  const rule: ShortageRule = { mode };
  if (mode !== "debt" && isObj(raw.effect)) {
    const weeks = Math.floor(Number(raw.effect.weeks));
    const entries: EffectEntry[] = [];
    if (Array.isArray(raw.effect.entries)) {
      for (const e of raw.effect.entries) {
        if (!isObj(e) || !KINDS.includes(e.kind as EffectKind) || typeof e.id !== "string" || !e.id) continue;
        const amount = normalizeAmount(e.kind as EffectKind, Number(e.amount));
        if (Number.isFinite(amount) && amount !== 0) entries.push({ kind: e.kind as EffectKind, id: e.id, amount });
      }
    }
    if (Number.isFinite(weeks) && weeks >= 1 && entries.length) {
      const name = typeof raw.effect.name === "string" && raw.effect.name.trim() ? raw.effect.name.trim().slice(0, 60) : "Engpass";
      rule.effect = { name, weeks: Math.min(weeks, MAX_SHORTAGE_WEEKS), entries };
    }
  }
  return rule.mode === defaultShortage(id).mode && !rule.effect ? undefined : rule;
}

export interface ShortageContext {
  stats: StatType[];
  weights: Weights;
  permanent: ActiveEffect[];
  triggerStats: StatEffect[];
  /** Ressourcen-ID → Verhalten */
  modes: Record<string, ShortageMode>;
  /** Höchstzahl der Prüfungen */
  maxChecks: number;
}

export interface ShortageResult {
  /** Gebäude-ID → Schlüssel ("resource:id" / "worker:id") der Engpässe, die zur Abschaltung führen */
  autoDisabled: Map<string, string[]>;
  /** Schlüssel → größter festgestellter Fehlbetrag (alle Engpässe außer Schulden, auch wenn sie durch Abschalten behoben wurden) */
  triggered: Record<string, number>;
  /** Engpässe, die sich durch Abschalten nicht beheben lassen */
  unresolved: string[];
  checks: number;
  /** Die Prüfungen reichten nicht aus: der Nutzer muss das Problem selbst beheben */
  exceeded: boolean;
}

export const resourceKey = (id: string): string => `resource:${id}`;
export const workerKey = (id: string): string => `worker:${id}`;

/**
 * Prüft die Wochenbilanz ohne die Bauaufträge. Jede Runde schaltet Verbraucher (zuletzt Gebaute zuerst) ab, bis der Fehlbetrag
 * gedeckt ist; dadurch entfallende Produktion kann in der nächsten Runde neue Engpässe erzeugen (Kette).
 * Manuell deaktivierte Gebäude zählen als aus. Die Berechnung beginnt immer von vorn, so werden Gebäude auch wieder aktiviert.
 */
export function resolveShortages(state: SettlementState, buildings: Building[], costsOf: CostsOf, ctx: ShortageContext): ShortageResult {
  const done = buildings.filter(b => b.status === "done" && !b.disabled);
  const debt = new Set(Object.entries(ctx.modes).filter(([, m]) => m === "debt").map(([id]) => id));
  const auto = new Map<string, string[]>();
  const triggered: Record<string, number> = {};
  const unresolved = new Set<string>();
  let checks = 0;
  let exceeded = false;

  for (;;) {
    checks++;
    const sim = done.map(b => ({ ...b, autoDisabled: auto.has(b.id) }));
    const r = computeWeek(state, sim, costsOf, ctx.stats, ctx.weights, ctx.permanent, ctx.triggerStats, debt);
    const found: { key: string; deficit: number; fixable: boolean }[] = [];
    for (const x of r.resources) {
      if (x.shortfall > 0 && ctx.modes[x.id] !== "debt") found.push({ key: resourceKey(x.id), deficit: x.shortfall, fixable: (ctx.modes[x.id] ?? "check") === "check" });
    }
    for (const l of r.labor) if (l.shortfall > 0) found.push({ key: workerKey(l.id), deficit: l.shortfall, fixable: true });
    for (const f of found) triggered[f.key] = Math.max(triggered[f.key] ?? 0, f.deficit);
    for (const f of found) if (!f.fixable) unresolved.add(f.key);

    const fixable = found.filter(f => f.fixable);
    if (!fixable.length) break;
    if (checks >= ctx.maxChecks) {
      exceeded = true;
      break;
    }
    let changed = false;
    for (const f of fixable) {
      const [kind, id] = [f.key.slice(0, f.key.indexOf(":")), f.key.slice(f.key.indexOf(":") + 1)];
      let covered = 0;
      for (let i = done.length - 1; i >= 0 && covered < f.deficit; i--) {
        const b = done[i];
        if (auto.has(b.id)) continue;
        const use = costsOf(b).upkeep.filter(e => e.kind === kind && e.id === id && e.amount > 0).reduce((a, e) => a + e.amount, 0);
        if (use <= 0) continue;
        auto.set(b.id, [f.key]);
        covered += use;
        changed = true;
      }
      if (covered < f.deficit) unresolved.add(f.key);
    }
    if (!changed) break;
  }
  return { autoDisabled: auto, triggered, unresolved: [...unresolved], checks, exceeded };
}
