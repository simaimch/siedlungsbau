import { ID } from "./constants";
import { getStats, saveDefinitions } from "./definitions";
import { stripGradient, validateInterval } from "./stats";
import { sanitizeName } from "./util";
import type { StatKind, StatPoint, StatType } from "./types";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string): string => game.i18n.localize(key);

interface EditorState {
  statId: string | null;
  name: string;
  kind: StatKind;
  min: number;
  max: number;
  points: StatPoint[];
}

/** Bearbeitet oder erstellt einen Siedlungs-Wert: Name, Art, Intervall und Stützpunkte. */
export class StatEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [ID],
    window: { icon: "fa-solid fa-gauge-high" },
    position: { width: 460, height: "auto" },
    actions: {
      addPoint: StatEditorApp.#onAddPoint,
      removePoint: StatEditorApp.#onRemovePoint,
      save: StatEditorApp.#onSave,
      cancel: StatEditorApp.#onCancel
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/stat-editor.hbs` }
  };

  static idFor(statId: string | null): string {
    return `${ID}-stat-editor-${statId ?? "new"}`;
  }

  _state: EditorState;

  constructor(statId: string | null = null) {
    super({ id: StatEditorApp.idFor(statId) });
    const stat = statId ? getStats().find(s => s.id === statId) : undefined;
    this._state = {
      statId: stat ? stat.id : null,
      name: stat?.name ?? "",
      kind: stat?.kind ?? "interval",
      min: stat?.kind === "interval" ? stat.min : 0,
      max: stat?.kind === "interval" ? stat.max : 100,
      points: stat?.kind === "interval" ? stat.points.map(p => ({ ...p })) : []
    };
  }

  get title(): string {
    return t(this._state.statId ? "SIEDLUNG.stats.editStat" : "SIEDLUNG.stats.newStat");
  }

  async _prepareContext(): Promise<object> {
    const { name, kind, min, max, points } = this._state;
    return {
      name,
      isInterval: kind === "interval",
      min,
      max,
      points: points.map(p => ({ ...p })),
      strip: stripGradient(min, max, points)
    };
  }

  _onRender(): void {
    const root = this.element.querySelector(".siedlung-stat-editor");
    root?.addEventListener("change", (event: Event) => {
      this._syncForm();
      if ((event.target as HTMLElement).matches("select[name=kind]")) void this.render();
      else this._updateStrip();
    });
  }

  /** Übernimmt Name, Art, Grenzen und Stützpunkte aus dem Formular in den Zustand. */
  _syncForm(): void {
    const q = <T extends HTMLElement>(sel: string): T | null => this.element.querySelector(sel) as T | null;
    const name = q<HTMLInputElement>("input[name=name]");
    const kind = q<HTMLSelectElement>("select[name=kind]");
    if (name) this._state.name = name.value;
    if (kind) this._state.kind = kind.value === "open" ? "open" : "interval";

    const min = q<HTMLInputElement>("input[name=min]");
    const max = q<HTMLInputElement>("input[name=max]");
    if (min && max) {
      this._state.min = Number(min.value);
      this._state.max = Number(max.value);
      const rows = this.element.querySelectorAll(".point-row") as NodeListOf<HTMLElement>;
      this._state.points = [...rows].map(row => ({
        value: Number((row.querySelector("input[name=pvalue]") as HTMLInputElement).value),
        name: (row.querySelector("input[name=pname]") as HTMLInputElement).value,
        color: (row.querySelector("input[name=pcolor]") as HTMLInputElement).value
      }));
    }
  }

  _updateStrip(): void {
    const strip = this.element.querySelector(".strip") as HTMLElement | null;
    const { min, max, points } = this._state;
    const valid = points.filter(p => Number.isFinite(p.value) && /^#[0-9a-f]{6}$/i.test(p.color));
    if (strip && Number.isFinite(min) && Number.isFinite(max)) strip.style.background = stripGradient(min, max, valid);
  }

  static #onAddPoint(this: StatEditorApp): void {
    this._syncForm();
    const { min, max, points } = this._state;
    const taken = new Set(points.map(p => p.value));
    let value = Number.isFinite(max) ? max : 100;
    if (Number.isFinite(min) && Number.isFinite(max)) {
      value = Math.round(((min + max) / 2) * 100) / 100;
      while (taken.has(value) && value < max) value += 1;
    }
    points.push({ value, name: "", color: "#888888" });
    void this.render();
  }

  static #onRemovePoint(this: StatEditorApp, _event: Event, target: HTMLElement): void {
    this._syncForm();
    this._state.points.splice(Number(target.dataset.index), 1);
    void this.render();
  }

  static async #onSave(this: StatEditorApp): Promise<void> {
    this._syncForm();
    const s = this._state;
    const name = sanitizeName(s.name, "");
    if (!name) return ui.notifications.warn(t("SIEDLUNG.stats.errors.noName"));

    let stat: StatType;
    if (s.kind === "open") {
      stat = { id: s.statId ?? foundry.utils.randomID(), name, kind: "open" };
    } else {
      const points = s.points.map(p => ({ value: Math.round(p.value * 100) / 100, name: p.name.trim().slice(0, 40), color: p.color }));
      const error = validateInterval(s.min, s.max, points);
      if (error) return ui.notifications.warn(t(`SIEDLUNG.stats.errors.${error}`));
      points.sort((a, b) => a.value - b.value);
      stat = { id: s.statId ?? foundry.utils.randomID(), name, kind: "interval", min: s.min, max: s.max, points };
    }

    await saveDefinitions(defs => {
      const i = defs.stats.findIndex(x => x.id === stat.id);
      if (i >= 0) defs.stats[i] = stat;
      else defs.stats.push(stat);
    });
    await this.close();
  }

  static async #onCancel(this: StatEditorApp): Promise<void> {
    await this.close();
  }
}

export function openStatEditor(statId: string | null): void {
  const existing = foundry.applications.instances.get(StatEditorApp.idFor(statId));
  if (existing) existing.render({ force: true });
  else new StatEditorApp(statId).render({ force: true });
}
