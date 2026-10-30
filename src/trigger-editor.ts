import { ID } from "./constants";
import { getTriggers, saveDefinitions } from "./definitions";
import { effectTargets, parseTargetKey, targetKey } from "./effect-editor";
import { normalizeAmount } from "./effects";
import { COMPARE_OPS, normalizeConditions } from "./triggers";
import { sanitizeName } from "./util";
import type { CompareOp, Trigger, TriggerCondition, TriggerEntry } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);

interface CondRow { key: string; op: CompareOp; value: number }
interface EntryRow { key: string; amount: number; mode: "weekly" | "modifier" }

interface EditorState {
  triggerId: string | null;
  name: string;
  description: string;
  hidden: boolean;
  defaultOn: boolean;
  conditions: CondRow[];
  entries: EntryRow[];
}

/** SL: bearbeitet oder erstellt einen getriggerten Effekt (Bedingungen und Wirkungen). */
export class TriggerEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-bolt" },
    position: { width: 520, height: "auto" as const },
    actions: {
      addCondition: TriggerEditorApp.#onAddCondition,
      removeCondition: TriggerEditorApp.#onRemoveCondition,
      addEntry: TriggerEditorApp.#onAddEntry,
      removeEntry: TriggerEditorApp.#onRemoveEntry,
      save: TriggerEditorApp.#onSave,
      cancel: TriggerEditorApp.#onCancel
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/trigger-editor.hbs` }
  };

  static idFor(triggerId: string | null): string {
    return `${ID}-trigger-editor-${triggerId ?? "new"}`;
  }

  _state: EditorState;

  constructor(triggerId: string | null = null) {
    super({ id: TriggerEditorApp.idFor(triggerId) });
    const tr = triggerId ? getTriggers().find(x => x.id === triggerId) : undefined;
    const first = effectTargets()[0]?.options[0]?.key ?? "";
    this._state = {
      triggerId: tr ? tr.id : null,
      name: tr?.name ?? "",
      description: tr?.description ?? "",
      hidden: !!tr?.hidden,
      defaultOn: tr ? tr.defaultOn !== false : true,
      conditions: tr ? tr.conditions.map(c => ({ key: targetKey(c.kind, c.id), op: c.op, value: c.value })) : [{ key: first, op: "<", value: 30 }],
      entries: tr ? tr.entries.map(e => ({ key: targetKey(e.kind, e.id), amount: e.amount, mode: e.mode === "modifier" ? "modifier" : "weekly" })) : [{ key: first, amount: -1, mode: "weekly" }]
    };
  }

  get title(): string {
    return t(this._state.triggerId ? "SIEDLUNG.triggers.edit" : "SIEDLUNG.triggers.new");
  }

  async _prepareContext(): Promise<object> {
    const groups = effectTargets();
    const s = this._state;
    const pick = (key: string) => groups.map(g => ({ label: g.label, options: g.options.map(o => ({ ...o, selected: o.key === key })) }));
    return {
      name: s.name,
      description: s.description,
      hidden: s.hidden,
      defaultOn: s.defaultOn,
      conditions: s.conditions.map((c, index) => ({
        index,
        value: c.value,
        groups: pick(c.key),
        ops: COMPARE_OPS.map(op => ({ op, selected: op === c.op }))
      })),
      entries: s.entries.map((e, index) => ({
        index,
        amount: e.amount,
        groups: pick(e.key),
        isStat: e.key.startsWith("stat:"),
        weekly: e.mode === "weekly",
        modifier: e.mode === "modifier"
      })),
      canRemoveCondition: s.conditions.length > 1
    };
  }

  _onRender(): void {
    // Bei Wechsel des Ziels neu zeichnen, damit die Modus-Auswahl nur bei Werten erscheint
    for (const sel of (this.element as HTMLElement).querySelectorAll(".entry-row select[name=target]")) {
      sel.addEventListener("change", () => {
        this._syncForm();
        void this.render();
      });
    }
  }

  _syncForm(): void {
    const el = this.element as HTMLElement;
    const s = this._state;
    s.name = (el.querySelector("input[name=name]") as HTMLInputElement).value;
    s.description = (el.querySelector("textarea[name=description]") as HTMLTextAreaElement).value;
    s.hidden = (el.querySelector("input[name=hidden]") as HTMLInputElement).checked;
    s.defaultOn = (el.querySelector("input[name=defaultOn]") as HTMLInputElement).checked;
    s.conditions = [...el.querySelectorAll(".cond-row")].map(row => ({
      key: (row.querySelector("select[name=target]") as HTMLSelectElement).value,
      op: (row.querySelector("select[name=op]") as HTMLSelectElement).value as CompareOp,
      value: Number((row.querySelector("input[name=value]") as HTMLInputElement).value)
    }));
    s.entries = [...el.querySelectorAll(".entry-row")].map(row => ({
      key: (row.querySelector("select[name=target]") as HTMLSelectElement).value,
      amount: Number((row.querySelector("input[name=amount]") as HTMLInputElement).value),
      mode: (row.querySelector("select[name=mode]") as HTMLSelectElement | null)?.value === "modifier" ? "modifier" : "weekly"
    }));
  }

  static #onAddCondition(this: TriggerEditorApp): void {
    this._syncForm();
    const first = effectTargets()[0]?.options[0];
    if (!first) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.noTargets"));
    this._state.conditions.push({ key: first.key, op: "<", value: 0 });
    void this.render();
  }

  static #onRemoveCondition(this: TriggerEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    if (this._state.conditions.length > 1) this._state.conditions.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static #onAddEntry(this: TriggerEditorApp): void {
    this._syncForm();
    const first = effectTargets()[0]?.options[0];
    if (!first) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.noTargets"));
    this._state.entries.push({ key: first.key, amount: 1, mode: "weekly" });
    void this.render();
  }

  static #onRemoveEntry(this: TriggerEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    this._state.entries.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static async #onSave(this: TriggerEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    const known = new Set(effectTargets().flatMap(g => g.options.map(o => o.key)));

    const conditions: TriggerCondition[] = normalizeConditions(
      s.conditions.flatMap(c => {
        const target = parseTargetKey(c.key);
        return target && known.has(c.key) ? [{ ...target, op: c.op, value: c.value }] : [];
      })
    );
    if (!conditions.length) return void ui.notifications.warn(t("SIEDLUNG.triggers.errors.noConditions"));

    // gleiche Ziele (und Modi) zusammenfassen, unbekannte und 0 verwerfen
    const sums = new Map<string, TriggerEntry>();
    for (const e of s.entries) {
      const target = parseTargetKey(e.key);
      if (!target || !known.has(e.key) || !Number.isFinite(e.amount)) continue;
      const modifier = target.kind === "stat" && e.mode === "modifier";
      const k = `${e.key}|${modifier ? "m" : "w"}`;
      const prev = sums.get(k);
      const entry: TriggerEntry = { ...target, amount: normalizeAmount(target.kind, (prev?.amount ?? 0) + e.amount) };
      if (modifier) entry.mode = "modifier";
      sums.set(k, entry);
    }
    const entries = [...sums.values()].filter(e => e.amount !== 0);
    if (!entries.length) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.noEntries"));

    const trigger: Trigger = {
      id: s.triggerId ?? foundry.utils.randomID(),
      name: sanitizeName(s.name, t("SIEDLUNG.triggers.defaultName")),
      conditions,
      entries
    };
    const description = s.description.replace(/\s+/g, " ").trim().slice(0, 300);
    if (description) trigger.description = description;
    if (s.hidden) trigger.hidden = true;
    if (!s.defaultOn) trigger.defaultOn = false;
    await saveDefinitions(defs => {
      const i = defs.triggers.findIndex(x => x.id === trigger.id);
      if (i >= 0) defs.triggers[i] = trigger;
      else defs.triggers.push(trigger);
    });
    void this.close();
  }

  static #onCancel(this: TriggerEditorApp): void {
    void this.close();
  }
}

export function openTriggerEditor(triggerId: string | null): void {
  const existing = foundry.applications.instances.get(TriggerEditorApp.idFor(triggerId));
  if (existing) void existing.bringToFront();
  else void new TriggerEditorApp(triggerId).render({ force: true });
}
