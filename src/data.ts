import type { Cell, Definitions, TerrainType } from "./types";

// Gebäude-Definitionen. Zellen sind [x, y]-Offsets (x = Spalte, y = Zeile), Ursprung oben links.
// Baukosten und Arbeiter folgen später: cost / workers sind schon als Platzhalter vorgesehen.

const rect = (w: number, h: number): Cell[] => {
  const c: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.push([x, y]);
  return c;
};

/** Mitgelieferte Standard-Definitionen; der SL kann sie im Gebäude-Editor ändern und erweitern. */
export const DEFAULT_DEFINITIONS: Definitions = {
  categories: [
    { id: "taverne", label: "Taverne", color: "#c98a3d" },
    { id: "baracke", label: "Baracke", color: "#6b7f9e" },
    { id: "sonstiges", label: "Sonstiges", color: "#7a9a6b" }
  ],
  buildings: [
    { id: "taverne-klein", name: "Kleine Taverne", category: "taverne", cells: rect(2, 2), cost: null, workers: null },
    { id: "taverne-gross", name: "Große Taverne", category: "taverne", cells: rect(3, 2).concat([[0, 2]]), cost: null, workers: null },
    { id: "baracke-gerade", name: "Baracke", category: "baracke", cells: rect(3, 1), cost: null, workers: null },
    { id: "baracke-l", name: "Winkelbaracke", category: "baracke", cells: [[0, 0], [0, 1], [0, 2], [1, 2]], cost: null, workers: null },
    { id: "lager", name: "Lagerhaus", category: "sonstiges", cells: rect(2, 1), cost: null, workers: null }
  ]
};

// Geländearten: Der Schlüssel ist das Zeichen, das pro Feld gespeichert wird.
export const TERRAIN: Record<string, TerrainType> = {
  g: { label: "Gras", color: "#a8d672", buildable: true },
  r: { label: "Fels", color: "#808080", buildable: false },
  u: { label: "Ufer", color: "#fdf182", buildable: false },
  s: { label: "Wasser", color: "#6ce3f8", buildable: false },
  t: { label: "Wasser", color: "#57acbb", buildable: false },
  w: { label: "Wald", color: "#32a55e", buildable: false },
};
/** Standardgelände: wird nicht gezeichnet, sondern ist die Hintergrundfarbe der Szene. */
export const DEFAULT_TERRAIN = "g";
export const ROCK_CHANCE = 0.1;
