import { ID } from "./constants";
import { escapeHTML } from "./util";
import { TERRAIN, DEFAULT_TERRAIN } from "./data";
import { getBuildings, getTerrain, isSettlementScene } from "./store";
import { EDGES, defaultMapGenOptions, generateMap, normalizeMapGenOptions } from "./mapgen";
import type { MapGenOptions, Palette } from "./mapgen";

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Welche Geländearten der Generator für Gras, Fels, Wasser, tiefes Wasser und Ufer benutzt (nur wenn vorhanden). */
export function paletteFromTerrain(): Palette {
  const has = (code: string): string | undefined => (TERRAIN[code] ? code : undefined);
  return { grass: DEFAULT_TERRAIN, rock: has("r"), water: has("s"), deep: has("t"), shore: has("u") };
}

/** Saat aus der Eingabe: Zahl direkt, anderer Text über einen Hash; leer = zufällig. */
function parseSeed(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return Math.abs(Number(s)) % 2 ** 31;
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2 ** 31;
}

/** Dialog mit den Optionen der Kartengenerierung; null bei Abbruch. */
export async function askMapOptions(initial: MapGenOptions, titleKey: string, okKey: string): Promise<MapGenOptions | null> {
  const terrainOptions = (selected: string): string =>
    `<option value="">${t("SIEDLUNG.mapgen.none")}</option>` +
    Object.entries(TERRAIN)
      .filter(([code]) => code !== DEFAULT_TERRAIN)
      .map(([code, def]) => `<option value="${code}" ${code === selected ? "selected" : ""}>${escapeHTML(def.label)} (${code})</option>`)
      .join("");
  const rows = EDGES.map(
    e => `<div class="form-group">
      <label>${t(`SIEDLUNG.mapgen.edges.${e}`)}</label>
      <select name="edge-${e}">${terrainOptions(initial.edges[e])}</select>
      <label class="river"><input type="checkbox" name="river-${e}" ${initial.rivers[e] ? "checked" : ""}> ${t("SIEDLUNG.mapgen.river")}</label>
    </div>`
  ).join("");
  const content = `<div class="siedlung-mapgen">
    <p class="hint">${t("SIEDLUNG.mapgen.hint")}</p>
    ${rows}
    <div class="form-group"><label>${t("SIEDLUNG.mapgen.lake")}</label><input type="checkbox" name="lake" ${initial.lake ? "checked" : ""}></div>
    <div class="form-group"><label>${t("SIEDLUNG.mapgen.rocks")}</label><input type="number" name="rocks" min="0" max="60" step="1" value="${Math.round(initial.rockChance * 100)}"></div>
    <div class="form-group"><label>${t("SIEDLUNG.mapgen.seed")}</label><input type="text" name="seed" value="${initial.seed ?? ""}" placeholder="${t("SIEDLUNG.mapgen.seedPlaceholder")}"></div>
  </div>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: t(titleKey) },
    content,
    ok: {
      label: t(okKey),
      callback: (_event: Event, button: any) => {
        const f = button.form.elements;
        const opts = defaultMapGenOptions();
        for (const e of EDGES) {
          opts.edges[e] = f.namedItem(`edge-${e}`).value;
          opts.rivers[e] = f.namedItem(`river-${e}`).checked;
        }
        opts.lake = f.namedItem("lake").checked;
        opts.rockChance = Math.min(0.6, Math.max(0, (Number(f.namedItem("rocks").value) || 0) / 100));
        opts.seed = parseSeed(f.namedItem("seed").value);
        return normalizeMapGenOptions(opts);
      }
    },
    rejectClose: false
  });
}

/** Generiert Gelände und Optionen für eine neue Szene; null bei Abbruch des Dialogs. */
export async function generateNewMap(cols: number, rows: number): Promise<{ terrain: { cols: number; rows: number; cells: string }; mapgen: MapGenOptions } | null> {
  const opts = await askMapOptions(defaultMapGenOptions(), "SIEDLUNG.mapgen.createTitle", "SIEDLUNG.scene.create");
  if (!opts) return null;
  const palette = paletteFromTerrain();
  if (!palette.water && (opts.lake || Object.values(opts.rivers).some(Boolean))) ui.notifications.warn(t("SIEDLUNG.mapgen.noWater"));
  const map = generateMap(cols, rows, opts, palette);
  return { terrain: { cols: map.cols, rows: map.rows, cells: map.cells }, mapgen: { ...opts, seed: map.seed } };
}

/**
 * SL: würfelt die Karte der aktuellen Siedlungsszene neu, mit den zuletzt gewählten Optionen als Vorgabe.
 * Felder mit Gebäuden bleiben bebaubar (Gras).
 */
export async function regenerateMap(): Promise<void> {
  const scene = canvas.scene;
  if (!game.user.isGM || !scene || !isSettlementScene(scene)) return;
  const s: number = scene.grid.size;
  const old = getTerrain(scene);
  const cols = old?.cols ?? Math.round(scene.dimensions.sceneWidth / s);
  const rows = old?.rows ?? Math.round(scene.dimensions.sceneHeight / s);
  const initial = normalizeMapGenOptions(scene.getFlag(ID, "mapgen"));
  initial.seed = null; // neuer Zufall
  const opts = await askMapOptions(initial, "SIEDLUNG.mapgen.regenerateTitle", "SIEDLUNG.mapgen.regenerate");
  if (!opts) return;
  const palette = paletteFromTerrain();
  if (!palette.water && (opts.lake || Object.values(opts.rivers).some(Boolean))) ui.notifications.warn(t("SIEDLUNG.mapgen.noWater"));
  const protectedCells = getBuildings(scene).flatMap(b => b.cells.map(([x, y]) => `${x},${y}`));
  const map = generateMap(cols, rows, opts, palette, protectedCells);
  await scene.update({ flags: { [ID]: { terrain: { cols, rows, cells: map.cells }, mapgen: { ...opts, seed: map.seed } } } });
  ui.notifications.info(t("SIEDLUNG.mapgen.regenerated"));
}
