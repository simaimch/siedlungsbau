// Reine Logik für Siedlungs-Stats (ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import type { IntervalStat, StatPoint, StatType } from "./types";

const NEUTRAL = "#888888";

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Mischt zwei Farben; t = 0 ergibt a, t = 1 ergibt b. */
export function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Lesbare Textfarbe (schwarz oder weiß) auf dem gegebenen Hintergrund. */
export function contrastText(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#ffffff";
}

export const sortedPoints = (points: StatPoint[]): StatPoint[] => [...points].sort((a, b) => a.value - b.value);

export interface IntervalDisplay {
  /** Name des nächstgelegenen Stützpunkts (leer ohne Stützpunkte) */
  name: string;
  /** Interpolierte Farbe, gewichtet nach der Nähe zu den benachbarten Stützpunkten */
  color: string;
  /** Lage im Intervall (0..1) */
  fraction: number;
}

/**
 * Darstellung eines Werts: Name des nächsten Stützpunkts, Farbe aus den beiden Nachbarpunkten gemischt.
 * Beispiel: gut:0 (grün), schlecht:100 (rot), Wert 60 → "schlecht", 60 % rot und 40 % grün.
 * Außerhalb der äußeren Stützpunkte gilt deren Name und Farbe; bei genau gleichem Abstand gewinnt der höhere Punkt.
 */
export function describeInterval(stat: IntervalStat, value: number): IntervalDisplay {
  const fraction = stat.max > stat.min ? Math.max(0, Math.min(1, (value - stat.min) / (stat.max - stat.min))) : 0;
  const points = sortedPoints(stat.points);
  if (!points.length) return { name: "", color: NEUTRAL, fraction };
  if (value <= points[0].value) return { name: points[0].name, color: points[0].color, fraction };
  const last = points[points.length - 1];
  if (value >= last.value) return { name: last.name, color: last.color, fraction };

  const hiIndex = points.findIndex(p => p.value >= value);
  const hi = points[hiIndex];
  const lo = points[hiIndex - 1];
  if (hi.value === value) return { name: hi.name, color: hi.color, fraction };
  const t = (value - lo.value) / (hi.value - lo.value);
  return { name: t < 0.5 ? lo.name : hi.name, color: lerpColor(lo.color, hi.color, t), fraction };
}

export type StatError = "range" | "pointRange" | "pointName" | "pointColor" | "pointDuplicate";

/** Prüft die Grenzen und Stützpunkte eines Intervall-Stats. */
export function validateInterval(min: number, max: number, points: StatPoint[]): StatError | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return "range";
  const seen = new Set<number>();
  for (const p of points) {
    if (!Number.isFinite(p.value) || p.value < min || p.value > max) return "pointRange";
    if (!p.name.trim()) return "pointName";
    if (!/^#[0-9a-f]{6}$/i.test(p.color)) return "pointColor";
    if (seen.has(p.value)) return "pointDuplicate";
    seen.add(p.value);
  }
  return null;
}

/** Startwert: bei Intervallen die Mitte, bei offenen Werten 0. */
export function defaultStatValue(stat: StatType): number {
  return stat.kind === "interval" ? Math.round(((stat.min + stat.max) / 2) * 100) / 100 : 0;
}

/** Begrenzt einen Wert: Intervall auf [min, max] (2 Nachkommastellen), offene Werte auf ganze Zahlen ≥ 0. */
export function clampStat(stat: StatType, value: number): number {
  if (!Number.isFinite(value)) return defaultStatValue(stat);
  if (stat.kind === "open") return Math.max(0, Math.round(value));
  return Math.round(Math.max(stat.min, Math.min(stat.max, value)) * 100) / 100;
}

/** CSS-Verlauf über das Intervall (für Vorschau-Leisten). */
export function stripGradient(min: number, max: number, points: StatPoint[]): string {
  const sorted = sortedPoints(points);
  if (!sorted.length) return NEUTRAL;
  if (sorted.length === 1 || max <= min) return sorted[0].color;
  const stops = sorted.map(p => `${p.color} ${Math.round(Math.max(0, Math.min(1, (p.value - min) / (max - min))) * 1000) / 10}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
