import { ID } from "./constants.js";
import { PaletteApp, OrdersApp, toggleApp, refreshOrders } from "./apps.js";
import { initRender, teardownRender, redraw } from "./render.js";
import { Placement } from "./placement.js";
import { registerSocket, createSettlementScene } from "./service.js";

Hooks.on("getSceneControlButtons", controls => {
  controls.siedlung = {
    name: "siedlung",
    title: "SIEDLUNG.title",
    icon: "fa-solid fa-city",
    order: Object.keys(controls).length,
    visible: true,
    activeTool: "build",
    tools: {
      build: {
        name: "build",
        title: "SIEDLUNG.tools.build",
        icon: "fa-solid fa-hammer",
        order: 0,
        button: true,
        onChange: () => toggleApp(PaletteApp)
      },
      orders: {
        name: "orders",
        title: "SIEDLUNG.tools.orders",
        icon: "fa-solid fa-list-check",
        order: 1,
        button: true,
        onChange: () => toggleApp(OrdersApp)
      },
      createScene: {
        name: "createScene",
        title: "SIEDLUNG.tools.createScene",
        icon: "fa-solid fa-map",
        order: 2,
        button: true,
        visible: game.user.isGM,
        onChange: () => createSettlementScene()
      }
    }
  };
});

Hooks.once("ready", () => {
  registerSocket();
});

Hooks.on("canvasReady", () => initRender());

Hooks.on("canvasTearDown", () => {
  Placement.stop();
  teardownRender();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (changes.flags?.[ID] === undefined) return;
  redraw();
  refreshOrders();
});
