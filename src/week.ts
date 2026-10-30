// Reine Rechenlogik der Arbeitswoche (ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import { clampStat, defaultStatValue } from "./stats";
import { sumEntries, tickEffects } from "./effects";
import type { ActiveEffect, Building, CostEntry, CostKind, Progress, SettlementState, StatEffect, StatType } from "./types";

export interface Costs {
  buildCost: CostEntry[];
  upkeep: CostEntry[];
  statEffects?: StatEffect[];
}
export type CostsOf = (b: Building) => Costs;

/** Baugewicht je Ressourcen-ID; fehlende oder ungültige Einträge zählen als 1. */
export type Weights = Record<string, number>;

const weightOf = (weights: Weights, id: string): number => {
  const w = weights[id];
  return typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : 1;
};

/**
 * Materialanteil eines Bauauftrags (0..1), gewichtet nach Baugewicht: Σ(Gewicht · gelieferte Menge) / Σ(Gewicht · Bedarf).
 * Ist die gewichtete Summe 0 (alle Gewichte 0), zählen alle Ressourcen gleich. Ohne Bedarf gilt der Anteil als erfüllt.
 */
export function resourceFraction(buildCost: CostEntry[], p: Progress | undefined, weights: Weights = {}): number {
  const res = buildCost.filter(e => e.kind === "resource");
  const weighted = res.reduce((a, e) => a + weightOf(weights, e.id) * e.amount, 0);
  const w = (id: string): number => (weighted > 0 ? weightOf(weights, id) : 1);
  const total = res.reduce((a, e) => a + w(e.id) * e.amount, 0);
  if (total <= 0) return 1;
  const got = res.reduce((a, e) => a + w(e.id) * Math.min(e.amount, p?.resources?.[e.id] ?? 0), 0);
  return got / total;
}

export interface ResourceReport {
  id: string;
  before: number;
  after: number;
  /** durch Betrieb produziert (positiv) */
  produced: number;
  /** durch Betrieb verbraucht */
  consumed: number;
  /** in Bauaufträge geflossen */
  built: number;
  /** Betriebskosten, die nicht gedeckt werden konnten */
  shortfall: number;
  /** Saldo durch aktive Effekte (bereits in produced/consumed enthalten) */
  effect: number;
}

export interface LaborReport {
  id: string;
  /** Basiskapazität (ohne Effekte) */
  capacity: number;
  /** Zuschlag durch aktive Effekte */
  effect: number;
  /** durch Betrieb hinzugekommen (Gebäude mit negativen Personal-Betriebskosten) */
  produced: number;
  /** durch den Betrieb fertiger Gebäude gebunden */
  committed: number;
  /** Personal-Betriebskosten, die die Kapazität überstiegen */
  shortfall: number;
  /** für Bauaufträge zur Verfügung stehend */
  available: number;
  /** tatsächlich auf Baustellen eingesetzt */
  used: number;
}

export interface BuildingReport {
  id: string;
  name: string;
  /** Anteil Material (0..1) */
  res: number;
  /** Anteil Arbeit (0..1) */
  lab: number;
  completed: boolean;
}

/** Wendet Änderungen {statId: Summe} auf Werte an (begrenzt auf den Wertebereich); liefert nur tatsächlich betroffene Stats. */
export function applyStatChanges(
  stats: StatType[], values: Record<string, number>, net: Record<string, number>, once: Record<string, number> = {}
): { values: Record<string, number>; reports: StatReport[] } {
  const out: Record<string, number> = { ...values };
  const reports: StatReport[] = [];
  for (const stat of stats) {
    const weekly = Math.round((net[stat.id] ?? 0) * 100) / 100;
    const single = Math.round((once[stat.id] ?? 0) * 100) / 100;
    const change = Math.round((weekly + single) * 100) / 100;
    if (!change) continue;
    const before = clampStat(stat, values[stat.id] ?? defaultStatValue(stat));
    const after = clampStat(stat, before + change);
    out[stat.id] = after;
    reports.push({ id: stat.id, before, after, change, weekly, once: single });
  }
  return { values: out, reports };
}

/** Summe der einmaligen Wirkungen einer Liste von Effekten pro Stat. */
export function sumEffects(effects: StatEffect[], mode: "weekly" | "once"): Record<string, number> {
  const net: Record<string, number> = {};
  for (const e of effects) if ((e.mode ?? "weekly") === mode) net[e.id] = (net[e.id] ?? 0) + e.amount;
  return net;
}

export interface StatReport {
  id: string;
  before: number;
  after: number;
  /** Summe der Wirkungen fertiger Gebäude (kann durch die Grenzen des Werts größer sein als after - before) */
  change: number;
  /** Anteil der wöchentlichen Wirkungen */
  weekly: number;
  /** Anteil der einmaligen Wirkungen (neu fertiggestellte Gebäude) */
  once: number;
}

