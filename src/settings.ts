import { ID } from "./constants";
import { DEFAULT_DEFINITIONS, TERRAIN } from "./data";
import { SETTING_DEFINITIONS, syncTerrain } from "./definitions";
import { TerrainApp } from "./terrain-app";
import { TerrainBrush } from "./terrain-brush";
import { getType } from "./store";
import { PaletteApp, DefinitionsApp, SettlementApp, refreshApp } from "./apps";
import { DataTransferApp } from "./transfer-app";
import { redraw } from "./render";
import { Placement } from "./placement";

export function registerSettings(): void {
  // Geländearten der SL ins globale TERRAIN übernehmen, sobald die Einstellungen lesbar sind
  Hooks.once("ready", syncTerrain);
  game.settings.register(ID, SETTING_DEFINITIONS, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField(),
    default: foundry.utils.deepClone(DEFAULT_DEFINITIONS),
    onChange: onDefinitionsChanged
  });

  // Eigener Reiter in den Spieleinstellungen mit Button für Export/Import (nur SL)
  game.settings.registerMenu(ID, "dataTransfer", {
    name: "SIEDLUNG.transfer.menuName",
    label: "SIEDLUNG.transfer.menuLabel",
    hint: "SIEDLUNG.transfer.menuHint",
    icon: "fa-solid fa-file-export",
    type: DataTransferApp,
    restricted: true
  });
}

/** Läuft bei allen Clients, sobald die SL Kategorien oder Gebäude ändert. */
function onDefinitionsChanged(): void {
  syncTerrain();
  if (TerrainBrush.code !== null && !TERRAIN[TerrainBrush.code]) TerrainBrush.stop();
  refreshApp(TerrainApp);
  if (Placement.type) {
    const type = getType(Placement.type.id);
    if (type) Placement.type = type;
    else Placement.stop();
  }
  refreshApp(PaletteApp);
  refreshApp(DefinitionsApp);
  refreshApp(SettlementApp);
  refreshApp(DataTransferApp);
  redraw();
}
