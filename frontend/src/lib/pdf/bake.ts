/**
 * "Baking" — flattening the overlay annotations into the actual PDF with
 * pdf-lib. This is a VISUAL stamp (drawText on the page), not a cryptographic
 * signature / PAdES.
 *
 * We always start from the ORIGINAL, untouched bytes (`LoadedPdf.bytes`) rather
 * than anything PDF.js produced, so the saved file is the real document plus
 * our marks — nothing re-encoded or lossy from the render path.
 *
 * Coordinate contract (see `annotations.svelte.ts` + `coords.ts`): annotation
 * `xPt`/`yPt` are PDF points (origin bottom-left, y up) of the box's top-left
 * corner. pdf-lib's page space is the same user space, so for a standard
 * MediaBox `[0 0 w h]` we draw directly with those coordinates. The only
 * adjustment is text baseline: `drawText`'s `y` is the glyph baseline, while
 * `yPt` is the box's top edge — so we drop the baseline by the font ascent.
 */
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import type { Annotation } from './annotations.svelte';
import { fontDef } from './fonts';

/** Fraction of em used as line advance when a text box holds multiple lines. */
const LINE_HEIGHT_FACTOR = 1.15;

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
	let h = hex.trim().replace(/^#/, '');
	if (h.length === 3) {
		h = h
			.split('')
			.map((c) => c + c)
			.join('');
	}
	const n = Number.parseInt(h, 16);
	if (!Number.isFinite(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
	return {
		r: ((n >> 16) & 0xff) / 255,
		g: ((n >> 8) & 0xff) / 255,
		b: (n & 0xff) / 255
	};
}

function drawTextAnnotation(
	page: ReturnType<PDFDocument['getPages']>[number],
	font: PDFFont,
	ann: Annotation
): void {
	const text = ann.text;
	if (!text.trim()) return; // empty box leaves no mark
	const size = ann.fontSize;
	const { r, g, b } = hexToRgb01(ann.color);
	const color = rgb(r, g, b);

	// Ascent = height above the baseline at this size. The box's top edge is at
	// `yPt`, so the first line's baseline sits `ascent` below it.
	const ascent = font.heightAtSize(size, { descender: false });
	const lineAdvance = size * LINE_HEIGHT_FACTOR;

	const lines = text.split('\n');
	let baseline = ann.yPt - ascent;
	for (const line of lines) {
		if (line.length > 0) {
			page.drawText(line, { x: ann.xPt, y: baseline, size, font, color });
		}
		baseline -= lineAdvance;
	}
}

/**
 * Return a NEW PDF byte array: the original document with every annotation
 * stamped onto its page. `originalBytes` is not mutated.
 */
export async function bakeAnnotations(
	originalBytes: Uint8Array,
	annots: readonly Annotation[]
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(originalBytes);
	const pages = doc.getPages();

	// Embed each standard font at most once, lazily.
	const fontCache = new Map<string, PDFFont>();
	const embed = async (ann: Annotation): Promise<PDFFont> => {
		const std = fontDef(ann.font).standard;
		let f = fontCache.get(std);
		if (!f) {
			f = await doc.embedFont(std);
			fontCache.set(std, f);
		}
		return f;
	};

	for (const ann of annots) {
		const page = pages[ann.pageIndex];
		if (!page) continue;
		if (ann.type === 'text') drawTextAnnotation(page, await embed(ann), ann);
	}

	return doc.save();
}
