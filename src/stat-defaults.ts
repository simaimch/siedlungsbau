import type { StatPoint, StatType } from "./types";

// Standard-Stats (Platzhalter, vom SL im Editor änderbar).
const scale = (names: string[], colors: string[]): StatPoint[] =>
  names.map((name, i) => ({ value: i * 25, name, color: colors[i] }));

const QUALITY = ["#c0392b", "#e67e22", "#f1c40f", "#8bc34a", "#2ecc71"];

export const DEFAULT_STATS: StatType[] = [
  { id: "morale", name: "Moral", kind: "interval", min: 0, max: 100, points: scale(["Meuternd", "Niedergeschlagen", "Mäßig", "Gut", "Hervorragend"], QUALITY) },
  { id: "loyalty", name: "Loyalität", kind: "interval", min: 0, max: 100, points: scale(["Feindselig", "Misstrauisch", "Neutral", "Treu", "Ergeben"], QUALITY) },
  {
    id: "prosperity",
    name: "Wohlstand",
    kind: "interval",
    min: 0,
    max: 100,
    points: scale(["Verarmt", "Arm", "Bescheiden", "Wohlhabend", "Reich"], ["#7f6a4f", "#a98f68", "#d4b366", "#e0b83a", "#f5d44a"])
  },
  { id: "adventurers", name: "Rekrutierbare Abenteurer pro Woche", kind: "open" }
];
