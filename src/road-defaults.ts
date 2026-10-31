import type { RoadType } from "./types";

/** Beispiele, die beim ersten Start mitgeliefert werden; die SL kann sie ändern oder löschen. */
export const DEFAULT_ROADS: RoadType[] = [
  { id: "p", name: "Trampelpfad", color: "#b8946a", buildCost: [{ kind: "worker", id: "unskilled", amount: 1 }] },
  {
    id: "q",
    name: "Gepflasterte Straße",
    color: "#8f8f8f",
    buildCost: [{ kind: "resource", id: "stone", amount: 2 }, { kind: "worker", id: "unskilled", amount: 2 }]
  }
];

/** Die mitgelieferten Wegarten mit den Kosten, die in dieser Welt existieren (Kosten für unbekannte Ressourcen entfallen). */
export function defaultRoadsFor(resourceIds: Set<string>, workerIds: Set<string>): RoadType[] {
  return DEFAULT_ROADS.map(r => ({
    ...r,
    buildCost: r.buildCost.filter(c => (c.kind === "resource" ? resourceIds : workerIds).has(c.id)).map(c => ({ ...c }))
  }));
}
