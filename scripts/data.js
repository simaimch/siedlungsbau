// Gebäude-Definitionen. Zellen sind [x, y]-Offsets (x = Spalte, y = Zeile), Ursprung oben links.
// Baukosten und Arbeiter folgen später: cost / workers sind schon als Platzhalter vorgesehen.

const rect = (w, h) => {
  const c = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.push([x, y]);
  return c;
};

export const CATEGORIES = {
  taverne: { label: "Taverne", color: "#c98a3d" },
  baracke: { label: "Baracke", color: "#6b7f9e" },
  sonstiges: { label: "Sonstiges", color: "#7a9a6b" }
};

export const BUILDINGS = [
  { id: "taverne-klein", name: "Kleine Taverne", category: "taverne", cells: rect(2, 2), cost: null, workers: null },
  { id: "taverne-gross", name: "Große Taverne", category: "taverne", cells: rect(3, 2).concat([[0, 2]]), cost: null, workers: null },
  { id: "baracke-gerade", name: "Baracke", category: "baracke", cells: rect(3, 1), cost: null, workers: null },
  { id: "baracke-l", name: "Winkelbaracke", category: "baracke", cells: [[0, 0], [0, 1], [0, 2], [1, 2]], cost: null, workers: null },
  { id: "lager", name: "Lagerhaus", category: "sonstiges", cells: rect(2, 1), cost: null, workers: null }
];
