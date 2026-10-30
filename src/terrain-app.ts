import { ID } from "./constants";
import { TERRAIN } from "./data";
import { TerrainBrush, TERRAIN_APP_ID } from "./terrain-brush";
import { regenerateMap } from "./mapgen-service";
import { expandMap } from "./map-resize-service";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** SL: Auswahl des Geländetyps für den Pinsel. */
export class TerrainApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: TERRAIN_APP_ID,
    classes: [ID],
    window: { title: "SIEDLUNG.terrain.title", icon: "fa-solid fa-paintbrush", resizable: true },
    position: { width: 260, height: "auto" as const },
    actions: { pick: TerrainApp.#onPick, regenerate: TerrainApp.#onRegenerate, expand: TerrainApp.#onExpand }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/terrain.hbs`, scrollable: [""] }
  };

  async _prepareContext(): Promise<object> {
    return {
      terrain: Object.entries(TERRAIN).map(([code, t]) => ({
        code,
        label: t.label,
        color: t.color,
        buildable: t.buildable,
        selected: TerrainBrush.code === code
      })),
      active: TerrainBrush.code !== null
    };
  }

  static #onRegenerate(): void {
    TerrainBrush.stop();
    void regenerateMap();
  }

  static async #onExpand(this: TerrainApp): Promise<void> {
    const val = (n: string): number => Number((this.element.querySelector(`input[name="expand-${n}"]`) as HTMLInputElement | null)?.value) || 0;
    TerrainBrush.stop();
    if (await expandMap({ top: val("top"), bottom: val("bottom"), left: val("left"), right: val("right") })) {
      (this.element.querySelectorAll('input[name^="expand-"]') as NodeListOf<HTMLInputElement>).forEach((i: HTMLInputElement) => { i.value = "0"; });
    }
  }

  static #onPick(_event: Event, target: HTMLElement): void {
    const code = target.dataset.code ?? "";
    // Erneuter Klick auf das gewählte Gelände beendet den Pinsel
    if (TerrainBrush.code === code) TerrainBrush.stop();
    else TerrainBrush.start(code);
  }

  async close(options?: any): Promise<any> {
    TerrainBrush.stop();
    return super.close(options);
  }
}