export interface WeekResult {
  state: SettlementState;
  stats: StatReport[];
  buildings: Building[];
  resources: ResourceReport[];
  labor: LaborReport[];
  progress: BuildingReport[];
  /** Namen der Bauaufträge, die diese Woche nichts erhalten haben */
  stalled: string[];
  /** Effekte: weiterhin aktiv (mit neuer Restdauer) und ausgelaufen */
  effects: { active: ActiveEffect[]; expired: ActiveEffect[] };
}

const KEY = { resource: "resources", worker: "workers" } as const;

const required = (costs: CostEntry[], kind: CostKind): number =>
  costs.filter(e => e.kind === kind).reduce((a, e) => a + e.amount, 0);

const delivered = (costs: CostEntry[], kind: CostKind, p: Progress | undefined): number =>
  costs.filter(e => e.kind === kind).reduce((a, e) => a + Math.min(e.amount, p?.[KEY[kind]]?.[e.id] ?? 0), 0);

/** Fertigstellungsgrad eines Bauauftrags: Material- und Arbeitsanteil (0..1); ohne Bedarf gilt der Anteil als erfüllt. */
export function fractions(b: Building, costs: Costs, weights: Weights = {}): { res: number; lab: number } {
  const req = required(costs.buildCost, "worker");
  return {
    res: resourceFraction(costs.buildCost, b.progress, weights),
    lab: req > 0 ? delivered(costs.buildCost, "worker", b.progress) / req : 1
  };
}

/** Netto durch Betrieb fertiger Gebäude gebundene Arbeitskraft je Arbeiterart (negativ = Gebäude liefert Arbeitskraft). */
export function laborCommitted(buildings: Building[], costsOf: CostsOf): Record<string, number> {
  const net: Record<string, number> = {};
  for (const b of buildings) {
    if (b.status !== "done") continue;
    for (const e of costsOf(b).upkeep) if (e.kind === "worker") net[e.id] = (net[e.id] ?? 0) + e.amount;
  }
  return net;
}

/**
 * Berechnet den Sprung zur nächsten Arbeitswoche.
 *
 * 1. Betrieb: Fertige Gebäude verbrauchen Ressourcen bzw. produzieren sie (negative Mengen). Produktion wird zuerst
 *    gutgeschrieben; was fehlt, wird als Fehlbetrag gemeldet (Vorrat sinkt höchstens auf 0).
 *    Personal im Betrieb bindet Arbeitskraft dieser Woche (negativ: erhöht sie).
 * 2. Bau: Aufträge in der Reihenfolge ihrer Beauftragung. Material wird dauerhaft dem Gebäude zugeordnet.
 *    Arbeit kommt aus dem Wochenvorrat an Arbeitskraft, aber nur so weit, dass der Arbeitsanteil nie über dem
 *    Materialanteil liegt. Ist alles geliefert, gilt das Gebäude als fertig.
 */
