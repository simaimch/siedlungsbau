import type { BuildingType, Category, Cell, TerrainType } from "./types";

// Gebäude-Definitionen. Zellen sind [x, y]-Offsets (x = Spalte, y = Zeile), Ursprung oben links.
// Baukosten und Arbeiter folgen später: cost / workers sind schon als Platzhalter vorgesehen.

const rect = (w: number, h: number): Cell[] => {
  const c: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.push([x, y]);
  return c;
};

export const CATEGORIES: Record<string, Category> = {
  taverne: { label: "Taverne", color: "#c98a3d" },
  baracke: { label: "Baracke", color: "#6b7f9e" },
  sonstiges: { label: "Sonstiges", color: "#7a9a6b" }
};

export const BUILDINGS: BuildingType[] = [
  { id: "taverne-klein", name: "Kleine Taverne", category: "taverne", cells: rect(2, 2), cost: null, workers: null },
  { id: "taverne-gross", name: "Große Taverne", category: "taverne", cells: rect(3, 2).concat([[0, 2]]), cost: null, workers: null },
  { id: "baracke-gerade", name: "Baracke", category: "baracke", cells: rect(3, 1), cost: null, workers: null },
  { id: "baracke-l", name: "Winkelbaracke", category: "baracke", cells: [[0, 0], [0, 1], [0, 2], [1, 2]], cost: null, workers: null },
  { id: "lager", name: "Lagerhaus", category: "sonstiges", cells: rect(2, 1), cost: null, workers: null }
];

export const TERRAIN: Record<string, TerrainType> = {
  g: { label: "Gras", color: "#a8d672", buildable: true },
  r: { label: "Fels", color: "#808080", buildable: false }
};
/** Standardgelände: wird nicht gezeichnet, sondern ist die Hintergrundfarbe der Szene. */
export const DEFAULT_TERRAIN = "g";
export const ROCK_CHANCE = 0.1;
