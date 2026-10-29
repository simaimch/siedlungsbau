import { ID, STATUS } from "./constants";
import { getBuildings, getType, bounds, isSettlementScene, isConnected, cellKey, transformCells } from "./store";
import { getDefinitions, getCategories, getCategory, saveDefinitions, resetDefinitions } from "./definitions";
import { buildingCenter } from "./render";
import { Placement } from "./placement";
import { completeBuilding, removeBuilding } from "./service";
import { sanitizeName } from "./util";
import type { BuildingType, Cell } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);
const confirm = (title: string, text: string): Promise<boolean> =>
  foundry.applications.api.DialogV2.confirm({ window: { title }, content: `<p>${text}</p>` });

/** Daten für die Grundriss-Vorschau (CSS-Grid) eines Gebäudetyps. */
function toPreview(b: BuildingType) {
  const { w, h } = bounds(b.cells);
  return {
    id: b.id,
    name: b.name,
    count: b.cells.length,
    shape: { w, h, cells: b.cells.map(([x, y]) => ({ col: x + 1, row: y + 1 })) }
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
      statusLabel: t(b.status === STATUS.DONE ? "SIEDLUNG.orders.done" : "SIEDLUNG.orders.ordered")
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
/* Gebäude-Editor (nur SL): Kategorien und Gebäudetypen               */
/* ------------------------------------------------------------------ */

const CATEGORY_COLORS = ["#c98a3d", "#6b7f9e", "#7a9a6b", "#b5656b", "#8a6bb5", "#4fa3a5", "#c2b13c"];

export class DefinitionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-definitions`,
    classes: [ID],
    window: { title: "SIEDLUNG.editor.title", icon: "fa-solid fa-pen-ruler", resizable: true },
    position: { width: 500, height: 600 },
    actions: {
      addCategory: DefinitionsApp.#onAddCategory,
      deleteCategory: DefinitionsApp.#onDeleteCategory,
      addBuilding: DefinitionsApp.#onAddBuilding,
      editBuilding: DefinitionsApp.#onEditBuilding,
      deleteBuilding: DefinitionsApp.#onDeleteBuilding,
      resetDefaults: DefinitionsApp.#onReset
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/definitions.hbs`, scrollable: [""] }
  };

  async _prepareContext(): Promise<object> {
    const { categories, buildings } = getDefinitions();
    const groups = categories.map(c => ({
      id: c.id,
      label: c.label,
      color: c.color,
      buildings: buildings.filter(b => b.category === c.id).map(toPreview)
    }));
    // Gebäude mit unbekannter Kategorie nicht verlieren
    const orphans = buildings.filter(b => !categories.some(c => c.id === b.category));
    if (orphans.length) groups.push({ id: "", label: t("SIEDLUNG.editor.noCategory"), color: "#888888", buildings: orphans.map(toPreview) });
    return { categories, groups };
  }

  _onRender(): void {
    const inputs = this.element.querySelectorAll("[data-cat-field]") as NodeListOf<HTMLInputElement>;
    for (const el of inputs) el.addEventListener("change", () => void this._onCategoryField(el));
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

  static async #onReset(): Promise<void> {
    if (await confirm(t("SIEDLUNG.editor.resetDefaults"), t("SIEDLUNG.editor.confirmReset"))) await resetDefinitions();
  }
}

const MAX_SHAPE_SIZE = 12;

interface EditorState {
  typeId: string | null;
  name: string;
  category: string;
  w: number;
  h: number;
  on: Set<string>;
}

/** Bearbeitet oder erstellt einen Gebäudetyp: Name, Kategorie und Form (Felder anklicken). */
export class BuildingEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-pencil" },
    position: { width: 380, height: "auto" },
    actions: {
      toggleCell: BuildingEditorApp.#onToggleCell,
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
      on: new Set(cells.map(([x, y]) => cellKey(x, y)))
    };
  }

  get title(): string {
    return t(this._state.typeId ? "SIEDLUNG.editor.editBuilding" : "SIEDLUNG.editor.newBuilding");
  }

  async _prepareContext(): Promise<object> {
    const { w, h, on, name, category } = this._state;
    const gridCells: { x: number; y: number; on: boolean }[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gridCells.push({ x, y, on: on.has(cellKey(x, y)) });
    return {
      name,
      w,
      h,
      max: MAX_SHAPE_SIZE,
      gridCells,
      count: on.size,
      categories: getCategories().map(c => ({ id: c.id, label: c.label, selected: c.id === category }))
    };
  }

  _onRender(): void {
    const inputs = this.element.querySelectorAll("input[name=w], input[name=h]") as NodeListOf<HTMLInputElement>;
    for (const input of inputs) input.addEventListener("change", () => this._resize());
  }

  /** Übernimmt Name und Kategorie aus dem Formular in den Zustand. */
  _syncForm(): void {
    const name = this.element.querySelector("input[name=name]") as HTMLInputElement | null;
    const category = this.element.querySelector("select[name=category]") as HTMLSelectElement | null;
    if (name) this._state.name = name.value;
    if (category) this._state.category = category.value;
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

    await saveDefinitions(defs => {
      const existing = s.typeId ? defs.buildings.find(b => b.id === s.typeId) : undefined;
      if (existing) {
        existing.name = name;
        existing.category = s.category;
        existing.cells = cells;
      } else {
        defs.buildings.push({ id: foundry.utils.randomID(), name, category: s.category, cells, cost: null, workers: null });
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
  for (const App of [PaletteApp, OrdersApp]) foundry.applications.instances.get(App.DEFAULT_OPTIONS.id)?.close();
}