export function computeWeek(
  state: SettlementState,
  buildings: Building[],
  costsOf: CostsOf,
  stats: StatType[] = [],
  weights: Weights = {},
  /** Dauerhafte Effekte (aktive Ausprägungen der Gesetze); werden nicht heruntergezählt */
  permanent: ActiveEffect[] = []
): WeekResult {
  const stock: Record<string, number> = { ...state.resources };
  const have = (id: string): number => stock[id] ?? 0;
  const add = (map: Record<string, number>, id: string, n: number): void => {
    map[id] = (map[id] ?? 0) + n;
  };

  // --- 1. Betrieb -------------------------------------------------------
  const wantRes: Record<string, number> = {};
  const prodRes: Record<string, number> = {};
  const wantLab: Record<string, number> = {};
  const prodLab: Record<string, number> = {};
  for (const b of buildings) {
    if (b.status !== "done") continue;
    for (const e of costsOf(b).upkeep) {
      const want = e.kind === "resource" ? wantRes : wantLab;
      const prod = e.kind === "resource" ? prodRes : prodLab;
      if (e.amount > 0) add(want, e.id, e.amount);
      else if (e.amount < 0) add(prod, e.id, -e.amount);
    }
  }

  // Aktive Effekte: Ressourcen wirken wie Betrieb (positiv = Produktion), Arbeiter erhöhen die Wochenkapazität
  const timedEffects = state.effects ?? [];
  const activeEffects = [...timedEffects, ...permanent];
  const effRes = sumEntries(activeEffects, "resource");
  const effLab = sumEntries(activeEffects, "worker");
  for (const [id, n] of Object.entries(effRes)) {
    if (n > 0) add(prodRes, id, n);
    else if (n < 0) add(wantRes, id, -n);
  }

  const reports = new Map<string, ResourceReport>();
  const report = (id: string): ResourceReport => {
    let r = reports.get(id);
    if (!r) {
      r = { id, before: have(id), after: have(id), produced: 0, consumed: 0, built: 0, shortfall: 0, effect: effRes[id] ?? 0 };
      reports.set(id, r);
    }
    return r;
  };

  for (const id of new Set([...Object.keys(wantRes), ...Object.keys(prodRes)])) {
    const r = report(id);
    const available = have(id) + (prodRes[id] ?? 0);
    const consumed = Math.min(available, wantRes[id] ?? 0);
    r.produced = prodRes[id] ?? 0;
    r.consumed = consumed;
    r.shortfall = (wantRes[id] ?? 0) - consumed;
    stock[id] = available - consumed;
  }

  const pool: Record<string, number> = {};
  const laborReports = new Map<string, LaborReport>();
  for (const id of new Set([...Object.keys(state.workers), ...Object.keys(wantLab), ...Object.keys(prodLab), ...Object.keys(effLab)])) {
    const capacity = state.workers[id] ?? 0;
    const effect = effLab[id] ?? 0;
    const effective = Math.max(0, capacity + effect) + (prodLab[id] ?? 0);
    const committed = Math.min(effective, wantLab[id] ?? 0);
    pool[id] = effective - committed;
    laborReports.set(id, {
      id,
      capacity,
      effect,
      produced: prodLab[id] ?? 0,
      committed,
      shortfall: (wantLab[id] ?? 0) - committed,
      available: pool[id],
      used: 0
    });
  }

  // --- 2. Bau -----------------------------------------------------------
  const progress: BuildingReport[] = [];
  const stalled: string[] = [];
  const updated = buildings.map((b): Building => {
    if (b.status !== "ordered") return b;
    const { buildCost } = costsOf(b);
    const prog: Progress = { resources: { ...b.progress?.resources }, workers: { ...b.progress?.workers } };
    let gained = false;

    for (const e of buildCost) {
      if (e.kind !== "resource") continue;
      const r = report(e.id);
      const take = Math.min(e.amount - (prog.resources[e.id] ?? 0), have(e.id));
      if (take > 0) {
        prog.resources[e.id] = (prog.resources[e.id] ?? 0) + take;
        stock[e.id] = have(e.id) - take;
        r.built += take;
        gained = true;
      }
    }

    // Arbeitsanteil darf den Materialanteil nie übersteigen
    const resFrac = resourceFraction(buildCost, prog, weights);
    const reqLab = required(buildCost, "worker");
    let allowed = Math.max(0, Math.floor(resFrac * reqLab + 1e-9) - delivered(buildCost, "worker", prog));
    for (const e of buildCost) {
      if (e.kind !== "worker") continue;
      const take = Math.min(e.amount - (prog.workers[e.id] ?? 0), pool[e.id] ?? 0, allowed);
      if (take > 0) {
        prog.workers[e.id] = (prog.workers[e.id] ?? 0) + take;
        pool[e.id] = (pool[e.id] ?? 0) - take;
        allowed -= take;
        const lr = laborReports.get(e.id);
        if (lr) lr.used += take;
        gained = true;
      }
    }

    const complete = buildCost.every(e => (prog[KEY[e.kind]][e.id] ?? 0) >= e.amount);
    const f = fractions({ ...b, progress: prog }, { buildCost, upkeep: [] }, weights);
    if (gained || complete) progress.push({ id: b.id, name: b.name, res: f.res, lab: f.lab, completed: complete });
    else stalled.push(b.name);
    return { ...b, progress: prog, status: complete ? "done" : "ordered" };
  });

  for (const r of reports.values()) r.after = have(r.id);

  // --- 3. Werte ---------------------------------------------------------
  // Wöchentliche Wirkungen: nur Gebäude, die zu Beginn der Woche fertig waren.
  // Einmalige Wirkungen: Gebäude, die in dieser Woche fertig geworden sind.
  const weeklyEffects: StatEffect[] = [];
  const onceEffects: StatEffect[] = [];
  buildings.forEach((b, i) => {
    const effects = costsOf(b).statEffects ?? [];
    if (b.status === "done") weeklyEffects.push(...effects);
    else if (updated[i].status === "done") onceEffects.push(...effects);
  });
  const applied = applyStatChanges(stats, state.stats, sumEffects(weeklyEffects, "weekly"), sumEffects(onceEffects, "once"));
  const statValues = applied.values;
  const statReports = applied.reports;

  const ticked = tickEffects(timedEffects);

  return {
    state: { ...state, week: state.week + 1, resources: stock, workers: { ...state.workers }, stats: statValues, effects: ticked.active, lawChanges: 0 },
    effects: ticked,
    stats: statReports,
    buildings: updated,
    resources: [...reports.values()],
    labor: [...laborReports.values()],
    progress,
    stalled
  };
}
