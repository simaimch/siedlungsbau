import { ID } from "./constants";
import { DEFAULT_DEFINITIONS, TERRAIN } from "./data";
import { SETTING_DEFINITIONS, syncTerrain } from "./definitions";
import { TerrainApp } from "./terrain-app";
import { TerrainBrush } from "./terrain-brush";
import { LawsApp } from "./laws-app";
import { SETTING_LAW_COOLDOWN, SETTING_LAW_CHANGES, SETTING_LAW_EFFECTS_VISIBLE } from "./laws-service";
import { getType } from "./store";
import { PaletteApp, DefinitionsApp, SettlementApp, refreshApp } from "./apps";
import { DataTransferApp } from "./transfer-app";
import { redraw } from "./render";
import { SETTING_ROAD_GAP } from "./roads-store";
import { DEFAULT_ROAD_GAP, MAX_ROAD_GAP } from "./roads";
import { Placement } from "./placement";
import { SETTING_MAX_CHECKS, DEFAULT_MAX_CHECKS, MAX_CHECKS_LIMIT } from "./shortage";

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

  // Einstellungen zu Gesetzen (erscheinen im Reiter des Moduls)
  const refreshLaws = (): void => {
    refreshApp(LawsApp);
    refreshApp(SettlementApp);
  };
  game.settings.register(ID, SETTING_LAW_EFFECTS_VISIBLE, {
    name: "SIEDLUNG.settings.lawEffectsVisible.name",
    hint: "SIEDLUNG.settings.lawEffectsVisible.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    default: true,
    onChange: refreshLaws
  });
  game.settings.register(ID, SETTING_LAW_CHANGES, {
    name: "SIEDLUNG.settings.lawChangesPerWeek.name",
    hint: "SIEDLUNG.settings.lawChangesPerWeek.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: true, integer: true, min: 0, initial: 1 }),
    default: 1,
    onChange: refreshLaws
  });
  game.settings.register(ID, SETTING_LAW_COOLDOWN, {
    name: "SIEDLUNG.settings.lawCooldownWeeks.name",
    hint: "SIEDLUNG.settings.lawCooldownWeeks.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: true, integer: true, min: 0, initial: 4 }),
    default: 4,
    onChange: refreshLaws
  });

  // Abstand der Wege zum Feldrand (Prozent der Feldbreite); Verbindungen zu Nachbarn schließen die Lücke
  game.settings.register(ID, SETTING_ROAD_GAP, {
    name: "SIEDLUNG.settings.roadGap.name",
    hint: "SIEDLUNG.settings.roadGap.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: true, integer: true, min: 0, max: MAX_ROAD_GAP, initial: DEFAULT_ROAD_GAP }),
    default: DEFAULT_ROAD_GAP,
    onChange: () => redraw()
  });

  // Wie oft bei Engpässen erneut geprüft wird, wenn das Abschalten von Gebäuden neue Engpässe erzeugt (Kette)
  game.settings.register(ID, SETTING_MAX_CHECKS, {
    name: "SIEDLUNG.settings.shortageChecks.name",
    hint: "SIEDLUNG.settings.shortageChecks.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: true, integer: true, min: 1, max: MAX_CHECKS_LIMIT, initial: DEFAULT_MAX_CHECKS }),
    default: DEFAULT_MAX_CHECKS,
    onChange: () => {
      refreshApp(SettlementApp);
      redraw();
    }
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
  refreshApp(LawsApp);
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
