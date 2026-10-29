import { ID, STATUS, GOLD_ID } from "./constants";
import { getBuildings, getType, bounds, isSettlementScene, isConnected, cellKey, transformCells, costsOf } from "./store";
import {
  getDefinitions, getCategories, getCategory, getResources, getWorkers, getAsset, assetKey, isGold, costChips,
  saveDefinitions, resetDefinitions
} from "./definitions";
import { buildingCenter } from "./render";
import { Placement } from "./placement";
import { completeBuilding, removeBuilding } from "./service";
import { sanitizeName } from "./util";
import { getSettlement, setAmount, advanceWeek } from "./settlement";
import { fractions, laborCommitted } from "./week";
import type { Building, BuildingType, Cell, CostEntry, CostKind } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);
const confirm = (title: string, text: string): Promise<boolean> =>
  foundry.applications.api.DialogV2.confirm({ window: { title }, content: `<p>${text}</p>` });

/** Daten für die Grundriss-Vorschau (CSS-Grid) und die Kosten eines Gebäudetyps. */
function toPreview(b: BuildingType) {
  const { w, h } = bounds(b.cells);
  return {
    id: b.id,
    name: b.name,
    count: b.cells.length,
    shape: { w, h, cells: b.cells.map(([x, y]) => ({ col: x + 1, row: y + 1 })) },
    buildCost: costChips(b.buildCost),
    upkeep: costChips(b.upkeep)
  };
}

/* ------------------------------------------------------------------ */
/* Palette (alle Nutzer)                                              */
/* ------------------------------------------------------------------ */

export class PaletteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-palette`,
    classes: [ID],
    window: { title: "SIEDLUNG.palette.title", icon: "fa-solid fa-hammer", resizable: true },
    position: { width: 320, height: 460 },
    actions: { select: PaletteApp.#onSelect }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/palette.hbs`, scrollable: [""] }
  };

  async _prepareContext(): Promise<object> {
    const { categories, buildings } = getDefinitions();
    const groups = categories
      .map(c => ({
        id: c.id,
        label: c.label,
        color: c.color,
        buildings: buildings.filter(b => b.category === c.id).map(toPreview)
      }))
      .filter(g => g.buildings.length);
    return { categories: groups };
  }

  static #onSelect(_event: Event, target: HTMLElement): void {
    const type = getType(target.dataset.id ?? "");
    if (type && isSettlementScene()) Placement.start(type);
  }
}

/* ------------------------------------------------------------------ */
/* Aufträge (alle Nutzer, SL kann abschließen/entfernen)              */
/* ------------------------------------------------------------------ */

