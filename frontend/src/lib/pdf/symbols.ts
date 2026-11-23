/**
 * Vector geometry for the "symbol" annotations (checkmark / cross).
 *
 * Single source of truth so the on-screen SVG preview and the pdf-lib baking
 * draw the EXACT same shape. Points live in a 0..100 box in SCREEN space
 * (y grows DOWN, like SVG and the overlay). The baker flips y the same way the
 * coordinate helpers do, so preview and output always match.
 *
 * Each symbol is a list of polylines; each polyline is a list of [x, y] points
 * stroked end-to-end (no fill).
 */

export type SymbolKind = 'check' | 'cross';

export const SYMBOL_VIEWBOX = 100;

export const SYMBOL_STROKES: Record<SymbolKind, ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = {
	// A tick: down to the low point, then up to the top-right.
	check: [[[16, 54], [40, 76], [84, 22]]],
	// An X: two diagonals.
	cross: [
		[[24, 24], [76, 76]],
		[[24, 76], [76, 24]]
	]
};

export const SYMBOL_LABEL: Record<SymbolKind, string> = {
	check: '✓',
	cross: '✕'
};
