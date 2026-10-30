// Zufällige, organisch wirkende Kartengenerierung (reine Logik ohne Foundry-Abhängigkeiten, daher einzeln testbar).
import type { TerrainData } from "./types";

export type Edge = "north" | "east" | "south" | "west";
export const EDGES: Edge[] = ["north", "east", "south", "west"];

export interface MapGenOptions {
  /** Gelände-Zeichen, das am jeweiligen Rand ein unregelmäßiges Band bildet; "" = keins */
  edges: Record<Edge, string>;
  /** Tritt am jeweiligen Rand ein Fluss in die Karte ein? Er schlängelt sich zur Mitte bzw. zum See oder zu einem anderen Rand. */
  rivers: Record<Edge, boolean>;
  /** See in der Mitte der Karte */
  lake: boolean;
  /** Anteil zufällig verstreuter Felsen (0..1) */
  rockChance: number;
  /** Zufallssaat; null = zufällig */
  seed: number | null;
}

/** Welche Zeichen die Generator-Rollen belegen; fehlende Rollen werden übersprungen. */
export interface Palette {
  grass: string;
  rock?: string;
  water?: string;
  /** tiefes Wasser, sonst Wasser */
  deep?: string;
  shore?: string;
}

export const defaultMapGenOptions = (): MapGenOptions => ({
  edges: { north: "", east: "", south: "", west: "" },
  rivers: { north: false, east: false, south: false, west: false },
  lake: false,
  rockChance: 0.1,
  seed: null
});

/** Prüft gespeicherte Optionen und ergänzt Fehlendes. */
export function normalizeMapGenOptions(raw: unknown): MapGenOptions {
  const out = defaultMapGenOptions();
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, any>;
  for (const e of EDGES) {
    if (typeof r.edges?.[e] === "string") out.edges[e] = r.edges[e].slice(0, 1);
    out.rivers[e] = r.rivers?.[e] === true;
  }
  out.lake = r.lake === true;
  if (typeof r.rockChance === "number" && Number.isFinite(r.rockChance)) out.rockChance = Math.min(0.6, Math.max(0, r.rockChance));
  out.seed = typeof r.seed === "number" && Number.isFinite(r.seed) ? Math.floor(r.seed) : null;
  return out;
}

/** Kleiner, schneller Zufallsgenerator mit Saat. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (u: number): number => (1 - Math.cos(u * Math.PI)) / 2;

/** Glattes 1D-Rauschen in [-1, 1]; ein Stützwert etwa alle `spacing` Felder. */
function noise1D(rnd: () => number, length: number, spacing: number): (x: number) => number {
  const n = Math.max(2, Math.ceil(length / spacing) + 2);
  const knots = Array.from({ length: n }, () => rnd() * 2 - 1);
  return x => {
    const p = Math.max(0, x) / spacing;
    const i = Math.min(n - 2, Math.floor(p));
    return knots[i] + (knots[i + 1] - knots[i]) * smooth(Math.min(1, p - i));
  };
}

/** Periodisches Rauschen auf [0, 1) für Umrisse (See). */
function ringNoise(rnd: () => number, knots: number): (u: number) => number {
  const k = Array.from({ length: knots }, () => rnd() * 2 - 1);
  return u => {
    const p = (((u % 1) + 1) % 1) * knots;
    const i = Math.floor(p);
    return k[i % knots] + (k[(i + 1) % knots] - k[i % knots]) * smooth(p - i);
  };
}

/**
 * Erzeugt eine Karte: Gras mit verstreuten Felsen, unregelmäßige Randbänder, ein See in der Mitte,
 * Flüsse entlang der gewählten Ränder und Ufer um das Wasser. `protectedCells` (z. B. Gebäude) werden zu Gras.
 */
