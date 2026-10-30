import { ID } from "./constants";
import { entryChips, getLawCategories, getLaws } from "./definitions";
import { getSettlement } from "./settlement";
import { checkChange, currentOption, isLawVisible, isOptionVisible, weeksUntilChange } from "./laws";
import {
  getLawRules, lawEffectsVisible, reasonText, requestLawChange,
  toggleLawHidden, toggleLawLocked, toggleOptionDisabled, toggleOptionHidden
} from "./laws-service";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Gesetze der Siedlung: alle sehen sie (je nach Sichtbarkeit), Spieler wechseln Ausprägungen mit Limit, die SL verwaltet. */
export class LawsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-laws`,
    classes: [ID],
    window: { title: "SIEDLUNG.laws.title", icon: "fa-solid fa-gavel", resizable: true },
    position: { width: 480, height: 600 },
    actions: {
      pick: LawsApp.#onPick,
      lawHidden: LawsApp.#onLawHidden,
      lawLocked: LawsApp.#onLawLocked,
      optionDisabled: LawsApp.#onOptionDisabled,
      optionHidden: LawsApp.#onOptionHidden
    }
  };

  static PARTS = {
    main: { template: `modules/${ID}/templates/laws.hbs`, scrollable: [""] }
  };

  async _prepareContext(): Promise<object> {
    const isGM = game.user.isGM;
    const state = getSettlement();
    const rules = getLawRules();
    const showEffects = isGM || lawEffectsVisible();
    const ctx = { week: state.week, changesThisWeek: state.lawChanges, isGM, rules };

    const laws = getLaws().filter(l => isLawVisible(state.laws[l.id], isGM));
    const row = (law: (typeof laws)[number]) => {
      const st = state.laws[law.id];
      const current = currentOption(law, st);
      const wait = weeksUntilChange(st, state.week, rules.cooldown);
      return {
        id: law.id,
        name: law.name,
        description: law.description ?? "",
        hidden: !!st?.hidden,
        locked: !!st?.locked,
        waitNote: !isGM && wait > 0 ? t("SIEDLUNG.laws.waitNote", { weeks: wait }) : "",
        current: current.name,
        options: law.options
          .filter(o => isOptionVisible(law, o, st, isGM))
          .map(o => {
            const check = checkChange(law, o.id, st, ctx);
            const isCurrent = o.id === current.id;
            return {
              id: o.id,
              name: o.name,
              current: isCurrent,
              grayed: !!st?.disabled.includes(o.id),
              hiddenOption: !!st?.hiddenOptions.includes(o.id),
              pickable: !isCurrent && check.ok,
              title: isCurrent || check.ok ? "" : reasonText(check, rules),
              effects: showEffects ? entryChips(o.entries) : []
            };
          })
      };
    };

    const known = new Set(getLawCategories().map(c => c.id));
    const groups = [
      ...getLawCategories().map(c => ({ id: c.id, label: c.label, laws: laws.filter(l => l.category === c.id).map(row) })),
      { id: "", label: t("SIEDLUNG.laws.noCategory"), laws: laws.filter(l => !known.has(l.category)).map(row) }
    ].filter(g => g.laws.length);

    return {
      isGM,
      groups,
      empty: groups.length === 0,
      limitNote: isGM ? "" : t("SIEDLUNG.laws.limitNote", { left: Math.max(0, rules.perWeek - state.lawChanges), limit: rules.perWeek, cooldown: rules.cooldown })
    };
  }

  static async #onPick(_event: Event, target: HTMLElement): Promise<void> {
    const lawId = target.dataset.law ?? "";
    const optionId = target.dataset.option ?? "";
    const law = getLaws().find(l => l.id === lawId);
    const option = law?.options.find(o => o.id === optionId);
    if (!law || !option) return;
    if (!game.user.isGM) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: law.name },
        content: `<p>${t("SIEDLUNG.laws.confirmChange", { law: law.name, option: option.name })}</p>`
      });
      if (!ok) return;
    }
    requestLawChange(lawId, optionId);
  }

  static #onLawHidden(_event: Event, target: HTMLElement): void {
    void toggleLawHidden(target.dataset.law ?? "");
  }

  static #onLawLocked(_event: Event, target: HTMLElement): void {
    void toggleLawLocked(target.dataset.law ?? "");
  }

  static #onOptionDisabled(_event: Event, target: HTMLElement): void {
    void toggleOptionDisabled(target.dataset.law ?? "", target.dataset.option ?? "");
  }

  static #onOptionHidden(_event: Event, target: HTMLElement): void {
    void toggleOptionHidden(target.dataset.law ?? "", target.dataset.option ?? "");
  }
}
