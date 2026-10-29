import { transformCells, bounds, checkPlacement } from "./store";
import { fillRect, outline } from "./render";
import { requestOrder } from "./service";
import { askBuildingName } from "./dialogs";
import type { BuildingType, Cell } from "./types";

export class Placement {
  static type: BuildingType | null = null;
  static rotation = 0;
  static mirror = false;
  static pos: { x: number; y: number } | null = null;
  static g: any = null;
  /** Solange der Namensdialog offen ist, werden weitere Klicks ignoriert. */
  static busy = false;
  /** Position (Bildschirm) beim Drücken der rechten Maustaste, um Klick und Ziehen (Verschieben der Ansicht) zu trennen. */
  static _rightDown: { x: number; y: number } | null = null;

  static start(type: BuildingType): void {
    this.stop();
    this.type = type;
    this.rotation = 0;
    this.mirror = false;
    this.pos = null;
    this.g = new PIXI.Graphics();
    this.g.eventMode = "none";
    canvas.interface.addChild(this.g);
    canvas.stage.on("pointermove", this._onMove);
    canvas.stage.on("pointerdown", this._onDown);
    canvas.stage.on("pointerup", this._onUp);
    window.addEventListener("keydown", this._onKey, true);
    ui.notifications.info(game.i18n.localize("SIEDLUNG.placement.hint"));
  }

  static stop(): void {
    if (!this.type) return;
    canvas.stage?.off("pointermove", this._onMove);
    canvas.stage?.off("pointerdown", this._onDown);
    canvas.stage?.off("pointerup", this._onUp);
    this._rightDown = null;
    window.removeEventListener("keydown", this._onKey, true);
    this.g?.destroy();
    this.g = null;
    this.type = null;
  }

  /** Absolute Rasterzellen unter dem Mauszeiger (Form ist um den Zeiger zentriert). */
  static _cells(): Cell[] {
    const s: number = canvas.scene.grid.size;
    const shape = transformCells(this.type!.cells, this.rotation, this.mirror);
    const { w, h } = bounds(shape);
    const cx = Math.floor(this.pos!.x / s) - Math.floor(w / 2);
    const cy = Math.floor(this.pos!.y / s) - Math.floor(h / 2);
    return shape.map(([x, y]): Cell => [x + cx, y + cy]);
  }

  static _draw(): void {
    if (!this.g || !this.pos || !this.type) return;
    const s: number = canvas.scene.grid.size;
    const cells = this._cells();
    const ok = checkPlacement(canvas.scene, cells).ok;
    const color = ok ? 0x2ecc71 : 0xe74c3c;
    this.g.clear();
    for (const [x, y] of cells) fillRect(this.g, x * s, y * s, s, s, color, 0.4);
    outline(this.g, cells, s, color, 1, 3);
  }

  static _onMove = (event: any): void => {
    Placement.pos = event.getLocalPosition(canvas.stage);
    Placement._draw();
  };

  static _onDown = (event: any): void => {
    if (event.button === 2) {
      Placement._rightDown = { x: event.global.x, y: event.global.y };
      return;
    }
    if (event.button !== 0 || !Placement.pos || !Placement.type) return;
    if (Placement.busy) return;
    const cells = Placement._cells();
    const res = checkPlacement(canvas.scene, cells);
    if (!res.ok) {
      ui.notifications.warn(game.i18n.localize(res.reason!));
      return;
    }
    void Placement._confirm(Placement.type, cells, event.shiftKey);
  };

  /** Fragt den Namen ab und erteilt dann den Auftrag. Bei Abbruch des Dialogs bleibt die Platzierung aktiv. */
  static async _confirm(type: BuildingType, cells: Cell[], keep: boolean): Promise<void> {
    const sceneId: string = canvas.scene.id;
    this.busy = true;
    try {
      const name = await askBuildingName(type.name);
      if (name === null || canvas.scene?.id !== sceneId) return;
      requestOrder(type.id, cells, name);
      if (!keep) this.stop();
    } finally {
      this.busy = false;
    }
  }

  /** Rechtsklick (ohne Ziehen) bricht die Platzierung ab; Rechts-Ziehen verschiebt weiter die Ansicht. */
  static _onUp = (event: any): void => {
    if (event.button !== 2 || !Placement._rightDown) return;
    const moved = Math.hypot(event.global.x - Placement._rightDown.x, event.global.y - Placement._rightDown.y);
    Placement._rightDown = null;
    if (moved < 5) Placement.stop();
  };

  static _onKey = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (event.code === "Escape") {
      Placement.stop();
    } else if (event.code === "KeyR" || event.key?.toLowerCase() === "r") {
      if (event.repeat) return;
      if (event.shiftKey) Placement.mirror = !Placement.mirror;
      else Placement.rotation = (Placement.rotation + 1) % 4;
      Placement._draw();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
}
