import { ID } from "./constants";
import { getDefinitions, replaceDefinitions } from "./definitions";
import { applyImport, exportDefinitions, findMissing, parseImport, SECTIONS, SECTION_LABELS } from "./transfer";
import type { Cleanup, ImportMode, MissingEntry } from "./transfer";
import { escapeHTML } from "./util";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Kopiert Text in die Zwischenablage; zuerst über Foundry, dann Browser-API, zuletzt über Markieren im Textfeld. */
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

function cleanupHTML(cleanup: Cleanup): string {
  const lines: string[] = [];
  if (cleanup.costEntries > 0) lines.push(t("SIEDLUNG.transfer.cleanupCosts", { count: cleanup.costEntries }));
  if (cleanup.statEffects > 0) lines.push(t("SIEDLUNG.transfer.cleanupEffects", { count: cleanup.statEffects }));
  if (cleanup.lawEntries > 0) lines.push(t("SIEDLUNG.transfer.cleanupLawEntries", { count: cleanup.lawEntries }));
  if (cleanup.removedLaws.length) lines.push(t("SIEDLUNG.transfer.cleanupLaws", { names: cleanup.removedLaws.map(escapeHTML).join(", ") }));
  if (cleanup.removedBuildings.length) {
    lines.push(t("SIEDLUNG.transfer.cleanupBuildings", { names: cleanup.removedBuildings.map(escapeHTML).join(", ") }));
  }
  return lines.length ? `<p>${t("SIEDLUNG.transfer.cleanupNote")}</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : "";
}

function incompleteHTML(missing: MissingEntry[], cleanup: Cleanup): string {
  const list = SECTIONS.map(key => ({ key, names: missing.filter(m => m.section === key).map(m => escapeHTML(m.name)) }))
    .filter(g => g.names.length)
    .map(g => `<li><strong>${SECTION_LABELS[g.key]}:</strong> ${g.names.join(", ")}</li>`)
    .join("");
  return (
    `<p>${t("SIEDLUNG.transfer.incompleteIntro")}</p><ul>${list}</ul>` +
    `<p>${t("SIEDLUNG.transfer.optionsHint")}</p>` +
    cleanupHTML(cleanup) +
    `<p><em>${t("SIEDLUNG.transfer.goldNote")}</em></p>`
  );
}

/** Eigenes Fenster hinter dem Button im Reiter des Moduls in den Spieleinstellungen (nur SL). */
export class DataTransferApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-transfer`,
    classes: [ID],
    window: { title: "SIEDLUNG.transfer.title", icon: "fa-solid fa-file-export", resizable: true },
    position: { width: 560, height: 700 },
    actions: {
      copyExport: DataTransferApp.#onCopy,
      runImport: DataTransferApp.#onImport
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/transfer.hbs`, scrollable: [""] }
  };

  /** Eingefügter Import-Text; bleibt erhalten, wenn das Fenster neu gezeichnet wird. */
  _importText = "";

  async _prepareContext(): Promise<object> {
    return { exportJson: exportDefinitions(getDefinitions()), importJson: this._importText };
  }

  _onRender(): void {
    const input = this.element.querySelector("textarea[name=importJson]") as HTMLTextAreaElement | null;
    input?.addEventListener("input", () => {
      this._importText = input.value;
    });
  }

  static async #onCopy(this: DataTransferApp): Promise<void> {
    const field = this.element.querySelector("textarea[name=exportJson]") as HTMLTextAreaElement | null;
    const ok = await copyText(exportDefinitions(getDefinitions()), field);
    if (ok) ui.notifications.info(t("SIEDLUNG.transfer.copied"));
    else ui.notifications.warn(t("SIEDLUNG.transfer.copyFailed"));
  }

  static async #onImport(this: DataTransferApp): Promise<void> {
    if (!game.user.isGM) return;
    const input = this.element.querySelector("textarea[name=importJson]") as HTMLTextAreaElement | null;
    if (input) this._importText = input.value;
    if (!this._importText.trim()) {
      ui.notifications.warn(t("SIEDLUNG.transfer.empty"));
      return;
    }

    const parsed = parseImport(this._importText);
    if (parsed.errors.length) {
      const shown = parsed.errors.slice(0, 15).map(e => `<li>${escapeHTML(e)}</li>`).join("");
      const more = parsed.errors.length > 15 ? `<li>… (+${parsed.errors.length - 15})</li>` : "";
      await foundry.applications.api.DialogV2.prompt({
        window: { title: t("SIEDLUNG.transfer.errorsTitle") },
        content: `<p>${t("SIEDLUNG.transfer.errorsIntro")}</p><ul>${shown}${more}</ul>`,
        ok: { label: "OK" },
        rejectClose: false
      });
      return;
    }

    const current = getDefinitions();
    const missing = findMissing(current, parsed.data);
    let mode: ImportMode = "replace"; // ohne fehlende Einträge sind beide Varianten gleich
    if (missing.length) {
      const preview = applyImport(current, parsed.data, "replace").cleanup;
      const choice: string | null = await foundry.applications.api.DialogV2.wait({
        window: { title: t("SIEDLUNG.transfer.incompleteTitle") },
        content: incompleteHTML(missing, preview),
        buttons: [
          { action: "cancel", label: t("SIEDLUNG.transfer.cancel"), icon: "fa-solid fa-xmark", default: true },
          { action: "replace", label: t("SIEDLUNG.transfer.replaceLabel"), icon: "fa-solid fa-trash" },
          { action: "merge", label: t("SIEDLUNG.transfer.mergeLabel"), icon: "fa-solid fa-code-merge" }
        ],
        rejectClose: false
      });
      if (choice !== "replace" && choice !== "merge") return;
      mode = choice;
    }

    const { defs, cleanup } = applyImport(current, parsed.data, mode);
    await replaceDefinitions(defs);
    this._importText = "";
    const note =
      cleanup.costEntries || cleanup.removedBuildings.length || cleanup.statEffects || cleanup.lawEntries || cleanup.removedLaws.length
        ? ` ${t("SIEDLUNG.transfer.doneCleanup", { costs: cleanup.costEntries, buildings: cleanup.removedBuildings.length })}`
        : "";
    ui.notifications.info(t("SIEDLUNG.transfer.done") + note);
    void this.render();
  }
}
