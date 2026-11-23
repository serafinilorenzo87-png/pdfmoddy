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
import { PDFDocument, rgb, LineCapStyle, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type {
	Annotation,
	SignatureAnnotation,
	SymbolAnnotation,
	TextAnnotation
} from './annotations.svelte';
import { fontDef } from './fonts';
import { applyFormValues, type FormFieldValue } from './forms';
import { SYMBOL_STROKES, SYMBOL_VIEWBOX } from './symbols';

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

function drawTextAnnotation(page: PDFPage, font: PDFFont, ann: TextAnnotation): void {
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

function drawSymbolAnnotation(page: PDFPage, ann: SymbolAnnotation): void {
	const { r, g, b } = hexToRgb01(ann.color);
	const color = rgb(r, g, b);
	// Box edges in PDF space (origin bottom-left, y up).
	const left = ann.xPt;
	const bottom = ann.yPt - ann.hPt;
	// Stroke ~10% of the box (matches the on-screen SVG), with a sane floor.
	const thickness = Math.max(0.8, Math.min(ann.wPt, ann.hPt) * 0.1);

	// Map a geometry point (0..VIEWBOX, y DOWN) to a PDF point (y UP) — the same
	// flip the overlay uses, so the baked mark matches the preview exactly.
	const toPdf = (sx: number, sy: number) => ({
		x: left + (sx / SYMBOL_VIEWBOX) * ann.wPt,
		y: bottom + (1 - sy / SYMBOL_VIEWBOX) * ann.hPt
	});

	for (const poly of SYMBOL_STROKES[ann.symbol]) {
		for (let i = 0; i < poly.length - 1; i++) {
			const start = toPdf(poly[i][0], poly[i][1]);
			const end = toPdf(poly[i + 1][0], poly[i + 1][1]);
			page.drawLine({ start, end, thickness, color, lineCap: LineCapStyle.Round });
		}
	}
}

/** Decode a `data:image/png;base64,...` URL to raw bytes for pdf-lib. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
	const comma = dataUrl.indexOf(',');
	const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function drawSignatureAnnotation(page: PDFPage, png: PDFImage, ann: SignatureAnnotation): void {
	// Box edges in PDF space (origin bottom-left, y up): yPt is the TOP edge, so
	// the image's bottom-left anchor sits hPt below it. Same flip as the symbol
	// path, so the baked image matches the on-screen overlay exactly.
	const left = ann.xPt;
	const bottom = ann.yPt - ann.hPt;
	page.drawImage(png, { x: left, y: bottom, width: ann.wPt, height: ann.hPt });
}

/**
 * Return a NEW PDF byte array: the original document with every annotation
 * stamped onto its page, and (optionally) the existing AcroForm fields filled
 * with `formValues`. `originalBytes` is not mutated.
 *
 * Order: fill the native form fields first, then stamp the overlay annotations
 * on top, then — if `flattenForm` — flatten the form so the filled values
 * become fixed page content (no longer editable). The overlay stamps are plain
 * page content, independent of the form, so they survive flattening unchanged.
 *
 * @param formValues  Per-field values (keyed by field name); omit for PDFs
 *                    without a form.
 * @param flattenForm When true, `form.flatten()` after filling — the values are
 *                    burned in and the document is no longer a fillable form.
 */
export async function bakeAnnotations(
	originalBytes: Uint8Array,
	annots: readonly Annotation[],
	formValues?: Record<string, FormFieldValue>,
	flattenForm = false
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(originalBytes);

	if (formValues) {
		applyFormValues(doc, formValues);
		// Regenerate appearance streams so the written values are visible when the
		// saved PDF is reopened in any viewer, even without flattening.
		try {
			doc.getForm().updateFieldAppearances();
		} catch {
			// A font/encoding hiccup on appearance generation must not fail the save;
			// the values are still stored in the field dictionaries.
		}
	}

	const pages = doc.getPages();

	// Embed each standard font at most once, lazily.
	const fontCache = new Map<string, PDFFont>();
	const embed = async (ann: TextAnnotation): Promise<PDFFont> => {
		const std = fontDef(ann.font).standard;
		let f = fontCache.get(std);
		if (!f) {
			f = await doc.embedFont(std);
			fontCache.set(std, f);
		}
		return f;
	};

	// Embed each unique signature PNG at most once (same data URL reused across
	// placements → one embedded image).
	const pngCache = new Map<string, PDFImage>();
	const embedPng = async (dataUrl: string): Promise<PDFImage> => {
		let img = pngCache.get(dataUrl);
		if (!img) {
			img = await doc.embedPng(dataUrlToBytes(dataUrl));
			pngCache.set(dataUrl, img);
		}
		return img;
	};

	for (const ann of annots) {
		const page = pages[ann.pageIndex];
		if (!page) continue;
		if (ann.type === 'text') drawTextAnnotation(page, await embed(ann), ann);
		else if (ann.type === 'symbol') drawSymbolAnnotation(page, ann);
		else if (ann.type === 'signature')
			drawSignatureAnnotation(page, await embedPng(ann.src), ann);
	}

	if (flattenForm) {
		try {
			doc.getForm().flatten();
		} catch {
			// If flattening fails (unusual form constructs), fall back to a filled
			// but still-interactive form rather than losing the document.
		}
	}

	return doc.save();
}
