import { ID } from "./constants";
import { DEFAULT_TERRAIN } from "./data";
import { getDefinitions } from "./definitions";
import { isSettlementScene } from "./store";
import { prepareImport } from "./scene-transfer";
import type { PreparedImport } from "./scene-transfer";
import { exportCurrentScene, importAsNewScene, importIntoCurrentScene } from "./scene-transfer-service";
import { escapeHTML } from "./util";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      fallback?.focus();
      fallback?.select();
      return document.execCommand?.("copy") ?? false;
    }
  }
}

const slug = (s: string): string => s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "siedlung";

function summaryHTML(prep: PreparedImport, target: "new" | "current", withDefinitions: boolean): string {
  const d = prep.data!;
  const lines = [
    t("SIEDLUNG.admin.summaryScene", { name: escapeHTML(d.name), cols: d.terrain.cols, rows: d.terrain.rows }),
    t("SIEDLUNG.admin.summaryContent", { week: d.settlement.week, buildings: d.buildings.length })
  ];
  if (withDefinitions && prep.mergedDefinitions) lines.push(t("SIEDLUNG.admin.summaryDefinitions"));
  const c = prep.cleanup;
  const notes: string[] = [];
  if (c.removedBuildings.length) notes.push(t("SIEDLUNG.admin.cleanupBuildings", { names: c.removedBuildings.map(escapeHTML).join(", ") }));
  if (c.entries > 0) notes.push(t("SIEDLUNG.admin.cleanupEntries", { count: c.entries }));
  if (c.terrainCells > 0) notes.push(t("SIEDLUNG.admin.cleanupTerrain", { count: c.terrainCells }));
  return (
    `<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>` +
    (notes.length ? `<p>${t("SIEDLUNG.admin.cleanupNote")}</p><ul>${notes.map(l => `<li>${l}</li>`).join("")}</ul>` : "") +
    (target === "current" ? `<p><strong>${t("SIEDLUNG.admin.replaceWarning")}</strong></p>` : "")
  );
}

/** SL: Werkzeug „Siedlung administrieren“ – ganze Siedlungsszenen als JSON exportieren und importieren. */
export class SceneAdminApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-scene-admin`,
    classes: [ID],
    window: { title: "SIEDLUNG.admin.title", icon: "fa-solid fa-screwdriver-wrench", resizable: true },
    position: { width: 580, height: 720 },
    actions: {
      copyExport: SceneAdminApp.#onCopy,
      saveExport: SceneAdminApp.#onSave,
      pickFile: SceneAdminApp.#onPickFile,
      runImport: SceneAdminApp.#onImport
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/scene-admin.hbs`, scrollable: [""] }
  };

  _importText = "";
  _target: "new" | "current" = "new";
  _exportDefs = false;
  _importDefs = true;

  async _prepareContext(): Promise<object> {
    const isSettlement = isSettlementScene();
    return {
      isSettlement,
      exportJson: isSettlement ? (exportCurrentScene(this._exportDefs) ?? "") : "",
      exportDefs: this._exportDefs,
      importJson: this._importText,
      importDefs: this._importDefs,
      targetNew: this._target === "new" || !isSettlement,
      targetCurrent: this._target === "current" && isSettlement,
      canReplace: isSettlement,
      sceneName: canvas.scene?.name ?? ""
    };
  }

  _onRender(): void {
    const el = this.element as HTMLElement;
    const input = el.querySelector("textarea[name=importJson]") as HTMLTextAreaElement | null;
    input?.addEventListener("input", () => {
      this._importText = input.value;
    });
    el.querySelector("input[name=exportDefs]")?.addEventListener("change", ev => {
      this._exportDefs = (ev.target as HTMLInputElement).checked;
      void this.render();
    });
    el.querySelector("input[name=importDefs]")?.addEventListener("change", ev => {
      this._importDefs = (ev.target as HTMLInputElement).checked;
    });
    for (const radio of el.querySelectorAll("input[name=target]")) {
      radio.addEventListener("change", ev => {
        this._target = (ev.target as HTMLInputElement).value === "current" ? "current" : "new";
      });
    }
    const file = el.querySelector("input[name=importFile]") as HTMLInputElement | null;
    file?.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      this._importText = await f.text();
      void this.render();
    });
  }

  static async #onCopy(this: SceneAdminApp): Promise<void> {
    const field = this.element.querySelector("textarea[name=exportJson]") as HTMLTextAreaElement | null;
    const json = exportCurrentScene(this._exportDefs);
    if (!json) return;
    if (await copyText(json, field)) ui.notifications.info(t("SIEDLUNG.admin.copied"));
    else ui.notifications.warn(t("SIEDLUNG.transfer.copyFailed"));
  }

  static #onSave(this: SceneAdminApp): void {
    const json = exportCurrentScene(this._exportDefs);
    if (!json) return;
    foundry.utils.saveDataToFile(json, "application/json", `siedlung-${slug(canvas.scene?.name ?? "")}.json`);
  }

  static #onPickFile(this: SceneAdminApp): void {
    (this.element.querySelector("input[name=importFile]") as HTMLInputElement | null)?.click();
  }

  static async #onImport(this: SceneAdminApp): Promise<void> {
    if (!game.user.isGM) return;
    const input = this.element.querySelector("textarea[name=importJson]") as HTMLTextAreaElement | null;
    if (input) this._importText = input.value;
    if (!this._importText.trim()) return void ui.notifications.warn(t("SIEDLUNG.transfer.empty"));
    const target = this._target === "current" && isSettlementScene() ? "current" : "new";

    const prep = prepareImport(this._importText, getDefinitions(), this._importDefs, DEFAULT_TERRAIN);
    if (!prep.data) {
      const shown = prep.errors.slice(0, 15).map(e => `<li>${escapeHTML(e)}</li>`).join("");
      const more = prep.errors.length > 15 ? `<li>… (+${prep.errors.length - 15})</li>` : "";
      await foundry.applications.api.DialogV2.prompt({
        window: { title: t("SIEDLUNG.transfer.errorsTitle") },
        content: `<p>${t("SIEDLUNG.transfer.errorsIntro")}</p><ul>${shown}${more}</ul>`,
        ok: { label: "OK" },
        rejectClose: false
      });
      return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: t(target === "current" ? "SIEDLUNG.admin.confirmReplaceTitle" : "SIEDLUNG.admin.confirmNewTitle") },
      content: summaryHTML(prep, target, this._importDefs),
      rejectClose: false
    });
    if (!confirmed) return;

    if (target === "current") await importIntoCurrentScene(prep.data, prep.mergedDefinitions);
    else await importAsNewScene(prep.data, prep.mergedDefinitions);
    this._importText = "";
    ui.notifications.info(t("SIEDLUNG.admin.done"));
    void this.render();
  }
}

export function openSceneAdmin(): void {
  const existing = foundry.applications.instances.get(SceneAdminApp.DEFAULT_OPTIONS.id);
  if (existing) void existing.bringToFront();
  else void new SceneAdminApp().render({ force: true });
}
