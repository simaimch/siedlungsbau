import { ID } from "./constants";
import { getResources, getRoadTypes, getWorkers, saveDefinitions } from "./definitions";
import { nextRoadId, normalizeRoadCosts } from "./roads";
import { sanitizeName } from "./util";
import type { CostEntry, CostKind } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);

interface Row { key: string; amount: number }
interface EditorState { roadId: string | null; name: string; color: string; rows: Row[] }

const keyOf = (kind: CostKind, id: string): string => `${kind}:${id}`;

/** SL: bearbeitet oder erstellt eine Wegart (Name, Farbe, Baukosten je Feld). */
export class RoadEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-road" },
    position: { width: 440, height: "auto" as const },
    actions: {
      addRow: RoadEditorApp.#onAddRow,
      removeRow: RoadEditorApp.#onRemoveRow,
      save: RoadEditorApp.#onSave,
      cancel: RoadEditorApp.#onCancel
    }
  };

  static PARTS = { main: { template: `modules/${ID}/templates/road-editor.hbs` } };

  static idFor(roadId: string | null): string {
    return `${ID}-road-editor-${roadId ?? "new"}`;
  }

  _state: EditorState;

  constructor(roadId: string | null = null) {
    super({ id: RoadEditorApp.idFor(roadId) });
    const r = roadId ? getRoadTypes().find(x => x.id === roadId) : undefined;
    this._state = {
      roadId: r ? r.id : null,
      name: r?.name ?? "",
      color: r?.color ?? "#b8946a",
      rows: r ? r.buildCost.map(c => ({ key: keyOf(c.kind, c.id), amount: c.amount })) : []
    };
  }

  get title(): string {
    return t(this._state.roadId ? "SIEDLUNG.roads.editor.edit" : "SIEDLUNG.roads.editor.new");
  }

  _options(): { label: string; options: { value: string; label: string }[] }[] {
    return [
      { label: t("SIEDLUNG.editor.tabs.resource"), options: getResources().map(a => ({ value: keyOf("resource", a.id), label: a.name })) },
      { label: t("SIEDLUNG.editor.tabs.worker"), options: getWorkers().map(a => ({ value: keyOf("worker", a.id), label: a.name })) }
    ].filter(g => g.options.length);
  }

  async _prepareContext(): Promise<object> {
    const s = this._state;
    const groups = this._options();
    return {
      name: s.name,
      color: s.color,
      rows: s.rows.map((r, index) => ({
        index,
        amount: r.amount,
        groups: groups.map(g => ({ label: g.label, options: g.options.map(o => ({ ...o, selected: o.value === r.key })) }))
      }))
    };
  }

  _syncForm(): void {
    const el = this.element as HTMLElement;
    const s = this._state;
    s.name = (el.querySelector("input[name=name]") as HTMLInputElement).value;
    s.color = (el.querySelector("input[name=color]") as HTMLInputElement).value;
    s.rows = [...el.querySelectorAll(".cost-row")].map(row => ({
      key: (row.querySelector("select[name=item]") as HTMLSelectElement).value,
      amount: Number((row.querySelector("input[name=amount]") as HTMLInputElement).value)
    }));
  }

  static #onAddRow(this: RoadEditorApp): void {
    this._syncForm();
    const first = this._options()[0]?.options[0];
    if (!first) return void ui.notifications.warn(t("SIEDLUNG.effects.errors.noTargets"));
    this._state.rows.push({ key: first.value, amount: 1 });
    void this.render();
  }

  static #onRemoveRow(this: RoadEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    this._state.rows.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static async #onSave(this: RoadEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    const raw: CostEntry[] = s.rows.flatMap(r => {
      const [kind, ...rest] = r.key.split(":");
      return kind === "resource" || kind === "worker" ? [{ kind, id: rest.join(":"), amount: r.amount } as CostEntry] : [];
    });
    const resIds = new Set(getResources().map(a => a.id));
    const workerIds = new Set(getWorkers().map(a => a.id));
    const buildCost = normalizeRoadCosts(raw).filter(c => (c.kind === "resource" ? resIds : workerIds).has(c.id));
    const color = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : "#b8946a";
    const name = sanitizeName(s.name, t("SIEDLUNG.roads.editor.defaultName"));
    let failed = false;
    await saveDefinitions(defs => {
      const roads = defs.roads;
      const i = s.roadId ? roads.findIndex(x => x.id === s.roadId) : -1;
      if (i >= 0) roads[i] = { id: roads[i].id, name, color, buildCost };
      else {
        const id = nextRoadId(roads);
        if (!id) { failed = true; return; }
        roads.push({ id, name, color, buildCost });
      }
    });
    if (failed) return void ui.notifications.warn(t("SIEDLUNG.roads.errors.full"));
    void this.close();
  }

  static #onCancel(this: RoadEditorApp): void {
    void this.close();
  }
}

export function openRoadEditor(roadId: string | null): void {
  const existing = foundry.applications.instances.get(RoadEditorApp.idFor(roadId));
  if (existing) void existing.bringToFront();
  else void new RoadEditorApp(roadId).render({ force: true });
}
