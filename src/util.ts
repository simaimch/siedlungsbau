const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHTML = (s: string): string => s.replace(/[&<>"']/g, c => ESCAPES[c]);

export const MAX_NAME_LENGTH = 60;

/** Bereinigt einen vom Client gelieferten Gebäudenamen; leere oder ungültige Namen werden zum Fallback. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}
