import { ID, STATUS } from "./constants";
import { BUILDINGS, CATEGORIES } from "./data";
import { getBuildings, getType, bounds, isSettlementScene } from "./store";
import { buildingCenter } from "./render";
import { Placement } from "./placement";
import { completeBuilding, removeBuilding } from "./service";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    const categories = Object.entries(CATEGORIES)
      .map(([id, c]) => ({
        id,
        label: c.label,
        color: c.color,
        buildings: BUILDINGS.filter(b => b.category === id).map(b => {
          const { w, h } = bounds(b.cells);
          return {
            id: b.id,
            name: b.name,
            count: b.cells.length,
            shape: { w, h, cells: b.cells.map(([x, y]) => ({ col: x + 1, row: y + 1 })) }
          };
        })
      }))
      .filter(c => c.buildings.length);
    return { categories };
  }

  static #onSelect(_event: Event, target: HTMLElement): void {
    const type = getType(target.dataset.id ?? "");
    if (type && isSettlementScene()) Placement.start(type);
  }
}

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
      categoryLabel: CATEGORIES[b.category]?.label ?? b.category,
      done: b.status === STATUS.DONE,
      statusLabel: game.i18n.localize(b.status === STATUS.DONE ? "SIEDLUNG.orders.done" : "SIEDLUNG.orders.ordered")
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
    const ok: boolean = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("SIEDLUNG.orders.remove") },
      content: `<p>${game.i18n.localize("SIEDLUNG.orders.removeConfirm")}</p>`
    });
    if (ok) void removeBuilding(target.dataset.id ?? "");
  }
}

type AppClass = { DEFAULT_OPTIONS: { id: string }; new (): any };

export function toggleApp(App: AppClass): void {
  const existing = foundry.applications.instances.get(App.DEFAULT_OPTIONS.id);
  if (existing) existing.close();
  else new App().render({ force: true });
}

export function refreshOrders(): void {
  foundry.applications.instances.get(OrdersApp.DEFAULT_OPTIONS.id)?.render();
}

export function closeApps(): void {
  for (const App of [PaletteApp, OrdersApp]) foundry.applications.instances.get(App.DEFAULT_OPTIONS.id)?.close();
}
