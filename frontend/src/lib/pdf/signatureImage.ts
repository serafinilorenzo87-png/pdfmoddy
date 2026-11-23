/**
 * Signature rasterization helpers — the one place that turns either input
 * (a hand-drawn canvas or a typed cursive name) into the SAME artifact: a
 * transparent-background PNG with a black mark, plus its aspect ratio. Because
 * both signature kinds collapse to a PNG here, placement and baking (embedPng +
 * drawImage) have a single, uniform path (see `bake.ts`).
 *
 * All of this touches the DOM `<canvas>` API, so it only runs in the browser
 * (called from the signature modal / page), never during SSR.
 */
import { unzipSync } from 'fflate';

/** Result of rasterizing a signature: a PNG data URL and its width/height ratio. */
export interface RasterizedSignature {
	dataUrl: string;
	/** Natural aspect ratio = width / height. */
	aspect: number;
}

/** Alpha below this counts as transparent when trimming / measuring. */
const ALPHA_THRESHOLD = 8;

/**
 * Crop away fully-transparent margins and return a tight PNG (with a small
 * padding) plus its aspect ratio. Returns `null` if the canvas is blank, so an
 * empty drawing can't be saved as a signature.
 */
export function trimToPng(source: HTMLCanvasElement, margin = 6): RasterizedSignature | null {
	const w = source.width;
	const h = source.height;
	if (w === 0 || h === 0) return null;
	const srcCtx = source.getContext('2d');
	if (!srcCtx) return null;

	const { data } = srcCtx.getImageData(0, 0, w, h);
	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < minX || maxY < minY) return null; // nothing drawn

	minX = Math.max(0, minX - margin);
	minY = Math.max(0, minY - margin);
	maxX = Math.min(w - 1, maxX + margin);
	maxY = Math.min(h - 1, maxY + margin);
	const cw = maxX - minX + 1;
	const ch = maxY - minY + 1;

	const out = document.createElement('canvas');
	out.width = cw;
	out.height = ch;
	const outCtx = out.getContext('2d');
	if (!outCtx) return null;
	outCtx.drawImage(source, minX, minY, cw, ch, 0, 0, cw, ch);
	return { dataUrl: out.toDataURL('image/png'), aspect: cw / ch };
}

/**
 * Render a name in a cursive hand ("Segoe Script", always present on Windows 11
 * — zero download, fully offline) to a transparent PNG with black glyphs. We
 * draw onto a generous canvas and then {@link trimToPng}, so ascenders /
 * descenders are never clipped and the result is cropped tight. Returns `null`
 * for an empty name.
 */
export function renderCursiveName(name: string): RasterizedSignature | null {
	const text = name.trim();
	if (!text) return null;

	const fontSize = 120;
	const font = `italic ${fontSize}px "Segoe Script", "Segoe Print", cursive`;

	// Measure first so the canvas is wide enough for the whole name.
	const probe = document.createElement('canvas').getContext('2d');
	if (!probe) return null;
	probe.font = font;
	const textWidth = Math.ceil(probe.measureText(text).width);

	const pad = Math.ceil(fontSize * 0.6);
	const canvas = document.createElement('canvas');
	canvas.width = textWidth + pad * 2;
	canvas.height = Math.ceil(fontSize * 2) + pad * 2;

	// Resizing a canvas resets its context, so configure it after sizing.
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.font = font;
	ctx.fillStyle = '#000000';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(text, pad, Math.ceil(fontSize * 1.3));

	return trimToPng(canvas);
}

// ── "Acquire" helpers: import a signature from an image, a PDF crop, or an
// office document's embedded images, then make the light background transparent.

/**
 * Turn light pixels transparent so an acquired signature (scan / crop with a
 * white or light background) can overlay a document without a solid box. Dark
 * ink stays opaque; a thin luminance band is feathered for clean edges.
 * Mutates `canvas` in place. `threshold` is the luminance (0..1) above which a
 * pixel becomes fully transparent.
 */
export function removeLightBackground(canvas: HTMLCanvasElement, threshold = 0.8): void {
	const ctx = canvas.getContext('2d');
	if (!ctx || canvas.width === 0 || canvas.height === 0) return;
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const d = img.data;
	const hi = Math.min(1, Math.max(0, threshold));
	const lo = Math.max(0, hi - 0.18);
	for (let i = 0; i < d.length; i += 4) {
		const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
		if (lum >= hi) {
			d[i + 3] = 0;
		} else if (lum > lo) {
			const t = (lum - lo) / (hi - lo); // 0 (keep) → 1 (clear)
			d[i + 3] = Math.round(d[i + 3] * (1 - t));
		}
	}
	ctx.putImageData(img, 0, 0);
}

/**
 * Erase horizontal form rules (the printed line a signature sits on) while
 * keeping the signature itself. Works on the ALPHA channel (run after
 * {@link removeLightBackground}, so ink is opaque and background transparent).
 *
 * Heuristic: a form line is a thin, near-full-width band of opaque pixels. We
 * find rows whose longest contiguous opaque run covers at least `minCoverage`
 * of the width, group consecutive such rows into bands, and erase only the thin
 * ones (`maxThickness`). To avoid cutting strokes that cross the line, columns
 * where ink continues both just above and just below the band are "bridged"
 * (kept), so a descender/loop passing through the rule stays connected.
 * Mutates `canvas` in place.
 */