export class OrdersApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-orders`,
    classes: [ID],
    window: { title: "SIEDLUNG.orders.title", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 460, height: 360 },
    actions: {
      focus: OrdersApp.#onFocus,
      complete: OrdersApp.#onComplete,
      remove: OrdersApp.#onRemove
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/orders.hbs`, scrollable: [""] }
  };

  async _prepareContext(): Promise<object> {
    const rows = getBuildings().map(b => ({
      id: b.id,
      name: b.name,
      categoryLabel: getCategory(b.category)?.label ?? b.category,
      done: b.status === STATUS.DONE,
      statusLabel: b.status === STATUS.DONE ? t("SIEDLUNG.orders.done") : `${t("SIEDLUNG.orders.ordered")} (${progressText(b)})`
    }));
    // offene Aufträge zuerst
    rows.sort((a, b) => Number(a.done) - Number(b.done));
    return { rows, empty: rows.length === 0, isGM: game.user.isGM };
  }

  static #onFocus(_event: Event, target: HTMLElement): void {
    const b = getBuildings().find(x => x.id === target.dataset.id);
    if (!b) return;
    const { x, y } = buildingCenter(b, canvas.scene.grid.size);
    canvas.animatePan({ x, y });
  }

  static #onComplete(_event: Event, target: HTMLElement): void {
    void completeBuilding(target.dataset.id ?? "");
  }

  static async #onRemove(_event: Event, target: HTMLElement): Promise<void> {
    if (await confirm(t("SIEDLUNG.orders.remove"), t("SIEDLUNG.orders.removeConfirm"))) {
      void removeBuilding(target.dataset.id ?? "");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Vorräte der Siedlung (alle sehen, SL ändert, SL springt zur Woche) */
/* ------------------------------------------------------------------ */

export class SettlementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-settlement`,
    classes: [ID],
    window: { title: "SIEDLUNG.settlement.title", icon: "fa-solid fa-warehouse", resizable: true },
    position: { width: 400, height: 560 },
    actions: { nextWeek: SettlementApp.#onNextWeek }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/settlement.hbs`, scrollable: [""] }
  };

  async _prepareContext(): Promise<object> {
    const state = getSettlement();
    const { resources, workers } = getDefinitions();
    const buildings = getBuildings();
    const committed = laborCommitted(buildings, costsOf);
    return {
      isGM: game.user.isGM,
      weekLabel: game.i18n.format("SIEDLUNG.settlement.week", { week: state.week }),
      resources: resources.map(r => ({ id: r.id, name: r.name, color: r.color, amount: state.resources[r.id] ?? 0 })),
      workers: workers.map(w => {
        const capacity = state.workers[w.id] ?? 0;
        const bound = committed[w.id] ?? 0;
        return { id: w.id, name: w.name, color: w.color, capacity, bound: bound > 0 ? bound : 0, free: Math.max(0, capacity - bound) };
      }),
      construction: buildings
        .filter(b => b.status === STATUS.ORDERED)
        .map(b => {
          const f = fractions(b, costsOf(b));
          return { name: b.name, res: Math.round(f.res * 100), lab: Math.round(f.lab * 100) };
        })
    };
  }

  _onRender(): void {
    const inputs = this.element.querySelectorAll("[data-stock-kind]") as NodeListOf<HTMLInputElement>;
    for (const el of inputs) {
      el.addEventListener("change", () => void setAmount(el.dataset.stockKind as CostKind, el.dataset.id ?? "", Number(el.value)));
    }
  }

  static async #onNextWeek(): Promise<void> {
    if (await confirm(t("SIEDLUNG.settlement.nextWeek"), t("SIEDLUNG.settlement.confirmNextWeek"))) await advanceWeek();
  }
}

/** "Material 40 %, Arbeit 20 %" für einen Bauauftrag. */
function progressText(b: Building): string {
  const f = fractions(b, costsOf(b));
  return `${t("SIEDLUNG.settlement.material")} ${Math.round(f.res * 100)} %, ${t("SIEDLUNG.settlement.work")} ${Math.round(f.lab * 100)} %`;
}

/* ------------------------------------------------------------------ */
/* Gebäude-Editor (nur SL): Reiter Gebäude, Ressourcen, Arbeiter      */
/* ------------------------------------------------------------------ */

const CATEGORY_COLORS = ["#c98a3d", "#6b7f9e", "#7a9a6b", "#b5656b", "#8a6bb5", "#4fa3a5", "#c2b13c"];
const ASSET_COLORS = ["#e0b83a", "#9aa0a6", "#8b5a2b", "#5b8def", "#d35f5f", "#6fbf73", "#b07cc6"];

