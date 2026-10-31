import { ID } from "./constants";
import { getResources, saveDefinitions } from "./definitions";
import { effectTargets, parseTargetKey, targetKey } from "./effect-editor";
import { normalizeAmount } from "./effects";
import { MAX_SHORTAGE_WEEKS, defaultShortage, normalizeShortage, shortageMode } from "./shortage";
import { sanitizeName } from "./util";
import type { EffectEntry, ShortageMode } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string, data?: Record<string, string>): string => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

interface EditorState {
  mode: ShortageMode;
  effectOn: boolean;
  name: string;
  weeks: number;
  entries: { key: string; amount: number }[];
}

/** SL: Verhalten einer Ressource bei Engpass (Prüfung, Schulden, ignorieren) und optionaler Effekt samt Dauer. */
export class ShortageEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-triangle-exclamation" },
    position: { width: 480, height: "auto" as const },
    actions: { addEntry: ShortageEditorApp.#onAddEntry, removeEntry: ShortageEditorApp.#onRemoveEntry, save: ShortageEditorApp.#onSave, cancel: ShortageEditorApp.#onCancel }
  };

  static PARTS = { main: { template: `modules/${ID}/templates/shortage-editor.hbs` } };

  static idFor(resourceId: string): string {
    return `${ID}-shortage-editor-${resourceId}`;
  }

  _resourceId: string;
  _state: EditorState;

  constructor(resourceId: string) {
    super({ id: ShortageEditorApp.idFor(resourceId) });
    this._resourceId = resourceId;
    const r = getResources().find(x => x.id === resourceId);
    const effect = r?.shortage?.effect;
    this._state = {
      mode: r ? shortageMode(r) : "check",
      effectOn: !!effect,
      name: effect?.name ?? "",
      weeks: effect?.weeks ?? 3,
      entries: effect ? effect.entries.map(e => ({ key: targetKey(e.kind, e.id), amount: e.amount })) : []
    };
    if (!this._state.entries.length) {
      const first = effectTargets().find(g => g.kind === "stat")?.options[0] ?? effectTargets()[0]?.options[0];
      if (first) this._state.entries.push({ key: first.key, amount: -1 });
    }
  }

  get title(): string {
    return t("SIEDLUNG.shortage.editor.title", { name: getResources().find(x => x.id === this._resourceId)?.name ?? "" });
  }

  async _prepareContext(): Promise<object> {
    const s = this._state;
    const groups = effectTargets();
    return {
      isCheck: s.mode === "check",
      isDebt: s.mode === "debt",
      isIgnore: s.mode === "ignore",
      showEffect: s.mode !== "debt",
      effectOn: s.effectOn,
      name: s.name,
      weeks: s.weeks,
      max: MAX_SHORTAGE_WEEKS,
      entries: s.entries.map((e, index) => ({
        index,
        amount: e.amount,
        groups: groups.map(g => ({ label: g.label, options: g.options.map(o => ({ ...o, selected: o.key === e.key })) }))
      }))
    };
  }

  _onRender(): void {
    // Modus oder Effekt-Schalter ändern den sichtbaren Teil
    for (const sel of (this.element as HTMLElement).querySelectorAll("select[name=mode], input[name=effectOn]")) {
      sel.addEventListener("change", () => {
        this._syncForm();
        void this.render();
      });
    }
  }

  _syncForm(): void {
    const el = this.element as HTMLElement;
    const s = this._state;
    s.mode = (el.querySelector("select[name=mode]") as HTMLSelectElement).value as ShortageMode;
    s.effectOn = (el.querySelector("input[name=effectOn]") as HTMLInputElement | null)?.checked ?? false;
    s.name = (el.querySelector("input[name=name]") as HTMLInputElement | null)?.value ?? s.name;
    s.weeks = Number((el.querySelector("input[name=weeks]") as HTMLInputElement | null)?.value ?? s.weeks);
    const rows = [...el.querySelectorAll(".entry-row")];
    if (rows.length || s.effectOn) {
      s.entries = rows.map(row => ({
        key: (row.querySelector("select[name=target]") as HTMLSelectElement).value,
        amount: Number((row.querySelector("input[name=amount]") as HTMLInputElement).value)
      }));
    }
  }

  static #onAddEntry(this: ShortageEditorApp): void {
    this._syncForm();
    const first = effectTargets()[0]?.options[0];
    if (!first) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.noTargets"));
    this._state.entries.push({ key: first.key, amount: -1 });
    void this.render();
  }

  static #onRemoveEntry(this: ShortageEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    this._state.entries.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static async #onSave(this: ShortageEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    const known = new Set(effectTargets().flatMap(g => g.options.map(o => o.key)));
    let effect: unknown;
    if (s.mode !== "debt" && s.effectOn) {
      const sums = new Map<string, EffectEntry>();
      for (const e of s.entries) {
        const target = parseTargetKey(e.key);
        if (!target || !known.has(e.key) || !Number.isFinite(e.amount)) continue;
        sums.set(e.key, { ...target, amount: normalizeAmount(target.kind, (sums.get(e.key)?.amount ?? 0) + e.amount) });
      }
      const entries = [...sums.values()].filter(e => e.amount !== 0);
      const weeks = Math.floor(s.weeks);
      if (!entries.length) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.noEntries"));
      if (!Number.isFinite(weeks) || weeks < 1) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.duration"));
      effect = { name: sanitizeName(s.name, t("SIEDLUNG.shortage.editor.defaultName")), weeks, entries };
    }
    const rule = normalizeShortage({ mode: s.mode, effect }, this._resourceId);
    await saveDefinitions(defs => {
      const r = defs.resources.find(x => x.id === this._resourceId);
      if (!r) return;
      if (rule) r.shortage = rule;
      else delete r.shortage;
    });
    void this.close();
  }

  static #onCancel(this: ShortageEditorApp): void {
    void this.close();
  }
}

export { defaultShortage };

export function openShortageEditor(resourceId: string): void {
  const existing = foundry.applications.instances.get(ShortageEditorApp.idFor(resourceId));
  if (existing) void existing.bringToFront();
  else void new ShortageEditorApp(resourceId).render({ force: true });
}
