/** Rasterzelle als [x, y] (x = Spalte, y = Zeile). */
export type Cell = [number, number];

export type Status = "ordered" | "done";

export interface Category {
  label: string;
  color: string;
}

export interface BuildingType {
  id: string;
  name: string;
  category: string;
  /** Zellen als Offsets, Ursprung oben links. */
  cells: Cell[];
  /** Platzhalter für später. */
  cost: number | null;
  workers: number | null;
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
}

export interface OrderMessage {
  action: "order";
  sceneId: string;
  typeId: string;
  cells: Cell[];
  userId: string;
}

export interface PlacementCheck {
  ok: boolean;
  /** Lokalisierungsschlüssel */
  reason?: string;
}
