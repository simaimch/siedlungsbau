import { ID } from "./constants";
import { getResources, getWorkers, getStats } from "./definitions";
import { addEffect } from "./settlement";
import { normalizeAmount } from "./effects";
import { sanitizeName } from "./util";
import type { EffectEntry, EffectKind } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);

interface EditorState {
  name: string;
  remaining: number;
  /** key = "resource:id" | "worker:id" | "stat:id" */
  rows: { key: string; amount: number }[];
}

const keyOf = (kind: EffectKind, id: string): string => `${kind}:${id}`;
function parseKey(key: string): { kind: EffectKind; id: string } | null {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  if (kind !== "resource" && kind !== "worker" && kind !== "stat") return null;
  return { kind, id: key.slice(i + 1) };
}

/** SL: legt einen aktiven Effekt an – Name, Dauer in Wochen und beliebig viele Veränderungen. */
export class EffectEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-effect-editor`,
    classes: [ID],
    window: { title: "SIEDLUNG.effects.newEffect", icon: "fa-solid fa-hourglass-half" },
    position: { width: 440, height: "auto" as const },
    actions: {
      addRow: EffectEditorApp.#onAddRow,
      removeRow: EffectEditorApp.#onRemoveRow,
      save: EffectEditorApp.#onSave,
      cancel: EffectEditorApp.#onCancel
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/effect-editor.hbs` }
  };

  _state: EditorState = { name: "", remaining: 3, rows: [] };

  /** Alle wählbaren Ziele, gruppiert nach Art. */
  _targets(): { kind: EffectKind; label: string; options: { key: string; name: string }[] }[] {
    const groups: { kind: EffectKind; label: string; options: { key: string; name: string }[] }[] = [
      { kind: "resource", label: t("SIEDLUNG.effects.groupResource"), options: getResources().map(a => ({ key: keyOf("resource", a.id), name: a.name })) },
      { kind: "worker", label: t("SIEDLUNG.effects.groupWorker"), options: getWorkers().map(a => ({ key: keyOf("worker", a.id), name: a.name })) },
      { kind: "stat", label: t("SIEDLUNG.effects.groupStat"), options: getStats().map(a => ({ key: keyOf("stat", a.id), name: a.name })) }
    ];
    return groups.filter(g => g.options.length);
  }

  async _prepareContext(): Promise<object> {
    const groups = this._targets();
    return {
      name: this._state.name,
      remaining: this._state.remaining,
      rows: this._state.rows.map((r, index) => ({
        index,
        amount: r.amount,
        groups: groups.map(g => ({ label: g.label, options: g.options.map(o => ({ ...o, selected: o.key === r.key })) }))
      }))
    };
  }

  _syncForm(): void {
    const el = this.element as HTMLElement;
    this._state.name = (el.querySelector("input[name=name]") as HTMLInputElement).value;
    this._state.remaining = Number((el.querySelector("input[name=remaining]") as HTMLInputElement).value);
    this._state.rows = [...el.querySelectorAll(".effect-row")].map(row => ({
      key: (row.querySelector("select") as HTMLSelectElement).value,
      amount: Number((row.querySelector("input[name=amount]") as HTMLInputElement).value)
    }));
  }

  static #onAddRow(this: EffectEditorApp): void {
    this._syncForm();
    const first = this._targets()[0]?.options[0];
    if (!first) {
      ui.notifications.warn(t("SIEDLUNG.effects.errors.noTargets"));
      return;
    }
    this._state.rows.push({ key: first.key, amount: 1 });
    void this.render();
  }

  static #onRemoveRow(this: EffectEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    this._state.rows.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static async #onSave(this: EffectEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    const remaining = Math.floor(s.remaining);
    if (!Number.isFinite(remaining) || remaining < 1) {
      ui.notifications.warn(t("SIEDLUNG.effects.errors.duration"));
      return;
    }
    // gleiche Ziele zusammenfassen, unbekannte und 0 verwerfen
    const known = new Set(this._targets().flatMap(g => g.options.map(o => o.key)));
    const sums = new Map<string, EffectEntry>();
    for (const r of s.rows) {
      const target = parseKey(r.key);
      if (!target || !known.has(r.key) || !Number.isFinite(r.amount)) continue;
      const prev = sums.get(r.key);
      sums.set(r.key, { ...target, amount: normalizeAmount(target.kind, (prev?.amount ?? 0) + r.amount) });
    }
    const entries = [...sums.values()].filter(e => e.amount !== 0);
    if (!entries.length) {
      ui.notifications.warn(t("SIEDLUNG.effects.errors.noEntries"));
      return;
    }
    await addEffect({ name: sanitizeName(s.name, t("SIEDLUNG.effects.defaultName")), remaining, entries });
    void this.close();
  }

  static #onCancel(this: EffectEditorApp): void {
    void this.close();
  }
}

export function openEffectEditor(): void {
  const existing = foundry.applications.instances.get(EffectEditorApp.DEFAULT_OPTIONS.id);
  if (existing) void existing.bringToFront();
  else {
    const app = new EffectEditorApp();
    app._state.rows.push(...(app._targets()[0] ? [{ key: app._targets()[0].options[0].key, amount: 1 }] : []));
    void app.render({ force: true });
  }
}
