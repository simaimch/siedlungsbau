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
  stats: StatType[];
  /** Geländearten; leer/fehlend = nur die mitgelieferten */
  terrain: TerrainEntry[];
  /** Kategorien der Gesetze, z. B. "Öffentliche Sicherheit" */
  lawCategories?: LawCategory[];
  laws?: Law[];
  /** Getriggerte Effekte: wirken, solange ihre Bedingungen erfüllt sind */
  triggers?: Trigger[];
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
  /** Nur Ressourcen: Baugewicht – wie stark eine gelieferte Einheit zum Materialfortschritt zählt (Standard 1, Kommazahlen erlaubt). */
  weight?: number;
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
  /** Wirkung auf Siedlungs-Werte pro Woche, solange das Gebäude fertig ist (negativ senkt den Wert). */
  statEffects?: StatEffect[];
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
  statEffects?: StatEffect[];
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
  /** Werte der Siedlungs-Stats (Moral, Loyalität, ...); fehlende Werte gelten als Standardwert. */
  stats: Record<string, number>;
  /** Aktive Effekte mit Restdauer in Wochen */
  effects: ActiveEffect[];
  /** Zustand der Gesetze dieser Siedlung (aktive Ausprägung, Sperren, Sichtbarkeit) */
  laws: Record<string, LawState>;
  /** Wie viele Gesetze die Spieler in dieser Woche bereits geändert haben */
  lawChanges: number;
  /** Pro Siedlung abweichende Schaltung getriggerter Effekte (ID → an/aus); fehlend = Voreinstellung des Triggers */
  triggers: Record<string, boolean>;
}

export interface LawCategory {
  id: string;
  label: string;
}

/** Eine Ausprägung eines Gesetzes; wirkt wie ein dauerhafter Effekt, solange sie aktiv ist. */
export interface LawOption {
  id: string;
  name: string;
  entries: EffectEntry[];
}

export interface Law {
  id: string;
  name: string;
  category: string;
  description?: string;
  /** Die erste Ausprägung gilt, solange keine andere gewählt wurde. */
  options: LawOption[];
}

/** Zustand eines Gesetzes in einer Siedlung. */
export interface LawState {
  /** Aktive Ausprägung; null = erste Ausprägung */
  option: string | null;
  /** Woche der letzten Änderung durch Spieler (für die Wartezeit); null = nie */
  since: number | null;
  /** Für Spieler versteckt */
  hidden: boolean;
  /** Ausprägung kann von Spielern nicht geändert werden */
  locked: boolean;
  /** Ausprägungen, die ausgegraut und für Spieler nicht wählbar sind */
  disabled: string[];
  /** Ausprägungen, die für Spieler versteckt sind */
  hiddenOptions: string[];
}

export type EffectKind = "resource" | "worker" | "stat";

/** Eine Veränderung durch einen Effekt: Ressourcen pro Woche, Arbeiter und Werte als Zuschlag, solange er aktiv ist. */
export interface EffectEntry {
  kind: EffectKind;
  id: string;
  amount: number;
}

/** Zeitlich begrenzter Effekt, z. B. "Wanderarbeiter": 3 Wochen lang +5 Handwerker. */
export interface ActiveEffect {
  id: string;
  name: string;
  /** Verbleibende Wochen; bei 0 wird der Effekt entfernt. */
  remaining: number;
  entries: EffectEntry[];
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

/** Eine Geländeart; die ID ist das Zeichen, das pro Feld gespeichert wird. */
export interface TerrainEntry extends TerrainType {
  id: string;
}

/** Gelände einer Szene: zeilenweise, ein Zeichen pro Feld (Schlüssel aus TERRAIN). */
export interface TerrainData {
  cols: number;
  rows: number;
  cells: string;
}

export type StatKind = "interval" | "open";

/** Stützpunkt eines Intervall-Stats: Name und Farbe an dieser Stelle; dazwischen wird die Farbe interpoliert. */
export interface StatPoint {
  value: number;
  name: string;
  /** #rrggbb */
  color: string;
}

/** Wert in einem Intervall (z. B. 0 bis 100) mit benannten, gefärbten Stützpunkten. */
export interface IntervalStat {
  id: string;
  name: string;
  kind: "interval";
  min: number;
  max: number;
  points: StatPoint[];
}

/** Nach oben offener Wert (mindestens 0), von dem nur der Name festgelegt wird. */
export interface OpenStat {
  id: string;
  name: string;
  kind: "open";
}

export type StatType = IntervalStat | OpenStat;

/** Wöchentliche Veränderung eines Siedlungs-Werts durch ein Gebäude. */
export interface StatEffect {
  /** ID des Stats */
  id: string;
  /** Veränderung (pro Woche bzw. einmalig); negativ senkt den Wert */
  amount: number;
  /** "weekly" (Standard): jede Woche, solange das Gebäude fertig ist; "once": einmalig bei Fertigstellung, dauerhaft. */
  mode?: StatEffectMode;
}

export type StatEffectMode = "weekly" | "once";

/** Aktion eines Spielers an einem bestehenden Gebäude; wird von der aktiven SL ausgeführt. */
export interface BuildingActionMessage {
  action: "rename" | "remove";
  sceneId: string;
  buildingId: string;
  /** nur bei "rename" */
  name?: string;
  userId: string;
}

/** Spieler (oder SL) wählt eine andere Ausprägung eines Gesetzes; die aktive SL prüft und führt aus. */
export interface LawChangeMessage {
  action: "law";
  sceneId: string;
  lawId: string;
  optionId: string;
  userId: string;
}

export type CompareOp = "<" | "<=" | ">" | ">=" | "==" | "!=";

/** Bedingung eines Triggers: Vergleich eines Werts, Vorrats oder einer Arbeiterart mit einer Zahl. */
export interface TriggerCondition {
  kind: EffectKind;
  id: string;
  op: CompareOp;
  value: number;
}

/**
 * Wirkung eines Triggers. Bei Werten (Stats) ist "weekly" (Standard) eine Änderung des Basiswerts pro Woche,
 * "modifier" ein Zuschlag, solange die Bedingung erfüllt ist. Ressourcen wirken pro Woche, Arbeiter als Zuschlag.
 */
export interface TriggerEntry extends EffectEntry {
  mode?: "weekly" | "modifier";
}

/** Getriggerter Effekt, z. B. "Zufriedenheit unter 30 → Loyalität sinkt um 1 pro Woche". */
export interface Trigger {
  id: string;
  name: string;
  description?: string;
  /** Alle Bedingungen müssen erfüllt sein (UND) */
  conditions: TriggerCondition[];
  entries: TriggerEntry[];
  /** Für Spieler nur sichtbar, wenn nicht versteckt */
  hidden?: boolean;
  /** Voreinstellung in Siedlungen ohne eigene Schaltung (Standard: an) */
  defaultOn?: boolean;
}
