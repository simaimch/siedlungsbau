import { STATUS } from "./constants";
import { CATEGORIES, DEFAULT_TERRAIN, TERRAIN } from "./data";
import { getBuildings, cellKey, getTerrain } from "./store";
import type { Building, Cell } from "./types";

let container: any = null;

// Kleine Helfer, die mit PIXI v7 und v8 funktionieren.
export function fillRect(g: any, x: number, y: number, w: number, h: number, color: number, alpha: number): void {
  if (typeof g.rect === "function") g.rect(x, y, w, h).fill({ color, alpha });
  else g.beginFill(color, alpha).drawRect(x, y, w, h).endFill();
}

export function strokeLine(g: any, x1: number, y1: number, x2: number, y2: number, color: number, alpha: number, width = 3): void {
  if (typeof g.rect === "function") g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color, alpha });
  else g.lineStyle(width, color, alpha).moveTo(x1, y1).lineTo(x2, y2);
}

function makeText(content: string, size: number): any {
  const style = { fontFamily: "Signika, sans-serif", fontSize: size, fill: 0xffffff, align: "center" };
  return parseInt(PIXI.VERSION) >= 8 ? new PIXI.Text({ text: content, style }) : new PIXI.Text(content, style);
}

export const hexToInt = (hex: string): number => parseInt(hex.replace("#", ""), 16);

/** Zeichnet die Umrandung einer Zellmenge (nur Außenkanten). */
export function outline(g: any, cells: Cell[], s: number, color: number, alpha: number, width = 3): void {
  const set = new Set(cells.map(([x, y]) => cellKey(x, y)));
  for (const [x, y] of cells) {
    const px = x * s, py = y * s;
    if (!set.has(cellKey(x, y - 1))) strokeLine(g, px, py, px + s, py, color, alpha, width);
    if (!set.has(cellKey(x, y + 1))) strokeLine(g, px, py + s, px + s, py + s, color, alpha, width);
    if (!set.has(cellKey(x - 1, y))) strokeLine(g, px, py, px, py + s, color, alpha, width);
    if (!set.has(cellKey(x + 1, y))) strokeLine(g, px + s, py, px + s, py + s, color, alpha, width);
  }
}

export function buildingCenter(b: Building, s: number): { x: number; y: number } {
  const ax = b.cells.reduce((a, c) => a + c[0], 0) / b.cells.length + 0.5;
  const ay = b.cells.reduce((a, c) => a + c[1], 0) / b.cells.length + 0.5;
  // Zelle wählen, die dem Schwerpunkt am nächsten liegt (bei L-Formen liegt der Schwerpunkt evtl. außerhalb)
  let best = b.cells[0];
  let bd = Infinity;
  for (const c of b.cells) {
    const d = (c[0] + 0.5 - ax) ** 2 + (c[1] + 0.5 - ay) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return { x: (best[0] + 0.5) * s, y: (best[1] + 0.5) * s };
}

export function initRender(): void {
  teardownRender();
  // Gelände zuerst hinzufügen, damit es unter den Gebäuden liegt.
  terrainContainer = new PIXI.Container();
  terrainContainer.eventMode = "none";
  canvas.interface.addChild(terrainContainer);
  container = new PIXI.Container();
  container.eventMode = "none";
  canvas.interface.addChild(container);
  redraw();
}

export function teardownRender(): void {
  if (terrainContainer) terrainContainer.destroy({ children: true });
  terrainContainer = null;
  if (container) container.destroy({ children: true });
  container = null;
}

export function redraw(): void {
  if (!container || !terrainContainer || !canvas.scene) return;
  drawTerrain();
  for (const c of container.removeChildren()) c.destroy({ children: true });
  const s: number = canvas.scene.grid.size;

  for (const b of getBuildings()) {
    const done = b.status === STATUS.DONE;
    const color = hexToInt(CATEGORIES[b.category]?.color ?? "#888888");
    const g = new PIXI.Graphics();
    for (const [x, y] of b.cells) fillRect(g, x * s, y * s, s, s, color, done ? 0.65 : 0.25);
    outline(g, b.cells, s, color, done ? 1 : 0.7);
    container.addChild(g);

    const label = done ? b.name : `${b.name} (${game.i18n.localize("SIEDLUNG.building.underConstruction")})`;
    const text = makeText(label, s * 0.22);
    if (text.width > s * 2.2) text.scale.set((s * 2.2) / text.width);
    text.anchor.set(0.5);
    const { x, y } = buildingCenter(b, s);
    const back = new PIXI.Graphics();
    const w: number = text.width;
    const h: number = text.height;
    fillRect(back, -w / 2 - 4, -h / 2 - 2, w + 8, h + 4, 0x000000, 0.55);
    const holder = new PIXI.Container();
    holder.addChild(back, text);
    holder.position.set(x, y);
    container.addChild(holder);
  }
}

let terrainContainer: any = null;   // neben `container`





function drawTerrain(): void {
  for (const c of terrainContainer.removeChildren()) c.destroy({ children: true });
  const terrain = getTerrain();
  if (!terrain) return;
  const s: number = canvas.scene.grid.size;
  const g = new PIXI.Graphics();
  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const code = terrain.cells[y * terrain.cols + x];
      if (!code || code === DEFAULT_TERRAIN || !TERRAIN[code]) continue;
      fillRect(g, x * s, y * s, s, s, hexToInt(TERRAIN[code].color), 0.85);
    }
  }
  terrainContainer.addChild(g);
}