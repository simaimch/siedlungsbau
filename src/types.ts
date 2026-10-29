/** Rasterzelle als [x, y] (x = Spalte, y = Zeile). */
export type Cell = [number, number];

export type Status = "ordered" | "done";

export interface Category {
  id: string;
  label: string;
  /** CSS-Farbe im Format #rrggbb */
  color: string;
}

/** Vom SL pflegbare Definitionen (als Welt-Einstellung gespeichert). */
export interface Definitions {
  categories: Category[];
  buildings: BuildingType[];
  resources: PricedType[];
  workers: PricedType[];
}

export type CostKind = "resource" | "worker";

/** Ein Posten in Bau- oder Betriebskosten. */
export interface CostEntry {
  kind: CostKind;
  /** ID der Ressource bzw. Arbeiterart */
  id: string;
  amount: number;
}

/** Ressource oder Arbeiterart: Name, Anzeigefarbe und Marktwert in Goldmünzen (Nutzen folgt später). */
export interface PricedType {
  id: string;
  name: string;
  color: string;
  value: number;
}

export interface BuildingType {
  id: string;
  name: string;
  category: string;
  /** Zellen als Offsets, Ursprung oben links. */
  cells: Cell[];
  /** Einmalige Baukosten (Ressourcen und/oder Personal). */
  buildCost: CostEntry[];
  /** Laufende Betriebskosten (Ressourcen und/oder Personal); der Zeitraum folgt später. */
  upkeep: CostEntry[];
}

/** Ein beauftragtes oder fertiges Gebäude auf der Karte (als Scene-Flag gespeichert). */
export interface Building {
  id: string;
  typeId: string;
  name: string;
  category: string;
  /** Absolute Rasterzellen. */
  cells: Cell[];
  status: Status;
  /** Beim Beauftragen festgehaltene Kosten (ältere Aufträge ohne diese Felder nutzen die aktuelle Typ-Definition). */
  buildCost?: CostEntry[];
  upkeep?: CostEntry[];
  /** Bisher gelieferte Menge je Ressource bzw. Arbeiterart (nur im Bau). */
  progress?: Progress;
}

export interface Progress {
  resources: Record<string, number>;
  workers: Record<string, number>;
}

/** Vorräte einer Siedlung (an der Szene gespeichert). Arbeiter sind die Arbeitskraft pro Woche, keine Verbrauchsgüter. */
export interface SettlementState {
  week: number;
  resources: Record<string, number>;
  workers: Record<string, number>;
}

export interface OrderMessage {
  action: "order";
  sceneId: string;
  typeId: string;
  /** Vom Auftraggeber gewählter Name des Gebäudes. */
  name: string;
  cells: Cell[];
  userId: string;
}

export interface PlacementCheck {
  ok: boolean;
  /** Lokalisierungsschlüssel */
  reason?: string;
}

export interface TerrainType {
  label: string;
  color: string;
  buildable: boolean;
}

/** Gelände einer Szene: zeilenweise, ein Zeichen pro Feld (Schlüssel aus TERRAIN). */
export interface TerrainData {
  cols: number;
  rows: number;
  cells: string;
}
