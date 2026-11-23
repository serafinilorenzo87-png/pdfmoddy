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
