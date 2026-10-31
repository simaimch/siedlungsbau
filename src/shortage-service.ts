import { ID } from "./constants";
import { getBuildings, isSettlementScene } from "./store";
import { evaluateShortages } from "./settlement";
import { getAsset, SETTING_DEFINITIONS } from "./definitions";
import { SETTING_MAX_CHECKS } from "./shortage";

/** Schreibt Änderungen nacheinander (mehrere Auslöser kurz hintereinander). */
let queue: Promise<void> = Promise.resolve();

async function syncScene(scene: any): Promise<void> {
  if (game.user !== game.users.activeGM || !scene || !isSettlementScene(scene)) return;
  const { buildings } = evaluateShortages(scene);
  const current = getBuildings(scene);
  const changed = current.length !== buildings.length || current.some((b, i) => !!b.autoDisabled !== !!buildings[i].autoDisabled);
  if (changed) await scene.setFlag(ID, "buildings", buildings);
}

/** Aktive SL: gleicht die vorübergehend abgeschalteten Gebäude mit der aktuellen Bilanz ab (eine Szene oder alle Siedlungsszenen). */
export function syncShortages(scene?: any): void {
  queue = queue
    .then(async () => {
      if (scene) await syncScene(scene);
      else for (const s of game.scenes) await syncScene(s);
    })
    .catch(err => console.warn(`${ID} | Engpass-Prüfung fehlgeschlagen`, err));
}

export interface ShortageSummary {
  /** Engpässe: Name, Fehlbetrag, Art der Behebung */
  items: { name: string; deficit: number; resolved: boolean }[];
  /** Anzahl vorübergehend abgeschalteter Gebäude */
  switchedOff: number;
  checks: number;
  maxChecks: number;
  exceeded: boolean;
}

/** Zusammenfassung für die Anzeige. */
export function shortageSummary(scene: any = canvas?.scene): ShortageSummary {
  const empty: ShortageSummary = { items: [], switchedOff: 0, checks: 0, maxChecks: 0, exceeded: false };
  if (!scene) return empty;
  try {
    const { result } = evaluateShortages(scene);
    const items = Object.entries(result.triggered).map(([key, deficit]) => {
      const kind = key.slice(0, key.indexOf(":")) as "resource" | "worker";
      const id = key.slice(key.indexOf(":") + 1);
      return { name: getAsset(kind, id)?.name ?? id, deficit, resolved: !result.unresolved.includes(key) };
    });
    return { items, switchedOff: result.autoDisabled.size, checks: result.checks, maxChecks: Number(game.settings.get(ID, SETTING_MAX_CHECKS)), exceeded: result.exceeded };
  } catch (err) {
    console.warn(`${ID} | Engpass-Zusammenfassung fehlgeschlagen`, err);
    return empty;
  }
}

// Immer wenn sich die Wochenbilanz ändern kann: Gebäude, Vorräte/Effekte/Gesetze der Siedlung, Definitionen, Einstellung.
Hooks.on("updateScene", (scene: any, changes: any) => {
  const flags = changes.flags?.[ID];
  if (!flags || typeof flags !== "object") return;
  if ("buildings" in flags || "settlement" in flags || "enabled" in flags) syncShortages(scene);
});
Hooks.on("updateSetting", (setting: any) => {
  if (setting.key === `${ID}.${SETTING_DEFINITIONS}` || setting.key === `${ID}.${SETTING_MAX_CHECKS}`) syncShortages();
});
Hooks.once("ready", () => syncShortages());
