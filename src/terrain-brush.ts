import { ID } from "./constants";
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import { getBuildings, getTerrain, isSettlementScene } from "./store";
import { fillRect, outline, hexToInt } from "./render";
import { Placement } from "./placement";
import { RoadBrush } from "./road-brush";
import type { TerrainData } from "./types";

export const TERRAIN_APP_ID = `${ID}-terrain`;

/** Schreibzugriffe nacheinander ausführen, damit schnelle Klicks sich nicht gegenseitig überschreiben. */
let queue: Promise<void> = Promise.resolve();

/** SL: setzt das Gelände eines einzelnen Feldes. */
export function paintCell(x: number, y: number, code: string): Promise<void> {
  queue = queue.then(() => doPaint(x, y, code)).catch(err => console.error(`${ID} | paintCell`, err));
  return queue;
}

async function doPaint(x: number, y: number, code: string): Promise<void> {
  if (!game.user.isGM || !isSettlementScene() || !TERRAIN[code]) return;
  const scene = canvas.scene;
  const s: number = scene.grid.size;
  let terrain: TerrainData | null = getTerrain(scene);
  if (!terrain) {
    // Szene wurde nachträglich markiert: Gelände aus den Szenenmaßen anlegen (alles Standardgelände)
    const d = scene.dimensions;
    const cols = Math.round(d.sceneWidth / s);
    const rows = Math.round(d.sceneHeight / s);
    terrain = { cols, rows, cells: DEFAULT_TERRAIN.repeat(cols * rows) };
  }
  if (x < 0 || y < 0 || x >= terrain.cols || y >= terrain.rows) return;
  const index = y * terrain.cols + x;
  if ((terrain.cells[index] ?? DEFAULT_TERRAIN) === code) return;
  // Nicht baubares Gelände unter einem Gebäude würde den Bestand ungültig machen.
  if (!TERRAIN[code].buildable && getBuildings(scene).some(b => b.cells.some(([bx, by]) => bx === x && by === y))) {
    ui.notifications.warn(game.i18n.localize("SIEDLUNG.terrain.occupied"));
    return;
  }
  const cells = terrain.cells.slice(0, index) + code + terrain.cells.slice(index + 1);
  await scene.setFlag(ID, "terrain", { cols: terrain.cols, rows: terrain.rows, cells });
}

/** Pinsel: Linksklick setzt das gewählte Gelände auf ein Feld; Rechtsklick/ESC beendet. */
export class TerrainBrush {
  /** Gewähltes Gelände (Schlüssel aus TERRAIN) oder null, wenn kein Pinsel aktiv ist. */
  static code: string | null = null;
  static g: any = null;
  static cell: { x: number; y: number } | null = null;
  static _rightDown: { x: number; y: number } | null = null;

  static start(code: string): void {
    if (!TERRAIN[code] || !game.user.isGM) return;
    Placement.stop();
    RoadBrush.stop();
    const wasActive = this.code !== null;
    this.code = code;
    if (!wasActive) {
      this.g = new PIXI.Graphics();
      this.g.eventMode = "none";
      canvas.interface.addChild(this.g);
      canvas.stage.on("pointermove", this._onMove);
      canvas.stage.on("pointerdown", this._onDown);
      canvas.stage.on("pointerup", this._onUp);
      window.addEventListener("keydown", this._onKey, true);
    }
    this._draw();
    this._refreshApp();
  }

  static stop(): void {
    if (this.code === null) return;
    canvas.stage?.off("pointermove", this._onMove);
    canvas.stage?.off("pointerdown", this._onDown);
    canvas.stage?.off("pointerup", this._onUp);
    window.removeEventListener("keydown", this._onKey, true);
    this._rightDown = null;
    this.g?.destroy();
    this.g = null;
    this.code = null;
    this.cell = null;
    this._refreshApp();
  }

  static _refreshApp(): void {
    void foundry.applications.instances.get(TERRAIN_APP_ID)?.render();
  }

  static _cellAt(event: any): { x: number; y: number } | null {
    const pos = event.getLocalPosition(canvas.stage);
    const s: number = canvas.scene.grid.size;
    const x = Math.floor(pos.x / s);
    const y = Math.floor(pos.y / s);
    const t = getTerrain();
    const cols = t?.cols ?? Math.round(canvas.scene.dimensions.sceneWidth / s);
    const rows = t?.rows ?? Math.round(canvas.scene.dimensions.sceneHeight / s);
    return x >= 0 && y >= 0 && x < cols && y < rows ? { x, y } : null;
  }

  static _draw(): void {
    if (!this.g || this.code === null) return;
    this.g.clear();
    if (!this.cell) return;
    const s: number = canvas.scene.grid.size;
    const { x, y } = this.cell;
    fillRect(this.g, x * s, y * s, s, s, hexToInt(TERRAIN[this.code].color), 0.6);
    outline(this.g, [[x, y]], s, 0xffffff, 1, 3);
  }

  static _onMove = (event: any): void => {
    TerrainBrush.cell = TerrainBrush._cellAt(event);
    TerrainBrush._draw();
  };

  static _onDown = (event: any): void => {
    if (event.button === 2) {
      TerrainBrush._rightDown = { x: event.global.x, y: event.global.y };
      return;
    }
    if (event.button !== 0 || TerrainBrush.code === null) return;
    const cell = TerrainBrush._cellAt(event);
    if (cell) void paintCell(cell.x, cell.y, TerrainBrush.code);
  };

  /** Rechtsklick ohne Ziehen beendet den Pinsel; Rechts-Ziehen verschiebt weiter die Ansicht. */
  static _onUp = (event: any): void => {
    if (event.button !== 2 || !TerrainBrush._rightDown) return;
    const moved = Math.hypot(event.global.x - TerrainBrush._rightDown.x, event.global.y - TerrainBrush._rightDown.y);
    TerrainBrush._rightDown = null;
    if (moved < 5) TerrainBrush.stop();
  };

  static _onKey = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (event.code !== "Escape") return;
    TerrainBrush.stop();
    event.preventDefault();
    event.stopPropagation();
  };
}
