import { ID } from "./constants";
import { getBuildings, costsOf } from "./store";
import { getRoadOrders, getRoads, getRoadType } from "./roads-store";
import { applyRoadWeek, isRoadId, orderAsBuilding } from "./roads";
import { entryChips, getAsset, getLaws, getStats, getTriggers, getWeights, getResources, getWorkers } from "./definitions";
import { clampStat, defaultStatValue, describeInterval } from "./stats";
import { applyStatChanges, computeWeek, sumEffects } from "./week";
import { normalizeEffects, sumEntries } from "./effects";
import { firedTriggers, normalizeTriggerSwitches, triggerEffects } from "./triggers";
import type { Snapshot } from "./triggers";
import { lawEffects, normalizeLawStates } from "./laws";
import type { StatReport, WeekResult } from "./week";
import { escapeHTML } from "./util";
import { SETTING_MAX_CHECKS, DEFAULT_MAX_CHECKS, resolveShortages, shortageMode, resourceKey, workerKey } from "./shortage";
import type { Building, ShortageMode } from "./types";
import type { ActiveEffect, CostKind, SettlementState, StatEffect, Trigger } from "./types";

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Vorräte der aktuellen (oder angegebenen) Siedlungsszene; fehlende Werte gelten als 0. */
export function getSettlement(scene: any = canvas?.scene): SettlementState {
  const raw = scene?.getFlag(ID, "settlement");
  return {
    week: Number.isFinite(raw?.week) ? raw.week : 1,
    resources: { ...(raw?.resources ?? {}) },
    workers: { ...(raw?.workers ?? {}) },
    stats: { ...(raw?.stats ?? {}) },
    effects: normalizeEffects(raw?.effects),
    laws: normalizeLawStates(raw?.laws),
    lawChanges: Number.isFinite(raw?.lawChanges) && raw.lawChanges > 0 ? Math.floor(raw.lawChanges) : 0,
    triggers: normalizeTriggerSwitches(raw?.triggers)
  };
}

/** SL: setzt den Vorrat einer Ressource bzw. die Wochenkapazität einer Arbeiterart (ganze Zahl, mindestens 0). */
export async function setAmount(kind: CostKind, id: string, amount: number): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  // Ressourcen mit erlaubten Schulden dürfen negativ sein
  const debt = kind === "resource" && shortageMode(getResources().find(r => r.id === id) ?? { id }) === "debt";
  const value = Number.isFinite(amount) ? (debt ? Math.round(amount) : Math.max(0, Math.round(amount))) : 0;
  const state = getSettlement();
  state[kind === "resource" ? "resources" : "workers"][id] = value;
  await canvas.scene.setFlag(ID, "settlement", state);
}

/** SL: setzt den Wert eines Stats (Intervall: auf die Grenzen begrenzt, offen: ganze Zahl ≥ 0). */
export async function setStat(id: string, amount: number): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const stat = getStats().find(s => s.id === id);
  if (!stat) return;
  const state = getSettlement();
  state.stats[id] = clampStat(stat, amount);
  await canvas.scene.setFlag(ID, "settlement", state);
}

/** Dauerhafte Effekte der aktiven Ausprägungen aller Gesetze der Siedlung. */
export const permanentEffects = (state: SettlementState): ActiveEffect[] => lawEffects(getLaws(), state.laws);

/**
 * Momentaufnahme für die Bedingungen der Trigger: Werte und Arbeiter mit Zuschlägen aus Effekten und Gesetzen
 * (aber ohne die Wirkung der Trigger selbst, damit sie sich nicht gegenseitig im Kreis auslösen), Vorräte wie gelagert.
 */
export function triggerSnapshot(state: SettlementState): Snapshot {
  const fx = [...state.effects, ...permanentEffects(state)];
  const bonusStat = sumEntries(fx, "stat");
  const bonusWorker = sumEntries(fx, "worker");
  const snap: Snapshot = { stat: {}, resource: {}, worker: {} };
  for (const s of getStats()) snap.stat[s.id] = clampStat(s, clampStat(s, state.stats[s.id] ?? defaultStatValue(s)) + (bonusStat[s.id] ?? 0));
  for (const r of getResources()) snap.resource[r.id] = state.resources[r.id] ?? 0;
  for (const w of getWorkers()) snap.worker[w.id] = Math.max(0, (state.workers[w.id] ?? 0) + (bonusWorker[w.id] ?? 0));
  return snap;
}

