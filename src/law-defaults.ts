import type { Law, LawCategory } from "./types";

/** Beispiel, das beim ersten Start mitgeliefert wird; die SL kann es ändern oder löschen. */
export const DEFAULT_LAW_CATEGORIES: LawCategory[] = [{ id: "sicherheit", label: "Öffentliche Sicherheit" }];

export const DEFAULT_LAWS: Law[] = [
  {
    id: "ausgangssperre",
    name: "Ausgangssperre",
    category: "sicherheit",
    description: "Wer nachts auf die Straße darf.",
    options: [
      { id: "keine", name: "Keine Ausgangssperre", entries: [] },
      {
        id: "locker",
        name: "Lockere Ausgangssperre",
        entries: [{ kind: "stat", id: "morale", amount: -2 }, { kind: "stat", id: "loyalty", amount: 2 }]
      },
      {
        id: "streng",
        name: "Strenge Ausgangssperre",
        entries: [{ kind: "stat", id: "morale", amount: -8 }, { kind: "stat", id: "loyalty", amount: 5 }]
      }
    ]
  }
];
