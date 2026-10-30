import { ID, SOCKET } from "./constants";
import { getLaws } from "./definitions";
import { getSettlement } from "./settlement";
import { applyChange, checkChange, currentOption, defaultLawState } from "./laws";
import type { ChangeCheck, LawRules } from "./laws";
import { isSettlementScene } from "./store";
import { escapeHTML } from "./util";
import type { LawChangeMessage, LawState } from "./types";

export const SETTING_LAW_EFFECTS_VISIBLE = "lawEffectsVisible";
export const SETTING_LAW_CHANGES = "lawChangesPerWeek";
export const SETTING_LAW_COOLDOWN = "lawCooldownWeeks";

const t = (key: string, data?: Record<string, string | number>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const speaker = () => ({ alias: t("SIEDLUNG.title") });

/** Dürfen Spieler die Wirkungen der Gesetze sehen? (Die SL sieht sie immer.) */
export const lawEffectsVisible = (): boolean => game.settings.get(ID, SETTING_LAW_EFFECTS_VISIBLE) !== false;

export function getLawRules(): LawRules {
  const num = (key: string): number => {
    const n = Math.floor(Number(game.settings.get(ID, key)));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return { perWeek: num(SETTING_LAW_CHANGES), cooldown: num(SETTING_LAW_COOLDOWN) };
}

/** Text für einen abgelehnten Wechsel. */
export function reasonText(check: Extract<ChangeCheck, { ok: false }>, rules: LawRules = getLawRules()): string {
  return t(`SIEDLUNG.laws.reasons.${check.reason}`, { weeks: check.weeks ?? 0, limit: rules.perWeek });
}

/** Alle Nutzer: Ausprägung eines Gesetzes wechseln. Spieler schicken die Anfrage per Socket an die aktive SL. */
export function requestLawChange(lawId: string, optionId: string): void {
  if (!isSettlementScene()) return;
  const law = getLaws().find(l => l.id === lawId);
  if (!law) return;
  const state = getSettlement();
  const check = checkChange(law, optionId, state.laws[lawId], {
    week: state.week,
    changesThisWeek: state.lawChanges,
    isGM: game.user.isGM,
    rules: getLawRules()
  });
  if (!check.ok) {
    ui.notifications.warn(reasonText(check));
    return;
  }
  const msg: LawChangeMessage = { action: "law", sceneId: canvas.scene.id, lawId, optionId, userId: game.user.id };
  if (game.user.isGM) {
    void handleLawChange(msg);
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.error(t("SIEDLUNG.errors.noGM"));
    return;
  }
  game.socket.emit(SOCKET, msg);
}

export function registerLawSocket(): void {
  game.socket.on(SOCKET, (msg: LawChangeMessage | undefined) => {
    if (game.user !== game.users.activeGM) return;
    if (msg?.action === "law") void handleLawChange(msg);
  });
}

/** Läuft nur auf dem Client der aktiven SL und prüft alles erneut. */
async function handleLawChange({ sceneId, lawId, optionId, userId }: LawChangeMessage): Promise<void> {
  const scene = game.scenes.get(sceneId);
  const user = game.users.get(userId);
  const law = getLaws().find(l => l.id === lawId);
  if (!scene || !user || !law || !isSettlementScene(scene)) return;
  const state = getSettlement(scene);
  const check = checkChange(law, optionId, state.laws[lawId], {
    week: state.week,
    changesThisWeek: state.lawChanges,
    isGM: user.isGM,
    rules: getLawRules()
  });
  if (!check.ok) {
    if (!user.isGM) {
      await ChatMessage.create({ whisper: [userId], speaker: speaker(), content: t("SIEDLUNG.laws.rejected", { name: escapeHTML(law.name), reason: reasonText(check) }) });
    }
    return;
  }
  const before = currentOption(law, state.laws[lawId]);
  state.laws[lawId] = applyChange(state.laws[lawId], optionId, state.week, user.isGM);
  if (!user.isGM) state.lawChanges += 1;
  await scene.setFlag(ID, "settlement", state);
  // Änderungen der SL bleiben still (die SL kündigt sie bei Bedarf selbst an); versteckte Gesetze nie öffentlich
  if (!user.isGM && !state.laws[lawId].hidden) {
    const after = currentOption(law, state.laws[lawId]);
    await ChatMessage.create({
      speaker: speaker(),
      content: t("SIEDLUNG.laws.changed", { user: escapeHTML(user.name), law: escapeHTML(law.name), from: escapeHTML(before.name), to: escapeHTML(after.name) })
    });
  }
}

async function updateLawState(lawId: string, mutate: (s: LawState) => void): Promise<void> {
  if (!game.user.isGM || !canvas.scene) return;
  const state = getSettlement();
  const s = state.laws[lawId] ?? defaultLawState();
  mutate(s);
  state.laws[lawId] = s;
  await canvas.scene.setFlag(ID, "settlement", state);
}

const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

/** SL: Gesetz für Spieler verstecken bzw. zeigen. */
export const toggleLawHidden = (lawId: string): Promise<void> => updateLawState(lawId, s => { s.hidden = !s.hidden; });

/** SL: Änderungen am Gesetz sperren bzw. freigeben. */
export const toggleLawLocked = (lawId: string): Promise<void> => updateLawState(lawId, s => { s.locked = !s.locked; });

/** SL: Ausprägung ausgrauen (für Spieler nicht wählbar) bzw. freigeben. */
export const toggleOptionDisabled = (lawId: string, optionId: string): Promise<void> => updateLawState(lawId, s => { s.disabled = toggle(s.disabled, optionId); });

/** SL: Ausprägung vor Spielern verstecken bzw. zeigen. */
export const toggleOptionHidden = (lawId: string, optionId: string): Promise<void> => updateLawState(lawId, s => { s.hiddenOptions = toggle(s.hiddenOptions, optionId); });