export class DefinitionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-definitions`,
    classes: [ID],
    window: { title: "SIEDLUNG.editor.title", icon: "fa-solid fa-pen-ruler", resizable: true },
    position: { width: 520, height: 620 },
    actions: {
      switchTab: DefinitionsApp.#onTab,
      addCategory: DefinitionsApp.#onAddCategory,
      deleteCategory: DefinitionsApp.#onDeleteCategory,
      addBuilding: DefinitionsApp.#onAddBuilding,
      editBuilding: DefinitionsApp.#onEditBuilding,
      deleteBuilding: DefinitionsApp.#onDeleteBuilding,
      addAsset: DefinitionsApp.#onAddAsset,
      deleteAsset: DefinitionsApp.#onDeleteAsset,
      resetDefaults: DefinitionsApp.#onReset
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/definitions.hbs`, scrollable: [""] }
  };

  /** Aktiver Reiter: "buildings", "resource" oder "worker". */
  _tab = "buildings";

  async _prepareContext(): Promise<object> {
    const { categories, buildings, resources, workers } = getDefinitions();
    const groups = categories.map(c => ({
      id: c.id,
      label: c.label,
      color: c.color,
      buildings: buildings.filter(b => b.category === c.id).map(toPreview)
    }));
    // Gebäude mit unbekannter Kategorie nicht verlieren
    const orphans = buildings.filter(b => !categories.some(c => c.id === b.category));
    if (orphans.length) groups.push({ id: "", label: t("SIEDLUNG.editor.noCategory"), color: "#888888", buildings: orphans.map(toPreview) });

    const tab = this._tab;
    const kind: CostKind = tab === "worker" ? "worker" : "resource";
    const assets = (kind === "worker" ? workers : resources).map(a => ({ ...a, fixed: isGold(kind, a.id) }));
    return {
      isBuildings: tab === "buildings",
      isResource: tab === "resource",
      isWorker: tab === "worker",
      categories,
      groups,
      assets,
      assetKind: kind,
      assetTitle: t(`SIEDLUNG.editor.tabs.${kind}`)
    };
  }

  _onRender(): void {
    const catInputs = this.element.querySelectorAll("[data-cat-field]") as NodeListOf<HTMLInputElement>;
    for (const el of catInputs) el.addEventListener("change", () => void this._onCategoryField(el));
    const assetInputs = this.element.querySelectorAll("[data-asset-field]") as NodeListOf<HTMLInputElement>;
    for (const el of assetInputs) el.addEventListener("change", () => void this._onAssetField(el));
  }

  /** Name oder Farbe einer Kategorie wurde im Formular geändert. */
  async _onCategoryField(el: HTMLInputElement): Promise<void> {
    const id = el.dataset.id;
    const field = el.dataset.catField;
    await saveDefinitions(defs => {
      const c = defs.categories.find(x => x.id === id);
      if (!c) return;
      if (field === "color" && /^#[0-9a-f]{6}$/i.test(el.value)) c.color = el.value;
      else if (field === "label") c.label = sanitizeName(el.value, c.label);
    });
    void this.render();
  }

  /** Name, Farbe oder Marktwert einer Ressource bzw. Arbeiterart wurde geändert. */
  async _onAssetField(el: HTMLInputElement): Promise<void> {
    const kind = el.dataset.kind as CostKind;
    const id = el.dataset.id ?? "";
    const field = el.dataset.assetField;
    await saveDefinitions(defs => {
      const a = defs[assetKey(kind)].find(x => x.id === id);
      if (!a) return;
      if (field === "color" && /^#[0-9a-f]{6}$/i.test(el.value)) a.color = el.value;
      else if (field === "name") a.name = sanitizeName(el.value, a.name);
      else if (field === "value" && !isGold(kind, id)) {
        const v = Number(el.value);
        if (Number.isFinite(v) && v >= 0) a.value = Math.round(v * 100) / 100;
      }
    });
    void this.render();
  }

  static #onTab(this: DefinitionsApp, _event: Event, target: HTMLElement): void {
    this._tab = target.dataset.tab ?? "buildings";
    void this.render();
  }

  static async #onAddCategory(): Promise<void> {
    await saveDefinitions(defs => {
      defs.categories.push({
        id: foundry.utils.randomID(),
        label: t("SIEDLUNG.editor.newCategory"),
        color: CATEGORY_COLORS[defs.categories.length % CATEGORY_COLORS.length]
      });
    });
  }

  static async #onDeleteCategory(_event: Event, target: HTMLElement): Promise<void> {
    const id = target.dataset.id;
    if (getDefinitions().buildings.some(b => b.category === id)) {
      ui.notifications.warn(t("SIEDLUNG.editor.errors.categoryNotEmpty"));
      return;
    }
    if (!(await confirm(t("SIEDLUNG.editor.deleteCategory"), t("SIEDLUNG.editor.confirmDeleteCategory")))) return;
    await saveDefinitions(defs => {
      defs.categories = defs.categories.filter(c => c.id !== id);
    });
  }

  static #onAddBuilding(): void {
    if (!getCategories().length) {
      ui.notifications.warn(t("SIEDLUNG.editor.errors.noCategory"));
      return;
    }
    openBuildingEditor(null);
  }

  static #onEditBuilding(_event: Event, target: HTMLElement): void {
    openBuildingEditor(target.dataset.id ?? null);
  }

  static async #onDeleteBuilding(_event: Event, target: HTMLElement): Promise<void> {
    const id = target.dataset.id;
    if (!(await confirm(t("SIEDLUNG.editor.deleteBuilding"), t("SIEDLUNG.editor.confirmDeleteBuilding")))) return;
    await saveDefinitions(defs => {
      defs.buildings = defs.buildings.filter(b => b.id !== id);
    });
  }

  static async #onAddAsset(_event: Event, target: HTMLElement): Promise<void> {
    const kind = target.dataset.kind as CostKind;
    await saveDefinitions(defs => {
      const list = defs[assetKey(kind)];
      list.push({
        id: foundry.utils.randomID(),
        name: t(kind === "resource" ? "SIEDLUNG.editor.newResource" : "SIEDLUNG.editor.newWorker"),
        color: ASSET_COLORS[list.length % ASSET_COLORS.length],
        value: 1
      });
    });
  }

  static async #onDeleteAsset(_event: Event, target: HTMLElement): Promise<void> {
    const kind = target.dataset.kind as CostKind;
    const id = target.dataset.id ?? "";
    if (isGold(kind, id)) {
      ui.notifications.warn(t("SIEDLUNG.editor.errors.goldProtected"));
      return;
    }
    const inUse = getDefinitions().buildings.some(b => [...b.buildCost, ...b.upkeep].some(e => e.kind === kind && e.id === id));
    if (inUse) {
      ui.notifications.warn(t("SIEDLUNG.editor.errors.assetInUse"));
      return;
    }
    if (!(await confirm(t("SIEDLUNG.editor.deleteAsset"), t("SIEDLUNG.editor.confirmDeleteAsset")))) return;
    await saveDefinitions(defs => {
      defs[assetKey(kind)] = defs[assetKey(kind)].filter(a => a.id !== id);
    });
  }

  static async #onReset(): Promise<void> {
    if (await confirm(t("SIEDLUNG.editor.resetDefaults"), t("SIEDLUNG.editor.confirmReset"))) await resetDefinitions();
  }
}