/** Aktuell ausgelöste Trigger der Siedlung samt ihrer zerlegten Wirkung. */
export function currentTriggers(state: SettlementState): { fired: Trigger[] } & ReturnType<typeof triggerEffects> {
  const fired = firedTriggers(getTriggers(), state.triggers, triggerSnapshot(state));
  return { fired, ...triggerEffects(fired) };
}

/** SL: schaltet einen Trigger für die aktuelle Siedlung ein oder aus. */
export async function setTriggerEnabled(id: string, enabled: boolean): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const state = getSettlement();
  state.triggers[id] = enabled;
  await canvas.scene.setFlag(ID, "settlement", state);
}

/** SL: fügt einen aktiven Effekt hinzu. */
export async function addEffect(effect: Omit<ActiveEffect, "id">): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const state = getSettlement();
  const [fx] = normalizeEffects([{ ...effect, id: foundry.utils.randomID() }]);
  if (!fx) return;
  state.effects.push(fx);
  await canvas.scene.setFlag(ID, "settlement", state);
}

/** SL: entfernt einen aktiven Effekt sofort. */
export async function removeEffect(id: string): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const state = getSettlement();
  state.effects = state.effects.filter(e => e.id !== id);
  await canvas.scene.setFlag(ID, "settlement", state);
}

/** SL: ändert die Restdauer eines Effekts (0 entfernt ihn). */
export async function setEffectDuration(id: string, weeks: number): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const state = getSettlement();
  const n = Number.isFinite(weeks) ? Math.floor(weeks) : 0;
  state.effects = n < 1 ? state.effects.filter(e => e.id !== id) : state.effects.map(e => (e.id === id ? { ...e, remaining: n } : e));
  await canvas.scene.setFlag(ID, "settlement", state);
}

/** SL: springt zur nächsten Arbeitswoche, speichert das Ergebnis und veröffentlicht die Übersicht im Chat. */
/** Verhalten aller Ressourcen bei Engpass. */
export const shortageModes = (): Record<string, ShortageMode> => Object.fromEntries(getResources().map(r => [r.id, shortageMode(r)]));

const maxChecks = (): number => {
  const v = Number(game.settings.get(ID, SETTING_MAX_CHECKS));
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_MAX_CHECKS;
};

/**
 * Engpass-Prüfung einer Szene: welche Gebäude sind vorübergehend abgeschaltet (Gebäude mit gesetztem autoDisabled),
 * welche Engpässe gibt es, und reichen die Prüfungen aus.
 */
export function evaluateShortages(scene: any = canvas?.scene) {
  const state = getSettlement(scene);
  const trig = currentTriggers(state);
  const permanent = [...permanentEffects(state), ...(trig.effect ? [trig.effect] : [])];
  const list = getBuildings(scene);
  const result = resolveShortages(state, list, costsOf, { stats: getStats(), weights: getWeights(), permanent, triggerStats: trig.statWeekly, modes: shortageModes(), maxChecks: maxChecks() });
  const buildings: Building[] = list.map(b => {
    const { autoDisabled: _old, ...rest } = b;
    return result.autoDisabled.has(b.id) ? { ...rest, autoDisabled: true } : rest;
  });
  return { result, buildings, trig, permanent, state };
}

