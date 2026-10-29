import { ID } from "./constants";
import { getBuildings, costsOf } from "./store";
import { getAsset, getStats } from "./definitions";
import { clampStat } from "./stats";
import { computeWeek } from "./week";
import type { WeekResult } from "./week";
import { escapeHTML } from "./util";
import type { CostKind, SettlementState } from "./types";

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Vorräte der aktuellen (oder angegebenen) Siedlungsszene; fehlende Werte gelten als 0. */
export function getSettlement(scene: any = canvas?.scene): SettlementState {
  const raw = scene?.getFlag(ID, "settlement");
  return {
    week: Number.isFinite(raw?.week) ? raw.week : 1,
    resources: { ...(raw?.resources ?? {}) },
    workers: { ...(raw?.workers ?? {}) },
    stats: { ...(raw?.stats ?? {}) }
  };
}

/** SL: setzt den Vorrat einer Ressource bzw. die Wochenkapazität einer Arbeiterart (ganze Zahl, mindestens 0). */
export async function setAmount(kind: CostKind, id: string, amount: number): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const value = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
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

/** SL: springt zur nächsten Arbeitswoche, speichert das Ergebnis und veröffentlicht die Übersicht im Chat. */
export async function advanceWeek(): Promise<void> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene) return;
  const result = computeWeek(getSettlement(scene), getBuildings(scene), costsOf);
  await scene.update({ flags: { [ID]: { settlement: result.state, buildings: result.buildings } } });
  await ChatMessage.create({ speaker: { alias: t("SIEDLUNG.title") }, content: renderReport(result) });
}

const dot = (color: string): string =>
  `<span style="display:inline-block;width:.7em;height:.7em;border-radius:50%;background:${color};margin-right:.35em"></span>`;
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const percent = (f: number): string => `${Math.round(f * 100)} %`;

function renderReport(result: WeekResult): string {
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
      const upkeepNet = r.produced - r.consumed;
      if (upkeepNet !== 0) detail.push(`${t("SIEDLUNG.week.upkeep")} ${signed(upkeepNet)}`);
      if (r.built > 0) detail.push(`${t("SIEDLUNG.week.build")} ${signed(-r.built)}`);
      return `<tr><td>${label("resource", r.id)}</td><td>${r.before} → <strong>${r.after}</strong></td><td>${detail.join(", ")}</td></tr>`;
    });
  if (rows.length) parts.push(`<p><strong>${t("SIEDLUNG.week.stock")}</strong></p><table>${rows.join("")}</table>`);
  for (const r of result.resources.filter(x => x.shortfall > 0)) {
    parts.push(`<p>⚠ ${t("SIEDLUNG.week.shortfall", { name: plain("resource", r.id), amount: r.shortfall })}</p>`);
  }

  // Arbeitskraft
  const labor = result.labor.filter(l => l.capacity > 0 || l.used > 0 || l.committed > 0);
  if (labor.length) {
    const lines = labor.map(l => {
      const bound = l.committed > 0 ? ` (${t("SIEDLUNG.week.laborBound", { bound: l.committed })})` : "";
      return `<li>${dot(getAsset("worker", l.id)?.color ?? "#888")}${t("SIEDLUNG.week.laborLine", { name: plain("worker", l.id), used: l.used, available: l.available })}${bound}</li>`;
    });
    parts.push(`<p><strong>${t("SIEDLUNG.week.labor")}</strong></p><ul>${lines.join("")}</ul>`);
  }
  for (const l of result.labor.filter(x => x.shortfall > 0)) {
    parts.push(`<p>⚠ ${t("SIEDLUNG.week.laborShortfall", { name: plain("worker", l.id), amount: l.shortfall })}</p>`);
  }

  // Baufortschritt
  if (result.progress.length) {
    const items = result.progress.map(p => {
      const done = p.completed ? ` – <strong>${t("SIEDLUNG.week.completed")}</strong> ✔` : "";
      return `<li>${escapeHTML(p.name)}: ${t("SIEDLUNG.settlement.material")} ${percent(p.res)}, ${t("SIEDLUNG.settlement.work")} ${percent(p.lab)}${done}</li>`;
    });
    parts.push(`<p><strong>${t("SIEDLUNG.week.progress")}</strong></p><ul>${items.join("")}</ul>`);
  }
  if (result.stalled.length) {
    parts.push(`<p>${t("SIEDLUNG.week.stalled", { names: result.stalled.map(escapeHTML).join(", ") })}</p>`);
  }
  if (parts.length === 1) parts.push(`<p>${t("SIEDLUNG.week.nothing")}</p>`);
  return parts.join("");
}
