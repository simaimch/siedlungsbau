import { ID } from "./constants";
import { TERRAIN } from "./data";
import { TerrainBrush, TERRAIN_APP_ID } from "./terrain-brush";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** SL: Auswahl des Geländetyps für den Pinsel. */
export class TerrainApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: TERRAIN_APP_ID,
    classes: [ID],
    window: { title: "SIEDLUNG.terrain.title", icon: "fa-solid fa-paintbrush", resizable: true },
    position: { width: 260, height: "auto" as const },
    actions: { pick: TerrainApp.#onPick }
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
