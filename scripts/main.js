import { ID } from "./constants.js";
import { PaletteApp, OrdersApp, toggleApp, refreshOrders, closeApps } from "./apps.js";
import { initRender, teardownRender, redraw } from "./render.js";
import { Placement } from "./placement.js";
import { registerSocket, createSettlementScene, toggleSettlementScene } from "./service.js";
import { isSettlementScene } from "./store.js";

function refreshControls() {
  // Ab v13: Neuaufbau der Steuerung über render() mit der zu aktivierenden Control-Gruppe.
  ui.controls?.render({ controls: "tokens" });
}

Hooks.on("getSceneControlButtons", controls => {
  const active = isSettlementScene();
  const isGM = game.user.isGM;
  controls.siedlung = {
    name: "siedlung",
    title: "SIEDLUNG.title",
    icon: "fa-solid fa-city",
    order: Object.keys(controls).length,
    // Spieler sehen die Gruppe nur in Siedlungsszenen, die SL immer (zum Markieren/Erstellen).
    visible: active || isGM,
    activeTool: active ? "build" : "info",
    tools: {
      build: {
        name: "build",
        title: "SIEDLUNG.tools.build",
        icon: "fa-solid fa-hammer",
        order: 0,
        button: true,
        visible: active,
        onChange: () => { if (isSettlementScene()) toggleApp(PaletteApp); }
      },
      orders: {
        name: "orders",
        title: "SIEDLUNG.tools.orders",
        icon: "fa-solid fa-list-check",
        order: 1,
        button: true,
        visible: active,
        onChange: () => { if (isSettlementScene()) toggleApp(OrdersApp); }
      },
      info: {
        name: "info",
        title: "SIEDLUNG.tools.info",
        icon: "fa-solid fa-circle-info",
        order: 2,
        button: true,
        visible: !active && isGM,
        onChange: () => ui.notifications.info(game.i18n.localize("SIEDLUNG.notes.notSettlement"))
      },
      toggleScene: {
        name: "toggleScene",
        title: active ? "SIEDLUNG.tools.unmarkScene" : "SIEDLUNG.tools.markScene",
        icon: "fa-solid fa-flag",
        order: 3,
        button: true,
        visible: isGM,
        onChange: () => toggleSettlementScene()
      },
      createScene: {
        name: "createScene",
        title: "SIEDLUNG.tools.createScene",
        icon: "fa-solid fa-map",
        order: 4,
        button: true,
        visible: isGM,
        onChange: () => createSettlementScene()
      }
    }
  };
});

Hooks.once("ready", () => {
  registerSocket();
});

Hooks.on("canvasReady", () => {
  initRender();
  if (!isSettlementScene()) closeApps();
  refreshControls();
});

Hooks.on("canvasTearDown", () => {
  Placement.stop();
  teardownRender();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  const flags = changes.flags?.[ID];
  if (flags === undefined) return;
  if (typeof flags === "object" && "enabled" in flags) {
    refreshControls();
    if (!isSettlementScene(scene)) { Placement.stop(); closeApps(); }
  }
  redraw();
  refreshOrders();
});
