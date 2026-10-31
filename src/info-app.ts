import { ID, STATUS } from "./constants";
import { costsOf, getBuildings, getType } from "./store";
import { costChips, effectChips, getAsset, getCategory, getWeights, sortEntries } from "./definitions";
import { buildingCenter } from "./render";
import { fractions } from "./week";
import { requestComplete, requestDescribe, requestRemove, requestRename } from "./actions";
import { cleanDescription } from "./description";
import { differsFromDefinition, setBuildingDisabled, syncBuildingToDefinition } from "./building-sync";
import type { Building, CostEntry } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);
const KEY = { resource: "resources", worker: "workers" } as const;

/** Info-Fenster zu einem Gebäude: Status, Baufortschritt, Betrieb, Wirkung; Umbenennen, Abreißen, (SL) Abschließen. */
export class BuildingInfoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-info`,
    classes: [ID],
    window: { title: "SIEDLUNG.info.title", icon: "fa-solid fa-circle-info", resizable: true },
    position: { width: 380, height: "auto" as const },
    actions: {
      rename: BuildingInfoApp.#onRename,
      remove: BuildingInfoApp.#onRemove,
      complete: BuildingInfoApp.#onComplete,
      editDescription: BuildingInfoApp.#onEditDescription,
      saveDescription: BuildingInfoApp.#onSaveDescription,
      cancelDescription: BuildingInfoApp.#onCancelDescription,
      focus: BuildingInfoApp.#onFocus,
      syncDefinition: BuildingInfoApp.#onSync,
      toggleDisabled: BuildingInfoApp.#onToggleDisabled
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/building-info.hbs`, scrollable: [""] }
  };

  buildingId = "";

  /** Beschreibung wird gerade im Rich-Text-Editor bearbeitet */
  _editing = false;

  get building(): Building | undefined {
    return getBuildings().find(b => b.id === this.buildingId);
  }

  async _prepareContext(): Promise<object> {
    const b = this.building;
    if (!b) {
      void this.close();
      return { missing: true };
    }
    const type = getType(b.typeId);
    const costs = costsOf(b);
    const done = b.status === STATUS.DONE;
    const cat = getCategory(b.category);

    // Normalisierte Form für die Vorschau (Gebäudezellen liegen an absoluten Rasterpositionen)
    const minX = Math.min(...b.cells.map(c => c[0]));
    const minY = Math.min(...b.cells.map(c => c[1]));
    const w = Math.max(...b.cells.map(c => c[0])) - minX + 1;
    const h = Math.max(...b.cells.map(c => c[1])) - minY + 1;

    const f = fractions(b, costs, getWeights());
    const progressRows = sortEntries(costs.buildCost as CostEntry[]).map(e => {
      const asset = getAsset(e.kind, e.id);
      const have = Math.min(e.amount, b.progress?.[KEY[e.kind]]?.[e.id] ?? 0);
      return {
        name: asset?.name ?? e.id,
        color: asset?.color ?? "#888",
        have,
        need: e.amount,
        percent: e.amount > 0 ? Math.round((have / e.amount) * 100) : 100,
        isWorker: e.kind === "worker"
      };
    }).filter(r => r.need > 0);

    // Beschreibung: bereinigtes HTML, zusätzlich angereichert (Verweise, Textformatierung); Geheimnisse bleiben verborgen
    const raw = cleanDescription(b.description);
    const TextEditor = (foundry.applications.ux as any).TextEditor.implementation;
    const descriptionHTML: string = raw ? await TextEditor.enrichHTML(raw, { secrets: false, rolls: false }) : "";

    return {
      missing: false,
      description: descriptionHTML,
      editing: this._editing,
      id: b.id,
      name: b.name,
      typeName: type?.name ?? "",
      showType: !!type && type.name !== b.name,
      categoryLabel: cat?.label ?? b.category,
      color: cat?.color ?? "#888",
      shape: { w, h, cells: b.cells.map(([x, y]) => ({ col: x - minX + 1, row: y - minY + 1 })) },
      count: b.cells.length,
      done,
      disabled: !!b.disabled,
      autoOff: !!b.autoDisabled && !b.disabled,
      material: Math.round(f.res * 100),
      work: Math.round(f.lab * 100),
      progressRows,
      upkeep: costChips(costs.upkeep),
      effects: effectChips(costs.statEffects ?? []),
      isGM: game.user.isGM,
      canSync: game.user.isGM && differsFromDefinition(b)
    };
  }

  _onRender(): void {
    if (!this._editing) return;
    const slot = this.element.querySelector(".description-editor") as HTMLElement | null;
    if (!slot || slot.querySelector("prose-mirror")) return;
    const ProseMirror = (foundry.applications.elements as any).HTMLProseMirrorElement;
    const editor = ProseMirror.create({ name: "description", value: this.building?.description ?? "", toggled: false, collaborate: false });
    slot.append(editor);
  }

  static #onEditDescription(this: BuildingInfoApp): void {
    this._editing = true;
    void this.render();
  }

  static #onSaveDescription(this: BuildingInfoApp): void {
    const editor = this.element.querySelector(".description-editor prose-mirror") as (HTMLElement & { value?: string }) | null;
    if (editor && this.building) requestDescribe(this.buildingId, editor.value ?? "");
    this._editing = false;
    void this.render();
  }

  static #onCancelDescription(this: BuildingInfoApp): void {
    this._editing = false;
    void this.render();
  }

  static #onRename(this: BuildingInfoApp): void {
    const input = this.element.querySelector("input[name=name]") as HTMLInputElement | null;
    if (input && this.building) requestRename(this.buildingId, input.value);
  }

  static async #onRemove(this: BuildingInfoApp): Promise<void> {
    const b = this.building;
    if (!b) return;
    const done = b.status === STATUS.DONE;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t(done ? "SIEDLUNG.info.demolish" : "SIEDLUNG.info.cancelBuild") },
      content: `<p>${t(done ? "SIEDLUNG.info.confirmDemolish" : "SIEDLUNG.info.confirmCancel")}</p>`
    });
    if (ok) requestRemove(this.buildingId);
  }

  static #onComplete(this: BuildingInfoApp): void {
    requestComplete(this.buildingId);
  }

  static async #onToggleDisabled(this: BuildingInfoApp): Promise<void> {
    const b = this.building;
    if (b) await setBuildingDisabled(b.id, !b.disabled);
  }

  static async #onSync(this: BuildingInfoApp): Promise<void> {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("SIEDLUNG.info.syncDefinition") },
      content: `<p>${t("SIEDLUNG.info.confirmSync")}</p>`
    });
    if (ok) await syncBuildingToDefinition(this.buildingId);
  }

  static #onFocus(this: BuildingInfoApp): void {
    const b = this.building;
    if (!b) return;
    const { x, y } = buildingCenter(b, canvas.scene.grid.size);
    canvas.animatePan({ x, y });
  }
}

/** Öffnet das Info-Fenster (ein einziges Fenster, wird für das angeklickte Gebäude wiederverwendet). */
export function openBuildingInfo(buildingId: string): void {
  const existing = foundry.applications.instances.get(BuildingInfoApp.DEFAULT_OPTIONS.id) as BuildingInfoApp | undefined;
  if (existing) {
    if (existing.buildingId !== buildingId) existing._editing = false;
    existing.buildingId = buildingId;
    void existing.render({ force: true });
    return;
  }
  const app = new BuildingInfoApp();
  app.buildingId = buildingId;
  void app.render({ force: true });
}

export function refreshBuildingInfo(): void {
  const existing = foundry.applications.instances.get(BuildingInfoApp.DEFAULT_OPTIONS.id) as BuildingInfoApp | undefined;
  if (!existing) return;
  if (!existing.building) void existing.close();
  else if (!existing._editing) void existing.render();
}

export function closeBuildingInfo(): void {
  void foundry.applications.instances.get(BuildingInfoApp.DEFAULT_OPTIONS.id)?.close();
}
