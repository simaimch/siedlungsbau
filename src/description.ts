// Beschreibungen von Gebäuden (HTML aus dem Rich-Text-Editor von Foundry).
import { escapeHTML } from "./util";

export const MAX_DESCRIPTION = 20000;

/** Ist der HTML-Text leer (nur Tags und Leerraum, ohne Bilder)? */
export function isEmptyHtml(html: unknown): boolean {
  if (typeof html !== "string") return true;
  if (/<(img|hr|iframe|video|audio)\b/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "").length === 0;
}

/**
 * Bereinigt HTML mit der Funktion von Foundry (entfernt Skripte, Ereignis-Attribute, unbekannte Tags).
 * Steht sie nicht zur Verfügung, bleibt nur maskierter Text übrig. Leere Beschreibungen ergeben "".
 */
export function cleanDescription(raw: unknown): string {
  if (typeof raw !== "string" || isEmptyHtml(raw)) return "";
  const clip = raw.slice(0, MAX_DESCRIPTION);
  const clean = (foundry.utils as { cleanHTML?: (s: string) => string }).cleanHTML;
  const out = clean ? clean(clip) : `<p>${escapeHTML(clip.replace(/<[^>]*>/g, ""))}</p>`;
  return isEmptyHtml(out) ? "" : out;
}
