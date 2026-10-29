export const ID = "siedlungsbau";
export const SOCKET = `module.${ID}`;
export const STATUS = { ORDERED: "ordered", DONE: "done" } as const;

/** Die Goldmünzen sind die Basiswährung für Marktwerte und lassen sich nicht löschen. */
export const GOLD_ID = "gold";
