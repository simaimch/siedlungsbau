import { STATUS } from "./constants";
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import { getCategory, syncTerrain } from "./definitions";
import { getBuildings, getTerrain, cellKey } from "./store";
import { lerpColor } from "./stats";
import { getRoadOrders, getRoads, getRoadType, roadGap, buildingCells } from "./roads-store";
import { roadAt, roadGeometry } from "./roads";
import type { Building, Cell } from "./types";

let terrainContainer: any = null;
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

/** Zeichnet das Gelände aller Felder; unbekannte Zeichen gelten als Standardgelände. */
function drawTerrain(): void {
  for (const c of terrainContainer.removeChildren()) c.destroy({ children: true });
  const terrain = getTerrain();
  if (!terrain) return;
  const s: number = canvas.scene.grid.size;
  const g = new PIXI.Graphics();
  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const type = TERRAIN[terrain.cells[y * terrain.cols + x]] ?? TERRAIN[DEFAULT_TERRAIN];
      if (!type) continue;
      fillRect(g, x * s, y * s, s, s, hexToInt(type.color), 1);
    }
  }
  terrainContainer.addChild(g);
}

/** Zeichnet fertige Wege und beauftragte Abschnitte (blasser, in der Farbe des Untergrunds gemischt) über dem Gelände. */
function drawRoads(): void {
  const scene = canvas.scene;
  const s: number = scene.grid.size;
  const roads = getRoads(scene);
  const orders = new Map(getRoadOrders(scene).map(o => [`${o.x},${o.y}`, o.typeId]));
  if (!orders.size && !/[^.]/.test(roads.cells)) return;
  const taken = buildingCells(scene);
  const terrain = getTerrain(scene);
  const cellAt = (x: number, y: number) => {
    const done = roadAt(roads, x, y);
    if (done !== null) return { typeId: done, ordered: false };
    const typeId = orders.get(`${x},${y}`);
    return typeId !== undefined ? { typeId, ordered: true } : null;
  };
  const pieces = roadGeometry(roads.cols, roads.rows, cellAt, (x, y) => taken.has(`${x},${y}`), roadGap());
  const colorOf = (typeId: string, ordered: boolean, x: number, y: number): number => {
    const base = getRoadType(typeId)?.color ?? "#888888";
    if (!ordered) return hexToInt(base);
    const ground = TERRAIN[terrain ? (terrain.cells[Math.floor(y) * terrain.cols + Math.floor(x)] ?? DEFAULT_TERRAIN) : DEFAULT_TERRAIN] ?? TERRAIN[DEFAULT_TERRAIN];
    return hexToInt(lerpColor(base, ground?.color ?? "#a8d672", 0.55));
  };
  // Erst alle Rechtecke, dann die diagonalen Verbindungen (mit PIXI v7 gilt ein gesetzter Linienstil für alle folgenden Formen)
  const g = new PIXI.Graphics();
  for (const p of pieces) if (p.kind === "rect") fillRect(g, p.x * s, p.y * s, p.w * s, p.h * s, colorOf(p.typeId, p.ordered, p.x + 0.001, p.y + 0.001), 1);
  terrainContainer.addChild(g);
  const d = new PIXI.Graphics();
  for (const p of pieces) if (p.kind === "diag") strokeLine(d, p.x1 * s, p.y1 * s, p.x2 * s, p.y2 * s, colorOf(p.typeId, p.ordered, p.x1, p.y1), 1, p.width * s);
  terrainContainer.addChild(d);
}

export function redraw(): void {
  if (!container || !terrainContainer || !canvas.scene) return;
  // Die erste Szene wird vor dem "ready"-Hook gezeichnet: Geländearten der SL deshalb hier aktuell halten.
  syncTerrain();
  drawTerrain();
  drawRoads();
  for (const c of container.removeChildren()) c.destroy({ children: true });
  const s: number = canvas.scene.grid.size;

  for (const b of getBuildings()) {
    const done = b.status === STATUS.DONE;
    const color = hexToInt(getCategory(b.category)?.color ?? "#888888");
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
