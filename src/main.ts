import { ID } from "./constants";
import { PaletteApp, OrdersApp, DefinitionsApp, toggleApp, refreshOrders, closeApps, SettlementApp, refreshApp } from "./apps";
import { registerSettings } from "./settings";
import { initRender, teardownRender, redraw } from "./render";
import { Placement } from "./placement";
import { registerSocket, createSettlementScene, toggleSettlementScene } from "./service";
import { isSettlementScene } from "./store";

function refreshControls(): void {
  // Ab v13: Neuaufbau der Steuerung über render() mit der zu aktivierenden Control-Gruppe.
  ui.controls?.render({ controls: "tokens" });
}

/**
 * Foundry ruft onChange der Werkzeuge nicht nur beim Klick auf, sondern auch beim (De-)Aktivieren der Gruppe
 * (z. B. wenn ein anderes Werkzeug angeklickt wird). Wir reagieren nur auf einen echten Klick auf genau diesen Button.
 */
function isToolClick(event: Event | undefined, active: boolean | undefined, tool: string): boolean {
  if (active === false) return false;
  const root = ui.controls?.element as HTMLElement | undefined;
  if (!root?.querySelector("[data-tool]")) return true; // Markup unbekannt: nicht filtern
  const button = (event?.target as HTMLElement | null)?.closest?.("[data-tool]") as HTMLElement | null;
  return button?.dataset.tool === tool;
}

const onClick = (tool: string, handler: () => void) => (event?: Event, active?: boolean): void => {
  if (isToolClick(event, active, tool)) handler();
};

Hooks.on("getSceneControlButtons", (controls: Record<string, any>) => {
  const active = isSettlementScene();
  const isGM: boolean = game.user.isGM;
  controls.siedlung = {
    name: "siedlung",
    title: "SIEDLUNG.title",
    icon: "fa-solid fa-city",
    order: Object.keys(controls).length,
    // Spieler sehen die Gruppe nur in Siedlungsszenen, die SL immer (zum Markieren/Erstellen).
    visible: active || isGM,
    activeTool: "select",
    tools: {
      // Neutrales Standardwerkzeug: Die Gruppe hat damit immer ein aktives Werkzeug, das nichts auslöst.
      // Die Button-Werkzeuge (Bauen, Aufträge, ...) feuern so bei jedem Klick.
      select: {
        name: "select",
        title: "SIEDLUNG.tools.select",
        icon: "fa-solid fa-arrow-pointer",
        order: 0,
        visible: true
      },
      build: {
        name: "build",
        title: "SIEDLUNG.tools.build",
        icon: "fa-solid fa-hammer",
        order: 0,
        button: true,
        visible: active,
        onChange: onClick("build", () => { if (isSettlementScene()) toggleApp(PaletteApp); })
      },
      orders: {
        name: "orders",
        title: "SIEDLUNG.tools.orders",
        icon: "fa-solid fa-list-check",
        order: 1,
        button: true,
        visible: active,
        onChange: onClick("orders", () => { if (isSettlementScene()) toggleApp(OrdersApp); })
      },
      settlement: {
        name: "settlement",
        title: "SIEDLUNG.tools.settlement",
        icon: "fa-solid fa-warehouse",
        order: 3,
        button: true,
        visible: active,
        onChange: onClick("settlement", () => { if (isSettlementScene()) toggleApp(SettlementApp); })
      },
      editor: {
        name: "editor",
        title: "SIEDLUNG.tools.editor",
        icon: "fa-solid fa-pen-ruler",
        order: 2,
        button: true,
        visible: isGM,
        onChange: onClick("editor", () => { if (game.user.isGM) toggleApp(DefinitionsApp); })
      },
      info: {
        name: "info",
        title: "SIEDLUNG.tools.info",
        icon: "fa-solid fa-circle-info",
        order: 3,
        button: true,
        visible: !active && isGM,
        onChange: onClick("info", () => ui.notifications.info(game.i18n.localize("SIEDLUNG.notes.notSettlement")))
      },
      toggleScene: {
        name: "toggleScene",
        title: active ? "SIEDLUNG.tools.unmarkScene" : "SIEDLUNG.tools.markScene",
        icon: "fa-solid fa-flag",
        order: 4,
        button: true,
        visible: isGM,
        onChange: onClick("toggleScene", () => { void toggleSettlementScene(); })
      },
      createScene: {
        name: "createScene",
        title: "SIEDLUNG.tools.createScene",
        icon: "fa-solid fa-map",
        order: 5,
        button: true,
        visible: isGM,
        onChange: onClick("createScene", () => { void createSettlementScene(); })
      }
    }
  };
});

Hooks.once("init", () => {
  registerSettings();
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

Hooks.on("updateScene", (scene: any, changes: any) => {
  if (scene.id !== canvas.scene?.id) return;
  const flags = changes.flags?.[ID];
  if (flags === undefined) return;
  if (typeof flags === "object" && "enabled" in flags) {
    refreshControls();
    if (!isSettlementScene(scene)) {
      Placement.stop();
      closeApps();
    }
  }
  redraw();
  refreshOrders();
  refreshApp(SettlementApp);
});