/** Rechnet die nächste Woche durch (ohne zu speichern); Wege laufen als Bauaufträge mit. */
function runWeek(scene: any): { result: WeekResult; fired: Trigger[]; roadWeek: ReturnType<typeof applyRoadWeek>; roadStalled: number; exceeded: boolean; shortageLines: string[] } {
  // Engpässe zuerst auflösen: abgeschaltete Gebäude verbrauchen und erzeugen in dieser Woche nichts
  const ev = evaluateShortages(scene);
  const before = ev.state;
  const trig = ev.trig;
  const permanent = ev.permanent;
  // Wegaufträge laufen als Bauaufträge mit einem Feld durch dieselbe Rechnung (nach den Gebäuden)
  const roads = getRoads(scene);
  const orders = getRoadOrders(scene);
  const pseudo = orders.flatMap(o => {
    const type = getRoadType(o.typeId);
    return type ? [orderAsBuilding(o, type)] : [];
  });
  const costs: typeof costsOf = b => (isRoadId(b.id) ? { buildCost: b.buildCost ?? [], upkeep: [], statEffects: [] } : costsOf(b));
  const debt = new Set(Object.entries(shortageModes()).filter(([, m]) => m === "debt").map(([id]) => id));
  const result = computeWeek(before, [...ev.buildings, ...pseudo], costs, getStats(), getWeights(), permanent, trig.statWeekly, debt);
  const roadWeek = applyRoadWeek(roads, orders, result.buildings);
  const roadStalled = result.stalled.filter(n => isRoadId(n)).length;
  result.buildings = result.buildings.filter(b => !isRoadId(b.id));
  result.progress = result.progress.filter(p => !isRoadId(p.id));
  result.stalled = result.stalled.filter(n => !isRoadId(n));

  // Engpässe: Meldung und Effekte (z. B. Hungersnot), ein bestehender Effekt der Ressource wird erneuert
  const shortageLines: string[] = [];
  const names = (ids: string[]): string => ids.map(escapeHTML).join(", ");
  for (const r of getResources()) {
    const deficit = ev.result.triggered[resourceKey(r.id)];
    if (deficit === undefined) continue;
    const off = result.buildings.filter(b => b.autoDisabled && ev.result.autoDisabled.get(b.id)?.includes(resourceKey(r.id))).map(b => b.name);
    let line = `<li>${escapeHTML(r.name)}: ${t("SIEDLUNG.shortage.missing", { amount: deficit })}${off.length ? ` – ${t("SIEDLUNG.shortage.switchedOff")}: ${names(off)}` : ""}`;
    const effect = r.shortage?.effect;
    if (effect && shortageMode(r) !== "debt") {
      const id = `shortage:${r.id}`;
      result.state.effects = [...result.state.effects.filter(e => e.id !== id), { id, name: effect.name, remaining: effect.weeks, entries: effect.entries.map(e => ({ ...e })) }];
      line += ` – <strong>${escapeHTML(effect.name)}</strong> (${t("SIEDLUNG.shortage.weeks", { weeks: effect.weeks })})`;
    }
    shortageLines.push(`${line}</li>`);
  }
  for (const w of getWorkers()) {
    const deficit = ev.result.triggered[workerKey(w.id)];
    if (deficit === undefined) continue;
    const off = result.buildings.filter(b => b.autoDisabled && ev.result.autoDisabled.get(b.id)?.includes(workerKey(w.id))).map(b => b.name);
    shortageLines.push(`<li>${escapeHTML(w.name)}: ${t("SIEDLUNG.shortage.missing", { amount: deficit })}${off.length ? ` – ${t("SIEDLUNG.shortage.switchedOff")}: ${names(off)}` : ""}</li>`);
  }
  return { result, fired: trig.fired, roadWeek, roadStalled, exceeded: ev.result.exceeded, shortageLines };
}

/** Voraussichtliche Entwicklung der nächsten Woche je Ressource (Saldo) und Arbeiterart (Zu-/Abgang freier Arbeitskraft). */
export function weekTrend(scene: any = canvas?.scene): { resources: Record<string, { net: number; shortfall: number; detail: string }>; workers: Record<string, { net: number; shortfall: number; detail: string }> } {
  const out = { resources: {} as Record<string, { net: number; shortfall: number; detail: string }>, workers: {} as Record<string, { net: number; shortfall: number; detail: string }> };
  if (!scene) return out;
  try {
    const { result } = runWeek(scene);
    for (const r of result.resources) {
      const parts: string[] = [];
      const upkeepNet = r.produced - r.consumed - r.effect;
      if (upkeepNet) parts.push(`${t("SIEDLUNG.week.upkeep")} ${signed(upkeepNet)}`);
      if (r.effect) parts.push(`${t("SIEDLUNG.week.effects")} ${signed(r.effect)}`);
      if (r.built) parts.push(`${t("SIEDLUNG.week.build")} ${signed(-r.built)}`);
      out.resources[r.id] = { net: r.after - r.before, shortfall: r.shortfall, detail: parts.join(", ") };
    }
    for (const l of result.labor) {
      const parts: string[] = [];
      if (l.produced) parts.push(`${t("SIEDLUNG.week.upkeep")} ${signed(l.produced)}`);
      if (l.used) parts.push(`${t("SIEDLUNG.week.build")} ${signed(-l.used)}`);
      out.workers[l.id] = { net: l.produced - l.used, shortfall: l.shortfall, detail: parts.join(", ") };
    }
  } catch (err) {
    console.warn("siedlungsbau | Tendenz konnte nicht berechnet werden", err);
  }
  return out;
}