export function removeHorizontalLines(
	canvas: HTMLCanvasElement,
	opts: { minCoverage?: number; maxThickness?: number; bridge?: boolean } = {}
): void {
	const ctx = canvas.getContext('2d');
	const w = canvas.width;
	const h = canvas.height;
	if (!ctx || w === 0 || h === 0) return;
	const minCoverage = opts.minCoverage ?? 0.55;
	const maxThickness = opts.maxThickness ?? Math.max(3, Math.round(h * 0.06));
	const bridge = opts.bridge ?? true;

	const img = ctx.getImageData(0, 0, w, h);
	const a = img.data;
	const OPAQUE = 40;
	const opaqueAt = (x: number, y: number) => a[(y * w + x) * 4 + 3] > OPAQUE;

	const rowIsLine: boolean[] = new Array(h).fill(false);
	const need = minCoverage * w;
	for (let y = 0; y < h; y++) {
		let run = 0;
		let best = 0;
		for (let x = 0; x < w; x++) {
			if (opaqueAt(x, y)) {
				run += 1;
				if (run > best) best = run;
			} else {
				run = 0;
			}
		}
		rowIsLine[y] = best >= need;
	}

	let y = 0;
	while (y < h) {
		if (!rowIsLine[y]) {
			y += 1;
			continue;
		}
		let y1 = y;
		while (y1 + 1 < h && rowIsLine[y1 + 1]) y1 += 1;
		const thickness = y1 - y + 1;
		if (thickness <= maxThickness) {
			const aboveTop = Math.max(0, y - 3);
			const belowBot = Math.min(h - 1, y1 + 3);
			for (let x = 0; x < w; x++) {
				let keep = false;
				if (bridge) {
					let hasAbove = false;
					for (let yy = aboveTop; yy < y; yy++) {
						if (opaqueAt(x, yy)) {
							hasAbove = true;
							break;
						}
					}
					let hasBelow = false;
					for (let yy = y1 + 1; yy <= belowBot; yy++) {
						if (opaqueAt(x, yy)) {
							hasBelow = true;
							break;
						}
					}
					keep = hasAbove && hasBelow;
				}
				if (!keep) {
					for (let yy = y; yy <= y1; yy++) a[(yy * w + x) * 4 + 3] = 0;
				}
			}
		}
		y = y1 + 1;
	}
	ctx.putImageData(img, 0, 0);
}

/** Load an image (data/blob URL) into a fresh canvas at its natural size. */
export function loadImageToCanvas(src: string): Promise<HTMLCanvasElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const c = document.createElement('canvas');
			c.width = img.naturalWidth || img.width;
			c.height = img.naturalHeight || img.height;
			const ctx = c.getContext('2d');
			if (!ctx) {
				reject(new Error('Canvas non disponibile.'));
				return;
			}
			ctx.drawImage(img, 0, 0);
			resolve(c);
		};
		img.onerror = () => reject(new Error('Immagine non caricabile.'));
		img.src = src;
	});
}

/** Crop a rectangular region (source pixels) into a new canvas. */
export function cropCanvas(
	source: HTMLCanvasElement,
	x: number,
	y: number,
	w: number,
	h: number
): HTMLCanvasElement {
	const out = document.createElement('canvas');
	out.width = Math.max(1, Math.round(w));
	out.height = Math.max(1, Math.round(h));
	const ctx = out.getContext('2d');
	if (ctx) ctx.drawImage(source, x, y, w, h, 0, 0, out.width, out.height);
	return out;
}

const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	bmp: 'image/bmp',
	webp: 'image/webp'
};

/** Browser-renderable image extensions accepted by the open dialog. */
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME);

/** MIME type for a file name by extension, or null if not a supported image. */
export function imageMimeForName(name: string): string | null {
	const ext = name.toLowerCase().split('.').pop() ?? '';
	return IMAGE_MIME[ext] ?? null;
}

/** Base64 data URL for raw image bytes (chunked to avoid call-stack limits). */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return `data:${mime};base64,${btoa(bin)}`;
}

export interface ExtractedImage {
	name: string;
	dataUrl: string;
}

/**
 * Pull the embedded raster images out of an Office/OpenDocument file. `.docx`
 * and `.odt` are ZIP archives: Word keeps media under `word/media/`, ODF under
 * `Pictures/`. We can list those images for the user to pick a signature from —
 * we do NOT render the document (that would need an external engine), so this
 * only surfaces inserted images, not typed text.
 */
export function extractOfficeImages(bytes: Uint8Array): ExtractedImage[] {
	const files = unzipSync(bytes);
	const out: ExtractedImage[] = [];
	for (const path of Object.keys(files)) {
		const lower = path.toLowerCase();
		const inMedia =
			lower.startsWith('word/media/') ||
			lower.startsWith('pictures/') ||
			lower.includes('/media/');
		const mime = imageMimeForName(lower);
		if (inMedia && mime) {
			out.push({ name: path.split('/').pop() || path, dataUrl: bytesToDataUrl(files[path], mime) });
		}
	}
	return out;
}

/**
 * Finalize an acquired canvas into a saveable signature: optionally knock out
 * the light background, then crop to the ink. Returns `null` if nothing is left.
 */
export function finalizeAcquired(
	source: HTMLCanvasElement,
	opts: { removeBackground: boolean; threshold?: number; removeLines?: boolean }
): RasterizedSignature | null {
	// Work on a copy so the on-screen preview source isn't mutated.
	const work = cropCanvas(source, 0, 0, source.width, source.height);
	if (opts.removeBackground) removeLightBackground(work, opts.threshold);
	if (opts.removeLines) removeHorizontalLines(work);
	return trimToPng(work);
}
