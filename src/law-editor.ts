import { ID } from "./constants";
import { getLawCategories, getLaws, saveDefinitions } from "./definitions";
import { effectTargets, parseTargetKey, targetKey } from "./effect-editor";
import { normalizeAmount } from "./effects";
import { sanitizeName } from "./util";
import type { EffectEntry, Law, LawOption } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);

interface OptionState {
  id: string;
  name: string;
  rows: { key: string; amount: number }[];
}

interface EditorState {
  lawId: string | null;
  name: string;
  category: string;
  description: string;
  options: OptionState[];
}

/** SL: bearbeitet oder erstellt ein Gesetz mit seinen Ausprägungen und deren Wirkungen. */
export class LawEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-gavel" },
    position: { width: 520, height: "auto" as const },
    actions: {
      addOption: LawEditorApp.#onAddOption,
      removeOption: LawEditorApp.#onRemoveOption,
      moveOption: LawEditorApp.#onMoveOption,
      addEntry: LawEditorApp.#onAddEntry,
      removeEntry: LawEditorApp.#onRemoveEntry,
      save: LawEditorApp.#onSave,
      cancel: LawEditorApp.#onCancel
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/law-editor.hbs` }
  };

  static idFor(lawId: string | null): string {
    return `${ID}-law-editor-${lawId ?? "new"}`;
  }

  _state: EditorState;

  constructor(lawId: string | null = null) {
    super({ id: LawEditorApp.idFor(lawId) });
    const law = lawId ? getLaws().find(l => l.id === lawId) : undefined;
    const toRows = (entries: EffectEntry[]) => entries.map(e => ({ key: targetKey(e.kind, e.id), amount: e.amount }));
    this._state = {
      lawId: law ? law.id : null,
      name: law?.name ?? "",
      category: law?.category ?? getLawCategories()[0]?.id ?? "",
      description: law?.description ?? "",
      options: law
        ? law.options.map(o => ({ id: o.id, name: o.name, rows: toRows(o.entries) }))
        : [{ id: foundry.utils.randomID(), name: "", rows: [] }]
    };
  }

  get title(): string {
    return t(this._state.lawId ? "SIEDLUNG.lawEditor.edit" : "SIEDLUNG.lawEditor.new");
  }

  async _prepareContext(): Promise<object> {
    const groups = effectTargets();
    const s = this._state;
    return {
      name: s.name,
      description: s.description,
      categories: getLawCategories().map(c => ({ id: c.id, label: c.label, selected: c.id === s.category })),
      options: s.options.map((o, index) => ({
        index,
        id: o.id,
        name: o.name,
        isFirst: index === 0,
        canMoveUp: index > 0,
        canRemove: s.options.length > 1,
        rows: o.rows.map((r, rowIndex) => ({
          rowIndex,
          amount: r.amount,
          groups: groups.map(g => ({ label: g.label, options: g.options.map(opt => ({ ...opt, selected: opt.key === r.key })) }))
        }))
      }))
    };
  }

  _syncForm(): void {
    const el = this.element as HTMLElement;
    this._state.name = (el.querySelector("input[name=name]") as HTMLInputElement).value;
    this._state.category = (el.querySelector("select[name=category]") as HTMLSelectElement).value;
    this._state.description = (el.querySelector("textarea[name=description]") as HTMLTextAreaElement).value;
    this._state.options = [...el.querySelectorAll(".option-block")].map(block => ({
      id: (block as HTMLElement).dataset.id ?? foundry.utils.randomID(),
      name: (block.querySelector("input[name=optname]") as HTMLInputElement).value,
      rows: [...block.querySelectorAll(".effect-row")].map(row => ({
        key: (row.querySelector("select") as HTMLSelectElement).value,
        amount: Number((row.querySelector("input[name=amount]") as HTMLInputElement).value)
      }))
    }));
  }

  static #onAddOption(this: LawEditorApp): void {
    this._syncForm();
    this._state.options.push({ id: foundry.utils.randomID(), name: "", rows: [] });
    void this.render();
  }

  static #onRemoveOption(this: LawEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    if (this._state.options.length > 1) this._state.options.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static #onMoveOption(this: LawEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    const i = Number(target.dataset.index);
    const list = this._state.options;
    if (i > 0 && i < list.length) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    void this.render();
  }

  static #onAddEntry(this: LawEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    const first = effectTargets()[0]?.options[0];
    if (!first) {
      ui.notifications.warn(t("SIEDLUNG.effects.errors.noTargets"));
      return;
    }
    this._state.options[Number(target.dataset.index)]?.rows.push({ key: first.key, amount: 1 });
    void this.render();
  }

  static #onRemoveEntry(this: LawEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    this._state.options[Number(target.dataset.index)]?.rows.splice(Number(target.dataset.row), 1);
    void this.render();
  }

  static async #onSave(this: LawEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    if (!getLawCategories().some(c => c.id === s.category)) {
      ui.notifications.warn(t("SIEDLUNG.lawEditor.errors.noCategory"));
      return;
    }
    const known = new Set(effectTargets().flatMap(g => g.options.map(o => o.key)));
    const options: LawOption[] = s.options.map((o, i) => {
      const sums = new Map<string, EffectEntry>();
      for (const r of o.rows) {
        const target = parseTargetKey(r.key);
        if (!target || !known.has(r.key) || !Number.isFinite(r.amount)) continue;
        const prev = sums.get(r.key);
        sums.set(r.key, { ...target, amount: normalizeAmount(target.kind, (prev?.amount ?? 0) + r.amount) });
      }
      return {
        id: o.id,
        name: sanitizeName(o.name, `${t("SIEDLUNG.lawEditor.defaultOption")} ${i + 1}`),
        entries: [...sums.values()].filter(e => e.amount !== 0)
      };
    });
    const law: Law = {
      id: s.lawId ?? foundry.utils.randomID(),
      name: sanitizeName(s.name, t("SIEDLUNG.lawEditor.defaultName")),
      category: s.category,
      options
    };
    const description = s.description.replace(/\s+/g, " ").trim().slice(0, 300);
    if (description) law.description = description;
    await saveDefinitions(defs => {
      const i = defs.laws.findIndex(l => l.id === law.id);
      if (i >= 0) defs.laws[i] = law;
      else defs.laws.push(law);
    });
    void this.close();
  }

  static #onCancel(this: LawEditorApp): void {
    void this.close();
  }
}

export function openLawEditor(lawId: string | null): void {
  const existing = foundry.applications.instances.get(LawEditorApp.idFor(lawId));
  if (existing) void existing.bringToFront();
  else void new LawEditorApp(lawId).render({ force: true });
}
