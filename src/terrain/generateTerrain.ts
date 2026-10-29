import { DEFAULT_TERRAIN, ROCK_CHANCE } from "../data";
import { TerrainData } from "../types";

type Side = "top" | "right" | "bottom" | "left";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

function randomItem<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

function getEdgeDistance(
	side: Side,
	x: number,
	y: number,
	cols: number,
	rows: number
): number {
	switch (side) {
		case "top": return y;
		case "right": return cols - 1 - x;
		case "bottom": return rows - 1 - y;
		case "left": return x;
	}
}

/**
 * Erzeugt eine unregelmäßige, aber zusammenhängende Grenzlinie.
 * axis ist die Position entlang des Kartenrandes.
 */
function getBoundary(
	axis: number,
	length: number,
	baseWidth: number,
	seed: number
): number {
	const t = axis / Math.max(1, length - 1);

	// Mehrere Wellen mit unterschiedlichen Frequenzen
	// sorgen für eine organisch wirkende Grenzlinie.
	const wave =
		Math.sin(t * Math.PI * 2 + seed) * 0.45 +
		Math.sin(t * Math.PI * 5 + seed * 1.7) * 0.25 +
		Math.sin(t * Math.PI * 9 + seed * 2.3) * 0.15;

	return Math.max(1, Math.round(baseWidth * (1 + wave * 0.65)));
}

export function generateTerrain(
	cols: number,
	rows: number,
	rockChance = ROCK_CHANCE
): TerrainData {
	const cells: string[] = [];

	// 1. Grundterrain mit zufälligen Felsen erzeugen
	for (let i = 0; i < cols * rows; i++) {
		cells.push(
			Math.random() < rockChance ? "r" : DEFAULT_TERRAIN
		);
	}

	const lakeSide = randomItem(SIDES);

	// Zwei unterschiedliche Seiten für die Wälder auswählen.
	const forestSides = SIDES
		.filter(side => side !== lakeSide)
		.sort(() => Math.random() - 0.5)
		.slice(0, 2);

	const lakeSeed = Math.random() * Math.PI * 2;
	const forestSeeds = forestSides.map(
		() => Math.random() * Math.PI * 2
	);

	const index = (x: number, y: number) => y * cols + x;

	// 2. See erzeugen: Ufer -> seicht -> tief
	const lakeBaseWidth = Math.round(
		(lakeSide === "left" || lakeSide === "right" ? cols : rows) * 0.2
	);

	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const distance = getEdgeDistance(
				lakeSide, x, y, cols, rows
			);

			const axis =
				lakeSide === "left" || lakeSide === "right" ? y : x;

			const depth = getBoundary(
				axis,
				lakeSide === "left" || lakeSide === "right" ? rows : cols,
				lakeBaseWidth,
				lakeSeed
			);

			if (distance >= depth) continue;

			// Distanz zur unregelmäßigen inneren Seegrenze
			const fromShore = depth - 1 - distance;

			if (fromShore === 0) {
				cells[index(x, y)] = "u"; // Ufer
			} else if (fromShore <= 2) {
				cells[index(x, y)] = "s"; // Seichtwasser
			} else {
				cells[index(x, y)] = "t"; // Tiefwasser
			}
		}
	}

	// 3. Wälder mit unregelmäßigen Grenzen erzeugen
	for (let i = 0; i < forestSides.length; i++) {
		const side = forestSides[i];
		const baseWidth = Math.round(
			(side === "left" || side === "right" ? cols : rows) * 0.15
		);

		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				// Wasser nicht durch Wald überschreiben
				const idx = index(x, y);
				if (
					cells[idx] === "u" ||
					cells[idx] === "s" ||
					cells[idx] === "t"
				) {
					continue;
				}

				const distance = getEdgeDistance(
					side, x, y, cols, rows
				);

				const axis =
					side === "left" || side === "right" ? y : x;

				const depth = getBoundary(
					axis,
					side === "left" || side === "right" ? rows : cols,
					baseWidth,
					forestSeeds[i]
				);

				if (distance < depth) {
					cells[idx] = "w";
				}
			}
		}
	}

	return { cols, rows, cells: cells.join("") };
}