export function generateMap(
  cols: number,
  rows: number,
  options: MapGenOptions,
  palette: Palette,
  protectedCells: Iterable<string> = [],
  edgeDepth = 4
): TerrainData & { seed: number } {
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rnd = mulberry32(seed);
  const cells: string[] = new Array(cols * rows).fill(palette.grass);
  const idx = (x: number, y: number): number => y * cols + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;

  // 1. verstreute Felsen
  if (palette.rock) {
    for (let i = 0; i < cells.length; i++) if (rnd() < options.rockChance) cells[i] = palette.rock;
  }

  // Abbildung (Position entlang des Rands t, Abstand vom Rand d) -> Rasterzelle
  const place: Record<Edge, (t: number, d: number) => [number, number]> = {
    north: (t, d) => [t, d],
    south: (t, d) => [t, rows - 1 - d],
    west: (t, d) => [d, t],
    east: (t, d) => [cols - 1 - d, t]
  };
  const length = (e: Edge): number => (e === "north" || e === "south" ? cols : rows);
  const depthMax = (e: Edge): number => (e === "north" || e === "south" ? rows : cols);

  // 2. unregelmäßige Randbänder
  for (const e of EDGES) {
    const code = options.edges[e];
    if (!code) continue;
    const n = noise1D(rnd, length(e), 6);
    for (let t = 0; t < length(e); t++) {
      const depth = edgeDepth * (0.75 + 0.45 * n(t));
      for (let d = 0; d < depthMax(e) && d < depth + 1; d++) {
        if (d + rnd() * 0.9 >= depth) continue;
        const [x, y] = place[e](t, d);
        if (inside(x, y)) cells[idx(x, y)] = code;
      }
    }
  }

  // 3. See und Flüsse (Wasser überdeckt alles)
  const water = new Uint8Array(cols * rows);
  const hasWater = !!palette.water;
  const setWater = (x: number, y: number, deepCore: boolean): void => {
    if (!inside(x, y)) return;
    water[idx(x, y)] = 1;
    if (palette.deep && cells[idx(x, y)] === palette.deep) return; // tiefes Wasser bleibt tief
    cells[idx(x, y)] = deepCore && palette.deep ? palette.deep : palette.water!;
  };

  let lakeCenter: [number, number] | null = null;
  if (hasWater && options.lake) {
    const cx = cols / 2 + (rnd() - 0.5) * cols * 0.1;
    const cy = rows / 2 + (rnd() - 0.5) * rows * 0.1;
    lakeCenter = [cx, cy];
    const base = Math.min(cols, rows) * (0.16 + rnd() * 0.07);
    const ring = ringNoise(rnd, 8);
    const squash = 0.8 + rnd() * 0.5; // leicht ovale Form
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dx = (x + 0.5 - cx) * squash;
        const dy = (y + 0.5 - cy) / squash;
        const dist = Math.hypot(dx, dy);
        const radius = base * (1 + 0.35 * ring(Math.atan2(dy, dx) / (2 * Math.PI)));
        if (dist <= radius) setWater(x, y, dist <= radius * 0.5);
      }
    }
  }

  // Flüsse: Jeder gewählte Rand bekommt einen Zugang. Mit See führen alle Flüsse zum See; ohne See werden
  // zwei Ränder miteinander verbunden, bei mehreren treffen sich die Flüsse in der Kartenmitte, bei einem
  // schlängelt sich der Fluss als Quellfluss in die Mitte.
  const riverEdges = EDGES.filter(e => options.rivers[e]);
  if (hasWater && riverEdges.length) {
    const entry = (e: Edge): [number, number] => {
      const t = Math.floor(length(e) * (0.25 + rnd() * 0.5));
      return place[e](t, 0);
    };
    const jitter = (amount: number): number => (rnd() - 0.5) * amount;
    const centre: [number, number] = lakeCenter ?? [cols / 2 + jitter(cols * 0.12), rows / 2 + jitter(rows * 0.12)];
    const points = riverEdges.map(entry);

    type Bezier = { p0: [number, number]; c: [number, number]; p1: [number, number]; spring: boolean };
    const curves: Bezier[] = [];
    const sideways = (p0: [number, number], p1: [number, number]): [number, number] => {
      // zufälliger seitlicher Versatz des Kontrollpunkts, damit selbst gerade Verbindungen eine Kurve bekommen
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy) || 1;
      const k = jitter(0.5) * len;
      return [(-dy / len) * k, (dx / len) * k];
    };
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    if (!lakeCenter && riverEdges.length === 2) {
      // eine Verbindung zwischen beiden Rändern, die durch den mittleren Bereich führt
      const [a, b] = points;
      const m = mid(a, b);
      const through: [number, number] = [m[0] + (centre[0] - m[0]) * 0.75, m[1] + (centre[1] - m[1]) * 0.75];
      curves.push({ p0: a, p1: b, c: [2 * through[0] - m[0], 2 * through[1] - m[1]], spring: false });
    } else {
      for (const p of points) {
        const m = mid(p, centre);
        const off = sideways(p, centre);
        curves.push({ p0: p, p1: centre, c: [m[0] + off[0], m[1] + off[1]], spring: !lakeCenter && riverEdges.length === 1 });
      }
    }

    for (const cv of curves) {
      const len = Math.hypot(cv.p1[0] - cv.p0[0], cv.p1[1] - cv.p0[1]);
      const big = noise1D(rnd, 1, 0.22);
      const small = noise1D(rnd, 1, 0.08);
      const nw = noise1D(rnd, 1, 0.15);
      const bez = (s: number): [number, number] => {
        const u = 1 - s;
        return [u * u * cv.p0[0] + 2 * u * s * cv.c[0] + s * s * cv.p1[0], u * u * cv.p0[1] + 2 * u * s * cv.c[1] + s * s * cv.p1[1]];
      };
      const steps = Math.max(8, Math.ceil(len / 0.35));
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const [bx, by] = bez(s);
        const [ax, ay] = bez(Math.max(0, s - 0.01));
        const [cx2, cy2] = bez(Math.min(1, s + 0.01));
        const tl = Math.hypot(cx2 - ax, cy2 - ay) || 1;
        // seitliches Schlängeln; an den Enden klingt es ab, damit der Fluss am Rand ansetzt
        const envelope = Math.sin(Math.PI * s) ** 0.7;
        const wiggle = (big(s) * Math.max(2, len * 0.09) + small(s) * 0.9) * envelope;
        const x = bx + (-(cy2 - ay) / tl) * wiggle;
        const y = by + ((cx2 - ax) / tl) * wiggle;
        let half = 1.3 + 0.5 * nw(s);
        if (cv.spring) half *= Math.max(0.6, Math.min(1, (1 - s) / 0.3));
        else if (lakeCenter) half *= 1 + 0.25 * s;
        const r = Math.ceil(half) + 1;
        const deepCore = half >= 1.4;
        for (let yy = Math.floor(y) - r; yy <= Math.floor(y) + r; yy++) {
          for (let xx = Math.floor(x) - r; xx <= Math.floor(x) + r; xx++) {
            const dist = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
            if (dist <= half) setWater(xx, yy, deepCore && dist <= half * 0.45);
          }
        }
      }
    }
  }

  // 4. Ufer: ein Feld um jedes Gewässer, ein zweites Feld nur stellenweise
  if (hasWater && palette.shore) {
    const near = (x: number, y: number, test: (i: number) => boolean, diagonal: boolean): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) continue;
          if (inside(x + dx, y + dy) && test(idx(x + dx, y + dy))) return true;
        }
      }
      return false;
    };
    const shore = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!water[idx(x, y)] && near(x, y, i => water[i] === 1, true)) shore[idx(x, y)] = 1;
    }
    const second: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!water[idx(x, y)] && !shore[idx(x, y)] && near(x, y, i => shore[i] === 1, false) && rnd() < 0.35) second.push(idx(x, y));
    }
    for (let i = 0; i < shore.length; i++) if (shore[i]) cells[i] = palette.shore;
    for (const i of second) cells[i] = palette.shore;
  }

  // 5. geschützte Felder (bestehende Gebäude) bleiben bebaubar
  for (const key of protectedCells) {
    const [x, y] = key.split(",").map(Number);
    if (inside(x, y)) cells[idx(x, y)] = palette.grass;
  }

  return { cols, rows, cells: cells.join(""), seed };
}