/* ------------------------------------------------------------------ */
/* Bearbeiten eines Gebäudetyps: Name, Kategorie, Kosten, Form        */
/* ------------------------------------------------------------------ */

const MAX_SHAPE_SIZE = 12;
type CostList = "buildCost" | "upkeep";
const COST_LISTS: CostList[] = ["buildCost", "upkeep"];

interface EditorState {
  typeId: string | null;
  name: string;
  category: string;
  w: number;
  h: number;
  on: Set<string>;
  buildCost: CostEntry[];
  upkeep: CostEntry[];
}

/**
 * Fasst gleiche Posten zusammen und entfernt ungültige (Menge 0, unbekannter Eintrag).
 * Negative Mengen sind nur bei Betriebskosten erlaubt (das Gebäude produziert dann etwas).
 */
function normalizeCosts(entries: CostEntry[], allowNegative: boolean): CostEntry[] {
  const merged = new Map<string, CostEntry>();
  for (const e of entries) {
    const amount = Math.round(e.amount);
    if (!amount || (amount < 0 && !allowNegative) || !getAsset(e.kind, e.id)) continue;
    const key = `${e.kind}:${e.id}`;
    const existing = merged.get(key);
    if (existing) existing.amount += amount;
    else merged.set(key, { kind: e.kind, id: e.id, amount });
  }
  return [...merged.values()].filter(e => e.amount !== 0);
}