export async function advanceWeek(): Promise<void> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene) return;
  const { result, fired, roadWeek, roadStalled, exceeded, shortageLines } = runWeek(scene);
  if (exceeded) {
    ui.notifications.error(t("SIEDLUNG.shortage.blocked"));
    return;
  }
  await scene.update({ flags: { [ID]: { settlement: result.state, buildings: result.buildings, roads: roadWeek.roads, roadOrders: roadWeek.orders } } });
  await ChatMessage.create({
    speaker: { alias: t("SIEDLUNG.title") },
    content: renderReport(result, fired, { completed: roadWeek.completed, pending: roadWeek.pending, stalled: roadStalled }, shortageLines)
  });
}

const dot = (color: string): string =>
  `<span style="display:inline-block;width:.7em;height:.7em;border-radius:50%;background:${color};margin-right:.35em"></span>`;
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const percent = (f: number): string => `${Math.round(f * 100)} %`;

function renderReport(result: WeekResult, fired: Trigger[] = [], roadWeek?: { completed: number; pending: number; stalled: number }, shortageLines: string[] = []): string {
  const label = (kind: CostKind, id: string): string => {
    const asset = getAsset(kind, id);
    return `${dot(asset?.color ?? "#888")}${escapeHTML(asset?.name ?? id)}`;
  };
  const plain = (kind: CostKind, id: string): string => escapeHTML(getAsset(kind, id)?.name ?? id);
  const parts: string[] = [`<h3>${t("SIEDLUNG.week.title", { week: result.state.week })}</h3>`];

  // Vorräte
  const rows = result.resources
    .filter(r => r.before !== r.after || r.shortfall > 0)
    .map(r => {
      const detail: string[] = [];
      const upkeepNet = r.produced - r.consumed - r.effect;
      if (upkeepNet !== 0) detail.push(`${t("SIEDLUNG.week.upkeep")} ${signed(upkeepNet)}`);
      if (r.effect !== 0) detail.push(`${t("SIEDLUNG.week.effects")} ${signed(r.effect)}`);
      if (r.built > 0) detail.push(`${t("SIEDLUNG.week.build")} ${signed(-r.built)}`);
      return `<tr><td>${label("resource", r.id)}</td><td>${r.before} → <strong>${r.after}</strong></td><td>${detail.join(", ")}</td></tr>`;
    });
  if (rows.length) parts.push(`<p><strong>${t("SIEDLUNG.week.stock")}</strong></p><table>${rows.join("")}</table>`);
  for (const r of result.resources.filter(x => x.shortfall > 0)) {
    parts.push(`<p>⚠ ${t("SIEDLUNG.week.shortfall", { name: plain("resource", r.id), amount: r.shortfall })}</p>`);
  }

  if (shortageLines.length) parts.push(`<p><strong>${t("SIEDLUNG.shortage.title")}</strong></p><ul>${shortageLines.join("")}</ul>`);

  // Werte
  const statLines = result.stats.map(statLine).filter(Boolean);
  if (statLines.length) parts.push(`<p><strong>${t("SIEDLUNG.week.stats")}</strong></p><ul>${statLines.join("")}</ul>`);

  // Arbeitskraft
  const labor = result.labor.filter(l => l.capacity > 0 || l.used > 0 || l.committed > 0 || l.effect !== 0);
  if (labor.length) {
    const lines = labor.map(l => {
      const bound = (l.committed > 0 ? ` (${t("SIEDLUNG.week.laborBound", { bound: l.committed })})` : "") + (l.effect ? ` (${t("SIEDLUNG.week.effects")} ${signed(l.effect)})` : "");
      return `<li>${dot(getAsset("worker", l.id)?.color ?? "#888")}${t("SIEDLUNG.week.laborLine", { name: plain("worker", l.id), used: l.used, available: l.available })}${bound}</li>`;
    });
    parts.push(`<p><strong>${t("SIEDLUNG.week.labor")}</strong></p><ul>${lines.join("")}</ul>`);
  }
  for (const l of result.labor.filter(x => x.shortfall > 0)) {
    parts.push(`<p>⚠ ${t("SIEDLUNG.week.laborShortfall", { name: plain("worker", l.id), amount: l.shortfall })}</p>`);
  }

  // Effekte
  const fxLines = [
    ...result.effects.active.map(fx => `<li>${escapeHTML(fx.name)}: ${t("SIEDLUNG.week.effectRemaining", { weeks: fx.remaining })}</li>`),
    ...result.effects.expired.map(fx => `<li>${escapeHTML(fx.name)}: <strong>${t("SIEDLUNG.week.effectExpired")}</strong></li>`)
  ];
  if (fxLines.length) parts.push(`<p><strong>${t("SIEDLUNG.week.effectsTitle")}</strong></p><ul>${fxLines.join("")}</ul>`);

  // Ausgelöste Trigger (für Spieler sichtbar sind die Namen und Wirkungen, nicht versteckte Trigger)
  const shown = fired.filter(f => !f.hidden);
  if (shown.length) {
    const lines = shown.map(f => {
      const chips = entryChips(f.entries).map((c, i) => {
        const mode = f.entries[i].kind === "stat" ? ` ${t(f.entries[i].mode === "modifier" ? "SIEDLUNG.triggers.modeModifierShort" : "SIEDLUNG.triggers.modeWeeklyShort")}` : "";
        return `${c.text} ${escapeHTML(c.name)}${mode}`;
      });
      return `<li><strong>${escapeHTML(f.name)}</strong>: ${chips.join(", ")}</li>`;
    });
    parts.push(`<p><strong>${t("SIEDLUNG.triggers.reportTitle")}</strong></p><ul>${lines.join("")}</ul>`);
  }

  // Baufortschritt
  if (result.progress.length) {
    const items = result.progress.map(p => {
      const done = p.completed ? ` – <strong>${t("SIEDLUNG.week.completed")}</strong> ✔` : "";
      return `<li>${escapeHTML(p.name)}: ${t("SIEDLUNG.settlement.material")} ${percent(p.res)}, ${t("SIEDLUNG.settlement.work")} ${percent(p.lab)}${done}</li>`;
    });
    parts.push(`<p><strong>${t("SIEDLUNG.week.progress")}</strong></p><ul>${items.join("")}</ul>`);
  }
  if (roadWeek && (roadWeek.completed || roadWeek.pending)) {
    parts.push(`<p>${t("SIEDLUNG.roads.report", { done: roadWeek.completed, pending: roadWeek.pending, stalled: roadWeek.stalled })}</p>`);
  }
  if (result.stalled.length) {
    parts.push(`<p>${t("SIEDLUNG.week.stalled", { names: result.stalled.map(escapeHTML).join(", ") })}</p>`);
  }
  if (parts.length === 1) parts.push(`<p>${t("SIEDLUNG.week.nothing")}</p>`);
  return parts.join("");
}

