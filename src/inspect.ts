import { getBuildings, isSettlementScene } from "./store";
import { Placement } from "./placement";
import { TerrainBrush } from "./terrain-brush";
import { registerActionSocket } from "./actions";
import { registerLawSocket } from "./laws-service";
import { LawsApp } from "./laws-app";
import { refreshApp } from "./apps";
import { openBuildingInfo, refreshBuildingInfo, closeBuildingInfo } from "./info-app";
import { ID } from "./constants";

/**
 * Auswahl-Modus: Ein Linksklick (ohne Ziehen) auf ein Gebäude öffnet dessen Info-Fenster.
 * Aktiv nur in Siedlungsszenen, solange die Siedlungs-Steuerung gewählt ist und nichts platziert wird.
 */
let down: { x: number; y: number } | null = null;
let stage: any = null;

function active(): boolean {
  return isSettlementScene() && !Placement.type && !Placement.busy && TerrainBrush.code === null && ui.controls?.control?.name === "siedlung";
}

const onDown = (event: any): void => {
  down = event.button === 0 ? { x: event.global.x, y: event.global.y } : null;
};

const onUp = (event: any): void => {
  if (event.button !== 0 || !down) return;
  const moved = Math.hypot(event.global.x - down.x, event.global.y - down.y);
  down = null;
  if (moved >= 5 || !active()) return;
  const pos = event.getLocalPosition(canvas.stage);
  const s: number = canvas.scene.grid.size;
  const cx = Math.floor(pos.x / s);
  const cy = Math.floor(pos.y / s);
  const hit = getBuildings().find(b => b.cells.some(([x, y]) => x === cx && y === cy));
  if (hit) openBuildingInfo(hit.id);
};

Hooks.once("ready", registerActionSocket);
Hooks.once("ready", registerLawSocket);

Hooks.on("canvasReady", () => {
  stage?.off("pointerdown", onDown);
  stage?.off("pointerup", onUp);
  stage = canvas.stage;
  stage.on("pointerdown", onDown);
  stage.on("pointerup", onUp);
  closeBuildingInfo();
});

Hooks.on("updateScene", (scene: any, changes: any) => {
  if (scene.id !== canvas.scene?.id) return;
  const flags = changes.flags?.[ID];
  if (flags === undefined) return;
  if (typeof flags === "object" && "enabled" in flags && !isSettlementScene(scene)) closeBuildingInfo();
  else refreshBuildingInfo();
  refreshApp(LawsApp);
});