/** Bearbeitet oder erstellt einen Gebäudetyp: Name, Kategorie, Bau-/Betriebskosten und Form (Felder anklicken). */
export class BuildingEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-pencil" },
    position: { width: 400, height: "auto" },
    actions: {
      toggleCell: BuildingEditorApp.#onToggleCell,
      addCost: BuildingEditorApp.#onAddCost,
      removeCost: BuildingEditorApp.#onRemoveCost,
      save: BuildingEditorApp.#onSave,
      cancel: BuildingEditorApp.#onCancel
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/building-editor.hbs` }
  };

  static idFor(typeId: string | null): string {
    return `${ID}-building-editor-${typeId ?? "new"}`;
  }

  _state: EditorState;

  constructor(typeId: string | null = null) {
    super({ id: BuildingEditorApp.idFor(typeId) });
    const type = typeId ? getType(typeId) : undefined;
    const cells: Cell[] = type?.cells ?? [[0, 0], [1, 0], [0, 1], [1, 1]];
    const { w, h } = bounds(cells);
    this._state = {
      typeId: type ? type.id : null,
      name: type?.name ?? "",
      category: type?.category ?? getCategories()[0]?.id ?? "",
      w: Math.min(MAX_SHAPE_SIZE, Math.max(w, 4)),
      h: Math.min(MAX_SHAPE_SIZE, Math.max(h, 4)),
      on: new Set(cells.map(([x, y]) => cellKey(x, y))),
      buildCost: (type?.buildCost ?? []).map(e => ({ ...e })),
      upkeep: (type?.upkeep ?? []).map(e => ({ ...e }))
    };
  }

  get title(): string {
    return t(this._state.typeId ? "SIEDLUNG.editor.editBuilding" : "SIEDLUNG.editor.newBuilding");
  }

  async _prepareContext(): Promise<object> {
    const { w, h, on, name, category } = this._state;
    const gridCells: { x: number; y: number; on: boolean }[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gridCells.push({ x, y, on: on.has(cellKey(x, y)) });

    const resources = getResources();
    const workers = getWorkers();
    const rowsFor = (entries: CostEntry[]) =>
      entries.map((e, index) => ({
        index,
        amount: e.amount,
        groups: [
          {
            label: t("SIEDLUNG.editor.groupResources"),
            options: resources.map(r => ({ value: `resource:${r.id}`, label: r.name, selected: e.kind === "resource" && e.id === r.id }))
          },
          {
            label: t("SIEDLUNG.editor.groupWorkers"),
            options: workers.map(r => ({ value: `worker:${r.id}`, label: r.name, selected: e.kind === "worker" && e.id === r.id }))
          }
        ].filter(g => g.options.length)
      }));

    return {
      name,
      w,
      h,
      max: MAX_SHAPE_SIZE,
      gridCells,
      count: on.size,
      categories: getCategories().map(c => ({ id: c.id, label: c.label, selected: c.id === category })),
      costLists: COST_LISTS.map(key => ({
        key,
        label: t(`SIEDLUNG.editor.${key}`),
        allowNegative: key === "upkeep",
        hint: key === "upkeep" ? t("SIEDLUNG.editor.upkeepHint") : "",
        rows: rowsFor(this._state[key])
      }))
    };
  }

  _onRender(): void {
    const inputs = this.element.querySelectorAll("input[name=w], input[name=h]") as NodeListOf<HTMLInputElement>;
    for (const input of inputs) input.addEventListener("change", () => this._resize());
  }

  /** Übernimmt Name, Kategorie und Kostenposten aus dem Formular in den Zustand. */
  _syncForm(): void {
    const name = this.element.querySelector("input[name=name]") as HTMLInputElement | null;
    const category = this.element.querySelector("select[name=category]") as HTMLSelectElement | null;
    if (name) this._state.name = name.value;
    if (category) this._state.category = category.value;

    for (const key of COST_LISTS) {
      const rows = this.element.querySelectorAll(`.cost-row[data-list="${key}"]`) as NodeListOf<HTMLElement>;
      const entries: CostEntry[] = [];
      for (const row of rows) {
        const [kind, id] = (row.querySelector("select") as HTMLSelectElement).value.split(":");
        const amount = Number((row.querySelector("input[name=amount]") as HTMLInputElement).value);
        if (id) entries.push({ kind: kind as CostKind, id, amount: Number.isFinite(amount) ? amount : 1 });
      }
      this._state[key] = entries;
    }
  }

  _resize(): void {
    this._syncForm();
    const read = (field: string, fallback: number): number => {
      const el = this.element.querySelector(`input[name=${field}]`) as HTMLInputElement | null;
      const v = Math.round(Number(el?.value));
      return Number.isFinite(v) ? Math.min(MAX_SHAPE_SIZE, Math.max(1, v)) : fallback;
    };
    const w = read("w", this._state.w);
    const h = read("h", this._state.h);
    this._state.w = w;
    this._state.h = h;
    // Felder außerhalb der neuen Größe verwerfen
    this._state.on = new Set([...this._state.on].filter(k => {
      const [x, y] = k.split(",").map(Number);
      return x < w && y < h;
    }));
    void this.render();
  }

  static #onToggleCell(this: BuildingEditorApp, _event: Event, target: HTMLElement): void {
    const key = cellKey(Number(target.dataset.x), Number(target.dataset.y));
    if (this._state.on.has(key)) this._state.on.delete(key);
    else this._state.on.add(key);
    target.classList.toggle("on", this._state.on.has(key));
    const count = this.element.querySelector(".count");
    if (count) count.textContent = String(this._state.on.size);
  }

  static #onAddCost(this: BuildingEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    const key = target.dataset.list as CostList;
    this._state[key].push({ kind: "resource", id: getResources()[0]?.id ?? GOLD_ID, amount: 1 });
    void this.render();
  }

  static #onRemoveCost(this: BuildingEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    const key = target.dataset.list as CostList;
    this._state[key].splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static async #onSave(this: BuildingEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    const name = sanitizeName(s.name, "");
    if (!name) return ui.notifications.warn(t("SIEDLUNG.editor.errors.noName"));
    if (!getCategory(s.category)) return ui.notifications.warn(t("SIEDLUNG.editor.errors.noCategory"));
    const raw: Cell[] = [...s.on].map(k => {
      const [x, y] = k.split(",").map(Number);
      return [x, y];
    });
    if (!raw.length) return ui.notifications.warn(t("SIEDLUNG.editor.errors.noCells"));
    if (!isConnected(raw)) return ui.notifications.warn(t("SIEDLUNG.editor.errors.notConnected"));
    const cells = transformCells(raw, 0, false); // verschiebt die Form auf den Ursprung
    const buildCost = normalizeCosts(s.buildCost, false);
    const upkeep = normalizeCosts(s.upkeep, true);

    await saveDefinitions(defs => {
      const existing = s.typeId ? defs.buildings.find(b => b.id === s.typeId) : undefined;
      if (existing) {
        Object.assign(existing, { name, category: s.category, cells, buildCost, upkeep });
      } else {
        defs.buildings.push({ id: foundry.utils.randomID(), name, category: s.category, cells, buildCost, upkeep });
      }
    });
    await this.close();
  }

  static async #onCancel(this: BuildingEditorApp): Promise<void> {
    await this.close();
  }
}

function openBuildingEditor(typeId: string | null): void {
  const existing = foundry.applications.instances.get(BuildingEditorApp.idFor(typeId));
  if (existing) existing.render({ force: true });
  else new BuildingEditorApp(typeId).render({ force: true });
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen für Fenster                                        */
/* ------------------------------------------------------------------ */

type AppClass = { DEFAULT_OPTIONS: { id: string }; new (): any };

export function toggleApp(App: AppClass): void {
  const existing = foundry.applications.instances.get(App.DEFAULT_OPTIONS.id);
  if (existing) existing.close();
  else new App().render({ force: true });
}

export function refreshApp(App: { DEFAULT_OPTIONS: { id: string } }): void {
  foundry.applications.instances.get(App.DEFAULT_OPTIONS.id)?.render();
}

export const refreshOrders = (): void => refreshApp(OrdersApp);

export function closeApps(): void {
  for (const App of [PaletteApp, OrdersApp, SettlementApp]) foundry.applications.instances.get(App.DEFAULT_OPTIONS.id)?.close();
}