/** Eine Chat-Zeile zur Veränderung eines Werts, z. B. "Moral: 50 → 57 (+7: +5 einmalig, +2 pro Woche) – Gut". */
function statLine(r: StatReport): string {
  const stat = getStats().find(s => s.id === r.id);
  if (!stat) return "";
  const label = stat.kind === "interval" ? describeInterval(stat, r.after).name : "";
  const parts: string[] = [];
  if (r.once) parts.push(`${signed(r.once)} ${t("SIEDLUNG.week.once")}`);
  if (r.weekly) parts.push(`${signed(r.weekly)} ${t("SIEDLUNG.week.weekly")}`);
  const delta = Math.round((r.after - r.before) * 100) / 100;
  const limited = Math.abs(delta - r.change) > 1e-9 ? ` – ${t("SIEDLUNG.week.statLimit")}` : "";
  return `<li>${escapeHTML(stat.name)}: ${r.before} → <strong>${r.after}</strong> (${signed(delta)}; ${parts.join(", ")})${label ? ` – ${escapeHTML(label)}` : ""}${limited}</li>`;
}

/** SL: wendet die einmaligen Wirkungen eines fertiggestellten Gebäudes an (reverse: nimmt sie beim Abriss zurück); liefert Chat-Zeilen. */
export async function applyOnceEffects(effects: StatEffect[], reverse = false): Promise<string[]> {
  const once = sumEffects(effects, "once");
  if (reverse) for (const id of Object.keys(once)) once[id] = -once[id];
  if (!Object.keys(once).length || !canvas.scene) return [];
  const state = getSettlement();
  const { values, reports } = applyStatChanges(getStats(), state.stats, {}, once);
  if (!reports.length) return [];
  state.stats = values;
  await canvas.scene.setFlag(ID, "settlement", state);
  return reports.map(statLine).filter(Boolean);
}
