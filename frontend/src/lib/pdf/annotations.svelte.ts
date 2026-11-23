/**
 * Annotation model + store for PdfModdy (Svelte 5 runes).
 *
 * An annotation is a visual overlay that gets "baked" onto the PDF on save.
 * Milestone 2 ships the `text` type; signatures / checkmarks / form fields in
 * later milestones are just new `type`s sharing this exact storage and the
 * same point-based coordinates, so the model is intentionally open.
 *
 * ── Coordinate convention (IMPORTANT) ───────────────────────────────────────
 * `xPt` / `yPt` are PDF **points** (origin bottom-left, y up) of the box's
 * on-screen **top-left** corner. So the box spans:
 *     x:  [xPt, xPt + wPt]
 *     y:  [yPt - hPt, yPt]      (yPt is the TOP edge; it has the larger y)
 * Storing points — not pixels — keeps positions stable across zoom levels.
 * See `coords.ts` for the pixel⇄point conversions.
 */
import { DEFAULT_FONT, type FontKey } from './fonts';
import type { SymbolKind } from './symbols';

export type AnnotationType = 'text' | 'symbol';

export interface TextAnnotation {
	id: string;
	pageIndex: number;
	type: 'text';
	/** PDF-point x of the box's top-left corner (origin bottom-left). */
	xPt: number;
	/** PDF-point y of the box's TOP edge (origin bottom-left, y up). */
	yPt: number;
	/** Box width in PDF points. */
	wPt: number;
	/** Box height in PDF points. */
	hPt: number;
	text: string;
	/** Font size in PDF points. */
	fontSize: number;
	/** Standard-font key (see fonts.ts) — used for both preview and baking. */
	font: FontKey;
	/** Hex color, e.g. `#1A1A1A`. */
	color: string;
}

/**
 * A checkmark / cross stamp. Reuses the same box geometry (xPt/yPt/wPt/hPt) and
 * color as text — only the painted content differs. Drawn as vector strokes
 * (see symbols.ts + bake.ts), so it scales and colors cleanly.
 */
export interface SymbolAnnotation {
	id: string;
	pageIndex: number;
	type: 'symbol';
	xPt: number;
	yPt: number;
	wPt: number;
	hPt: number;
	symbol: SymbolKind;
	color: string;
}

export type Annotation = TextAnnotation | SymbolAnnotation;

/** The styling carried by a text box — shared by the toolbar and new boxes. */
export interface TextStyle {
	fontSize: number;
	font: FontKey;
	color: string;
}

/** Styling for a new symbol stamp. */
export interface SymbolStyle {
	symbol: SymbolKind;
	color: string;
}

/**
 * Which placement tool is armed (a click on a page then drops an annotation).
 * Generic tool-mode: every placeable kind is a value here, and M3 signatures
 * will add `'signature'` without changing the mode machinery.
 */
export type Tool = 'none' | 'text' | 'symbol';

let idCounter = 0;
function nextId(): string {
	idCounter += 1;
	return `ann_${Date.now().toString(36)}_${idCounter}`;
}

class AnnotationStore {
	/** All annotations, across every page. Deeply reactive (runes proxy). */
	items = $state<Annotation[]>([]);
	/** Currently selected annotation id, or null. */
	selectedId = $state<string | null>(null);
	/**
	 * Armed placement tool. This is a persistent MODE: it stays set across
	 * placements and is cleared only by the user (toggling the button / Escape),
	 * never automatically after a drop. M3 signatures reuse the same mode switch.
	 */
	tool = $state<Tool>('none');

	/**
	 * Style applied to the NEXT text box, and the live style of the selected box
	 * (kept in sync via {@link setTextStyle}). Lets the user pick font/size/color
	 * before placing and have it persist to subsequent boxes.
	 */
	textDefaults = $state<TextStyle>({ fontSize: 14, font: DEFAULT_FONT, color: '#1A1A1A' });

	/** Style applied to the next symbol stamp, synced with the selection. */
	symbolDefaults = $state<SymbolStyle>({ symbol: 'check', color: '#000000' });

	/** Annotations belonging to one page (0-based), in insertion order. */
	forPage(pageIndex: number): Annotation[] {
		return this.items.filter((a) => a.pageIndex === pageIndex);
	}

	/**
	 * Apply a style change from the toolbar: updates the selected text box (if
	 * any) AND the defaults, so the next box inherits the same look.
	 */
	setTextStyle(patch: Partial<TextStyle>): void {
		if (this.selectedId) {
			const a = this.get(this.selectedId);
			if (a && a.type === 'text') Object.assign(a, patch);
		}
		Object.assign(this.textDefaults, patch);
	}

	/** The style the toolbar should show/edit: the selection's, else the defaults. */
	get activeTextStyle(): TextStyle {
		if (this.selectedId) {
			const a = this.get(this.selectedId);
			if (a && a.type === 'text') return a;
		}
		return this.textDefaults;
	}

	/** Mirror of {@link setTextStyle} for symbol stamps. */
	setSymbolStyle(patch: Partial<SymbolStyle>): void {
		if (this.selectedId) {
			const a = this.get(this.selectedId);
			if (a && a.type === 'symbol') Object.assign(a, patch);
		}
		Object.assign(this.symbolDefaults, patch);
	}

	get activeSymbolStyle(): SymbolStyle {
		if (this.selectedId) {
			const a = this.get(this.selectedId);
			if (a && a.type === 'symbol') return a;
		}
		return this.symbolDefaults;
	}

	/** Add a text annotation; returns its id. Defaults fill in the boring bits. */
	addText(init: Omit<TextAnnotation, 'id' | 'type'>): string {
		const id = nextId();
		this.items.push({ id, type: 'text', ...init });
		return id;
	}

	/** Add a symbol stamp; returns its id. */
	addSymbol(init: Omit<SymbolAnnotation, 'id' | 'type'>): string {
		const id = nextId();
		this.items.push({ id, type: 'symbol', ...init });
		return id;
	}

	remove(id: string): void {
		const i = this.items.findIndex((a) => a.id === id);
		if (i !== -1) this.items.splice(i, 1);
		if (this.selectedId === id) this.selectedId = null;
	}

	/** Look up a single annotation (returns the reactive proxy, so mutate freely). */
	get(id: string): Annotation | undefined {
		return this.items.find((a) => a.id === id);
	}

	clear(): void {
		this.items = [];
		this.selectedId = null;
		this.tool = 'none';
	}
}

/** Singleton store shared by the viewer and every page overlay. */
export const annotations = new AnnotationStore();
