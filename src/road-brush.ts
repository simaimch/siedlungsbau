import { ID } from "./constants";
import { fillRect, outline, hexToInt } from "./render";
import { Placement } from "./placement";
import { TerrainBrush } from "./terrain-brush";
import { isSettlementScene } from "./store";
import { getRoadOrders, getRoads, getRoadType, mapSize, roadContext } from "./roads-store";
import { completeRoads, requestRoadOrder, requestRoadRemove } from "./roads-service";
import { roadAt, roadCellProblem, strokeCells } from "./roads";
import type { Cell } from "./types";

export const PALETTE_APP_ID = `${ID}-palette`;

export type RoadMode = { kind: "order"; typeId: string } | { kind: "erase" } | { kind: "complete" };

/**
 * Wege-Pinsel: Mit gedrückter linker Maustaste über Felder ziehen. Beim Loslassen wird der Strich ausgeführt
 * (Wege beauftragen, entfernen oder – nur SL – sofort fertigstellen). Rechtsklick oder ESC beendet den Pinsel.
 */
export class RoadBrush {
  static mode: RoadMode | null = null;
  static g: any = null;
  static hover: Cell | null = null;
  static stroke: Cell[] = [];
  static striking = false;
  static _rightDown: { x: number; y: number } | null = null;

  static start(mode: RoadMode): void {
    if (!isSettlementScene()) return;
    if (mode.kind === "complete" && !game.user.isGM) return;
    if (mode.kind === "order" && !getRoadType(mode.typeId)) return;
    Placement.stop();
    TerrainBrush.stop();
    const wasActive = this.mode !== null;
    this.mode = mode;
    this.stroke = [];
    this.striking = false;
    if (!wasActive) {
      this.g = new PIXI.Graphics();
      this.g.eventMode = "none";
      canvas.interface.addChild(this.g);
      canvas.stage.on("pointermove", this._onMove);
      canvas.stage.on("pointerdown", this._onDown);
      canvas.stage.on("pointerup", this._onUp);
      window.addEventListener("keydown", this._onKey, true);
      ui.notifications.info(game.i18n.localize("SIEDLUNG.roads.hint"));
    }
    this._draw();
    this._refreshApp();
  }

  static stop(): void {
    if (this.mode === null) return;
    canvas.stage?.off("pointermove", this._onMove);
    canvas.stage?.off("pointerdown", this._onDown);
    canvas.stage?.off("pointerup", this._onUp);
    window.removeEventListener("keydown", this._onKey, true);
    this._rightDown = null;
    this.g?.destroy();
    this.g = null;
    this.mode = null;
    this.hover = null;
    this.stroke = [];
    this.striking = false;
    this._refreshApp();
  }

  static _refreshApp(): void {
    void foundry.applications.instances.get(PALETTE_APP_ID)?.render();
  }

  static _cellAt(event: any): Cell | null {
    const pos = event.getLocalPosition(canvas.stage);
    const s: number = canvas.scene.grid.size;
    const x = Math.floor(pos.x / s);
    const y = Math.floor(pos.y / s);
    const { cols, rows } = mapSize();
    return x >= 0 && y >= 0 && x < cols && y < rows ? [x, y] : null;
  }

  /** Felder des Strichs, auf die der Pinsel etwas bewirken würde. */
  static _effective(cells: Cell[]): Cell[] {
    const mode = this.mode;
    if (!mode) return [];
    if (mode.kind === "order") {
      const ctx = roadContext();
      return cells.filter(([x, y]) => roadCellProblem(x, y, ctx) === null);
    }
    const roads = getRoads();
    const orders = new Set(getRoadOrders().map(o => `${o.x},${o.y}`));
    return cells.filter(([x, y]) => (mode.kind === "complete" ? orders.has(`${x},${y}`) : orders.has(`${x},${y}`) || roadAt(roads, x, y) !== null));
  }

  static _draw(): void {
    if (!this.g || !this.mode) return;
    const s: number = canvas.scene.grid.size;
    this.g.clear();
    const cells: Cell[] = this.striking ? this.stroke : this.hover ? [this.hover] : [];
    const good = new Set(this._effective(cells).map(([x, y]) => `${x},${y}`));
    const mode = this.mode;
    const base = mode.kind === "order" ? hexToInt(getRoadType(mode.typeId)?.color ?? "#888888") : mode.kind === "complete" ? 0x2ecc71 : 0xe74c3c;
    for (const [x, y] of cells) {
      const ok = good.has(`${x},${y}`);
      fillRect(this.g, x * s, y * s, s, s, ok ? base : 0x555555, ok ? 0.6 : 0.3);
    }
    if (cells.length) outline(this.g, cells, s, 0xffffff, 0.9, 2);
  }

  static _onMove = (event: any): void => {
    const cell = RoadBrush._cellAt(event);
    RoadBrush.hover = cell;
    if (RoadBrush.striking && cell) {
      const last = RoadBrush.stroke[RoadBrush.stroke.length - 1];
      if (!last || last[0] !== cell[0] || last[1] !== cell[1]) {
        const known = new Set(RoadBrush.stroke.map(([x, y]) => `${x},${y}`));
        // Lücken bei schneller Mausbewegung füllen: Linie vom letzten Feld zum aktuellen
        for (const c of strokeCells(last ?? cell, cell)) {
          const key = `${c[0]},${c[1]}`;
          if (known.has(key)) continue;
          known.add(key);
          RoadBrush.stroke.push(c);
        }
      }
    }
    RoadBrush._draw();
  };

  static _onDown = (event: any): void => {
    if (event.button === 2) {
      RoadBrush._rightDown = { x: event.global.x, y: event.global.y };
      return;
    }
    if (event.button !== 0 || RoadBrush.mode === null) return;
    const cell = RoadBrush._cellAt(event);
    if (!cell) return;
    RoadBrush.striking = true;
    RoadBrush.stroke = [cell];
    RoadBrush._draw();
  };

  static _onUp = (event: any): void => {
    if (event.button === 2) {
      // Rechtsklick ohne Ziehen beendet den Pinsel; Rechts-Ziehen verschiebt weiter die Ansicht
      if (!RoadBrush._rightDown) return;
      const moved = Math.hypot(event.global.x - RoadBrush._rightDown.x, event.global.y - RoadBrush._rightDown.y);
      RoadBrush._rightDown = null;
      if (moved < 5) RoadBrush.stop();
      return;
    }
    if (event.button !== 0 || !RoadBrush.striking || !RoadBrush.mode) return;
    const mode = RoadBrush.mode;
    const cells = RoadBrush._effective(RoadBrush.stroke);
    RoadBrush.striking = false;
    RoadBrush.stroke = [];
    RoadBrush._draw();
    if (!cells.length) return;
    if (mode.kind === "order") requestRoadOrder(mode.typeId, cells);
    else if (mode.kind === "erase") requestRoadRemove(cells);
    else void completeRoads(cells);
  };

  static _onKey = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (event.code !== "Escape") return;
    RoadBrush.stop();
    event.preventDefault();
    event.stopPropagation();
  };
}
