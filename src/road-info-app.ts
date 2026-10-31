import { ID } from "./constants";
import { costChips, getWeights } from "./definitions";
import { fractions } from "./week";
import { getRoadOrders, getRoads, getRoadType } from "./roads-store";
import { orderAsBuilding, roadAt } from "./roads";
import { completeRoads, requestRoadRemove } from "./roads-service";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);

/** Info-Fenster zu einem Wegabschnitt: Art, Status, Baufortschritt; Abbrechen/Entfernen, (SL) sofort fertigstellen. */
export class RoadInfoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-road-info`,
    classes: [ID],
    window: { title: "SIEDLUNG.roads.info.title", icon: "fa-solid fa-road", resizable: false },
    position: { width: 320, height: "auto" as const },
    actions: {
      remove: RoadInfoApp.#onRemove,
      complete: RoadInfoApp.#onComplete,
      focus: RoadInfoApp.#onFocus
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/road-info.hbs` }
  };

  x = 0;
  y = 0;

  /** Was liegt auf dem Feld? */
  state(): { typeId: string; done: boolean } | null {
    const done = roadAt(getRoads(), this.x, this.y);
    if (done !== null) return { typeId: done, done: true };
    const order = getRoadOrders().find(o => o.x === this.x && o.y === this.y);
    return order ? { typeId: order.typeId, done: false } : null;
  }

  async _prepareContext(): Promise<object> {
    const st = this.state();
    if (!st) {
      void this.close();
      return { missing: true };
    }
    const type = getRoadType(st.typeId);
    const order = getRoadOrders().find(o => o.x === this.x && o.y === this.y);
    let material = 0;
    let work = 0;
    if (!st.done && order && type) {
      const f = fractions(orderAsBuilding(order, type), { buildCost: type.buildCost, upkeep: [] }, getWeights());
      material = Math.round(f.res * 100);
      work = Math.round(f.lab * 100);
    }
    return {
      missing: false,
      name: type?.name ?? st.typeId,
      color: type?.color ?? "#888888",
      done: st.done,
      cell: `${this.x}, ${this.y}`,
      material,
      work,
      costs: costChips(type?.buildCost ?? []),
      isGM: game.user.isGM
    };
  }

  static async #onRemove(this: RoadInfoApp): Promise<void> {
    const st = this.state();
    if (!st) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t(st.done ? "SIEDLUNG.roads.info.remove" : "SIEDLUNG.roads.info.cancelBuild") },
      content: `<p>${t(st.done ? "SIEDLUNG.roads.info.confirmRemove" : "SIEDLUNG.roads.info.confirmCancel")}</p>`
    });
    if (ok) requestRoadRemove([[this.x, this.y]]);
  }

  static #onComplete(this: RoadInfoApp): void {
    void completeRoads([[this.x, this.y]]);
  }

  static #onFocus(this: RoadInfoApp): void {
    const s: number = canvas.scene.grid.size;
    canvas.animatePan({ x: (this.x + 0.5) * s, y: (this.y + 0.5) * s });
  }
}

export function openRoadInfo(x: number, y: number): void {
  const existing = foundry.applications.instances.get(RoadInfoApp.DEFAULT_OPTIONS.id) as RoadInfoApp | undefined;
  const app = existing ?? new RoadInfoApp();
  app.x = x;
  app.y = y;
  void app.render({ force: true });
}

export function refreshRoadInfo(): void {
  const existing = foundry.applications.instances.get(RoadInfoApp.DEFAULT_OPTIONS.id) as RoadInfoApp | undefined;
  if (!existing) return;
  if (!existing.state()) void existing.close();
  else void existing.render();
}

export function closeRoadInfo(): void {
  void foundry.applications.instances.get(RoadInfoApp.DEFAULT_OPTIONS.id)?.close();
}
