/**
 * Coordinate mapping between screen pixels (overlay layer) and PDF points.
 *
 * This is the delicate part of PdfModdy and the foundation every later
 * milestone (signatures, checkmarks, form fields) reuses — so all conversions
 * live here and nowhere else.
 *
 * Two coordinate systems are in play:
 *
 *  - **Screen / overlay pixels**: origin TOP-left, y grows DOWNWARD. This is
 *    how the DOM overlay (and the PDF.js canvas) are laid out. One overlay
 *    pixel equals one CSS pixel; the overlay is sized to `viewport.width` ×
 *    `viewport.height`.
 *
 *  - **PDF points (user space)**: origin BOTTOM-left, y grows UPWARD. 1 pt =
 *    1/72 inch. This is what pdf-lib's `drawText`/`drawImage` expect, and what
 *    we persist in the annotation model so positions survive any zoom level.
 *
 * The Y-flip (and page rotation, if any) is handled by PDF.js's own
 * `viewport.convertToPdfPoint` / `convertToViewportPoint`, which are the
 * canonical, battle-tested conversions — we never hand-roll the flip.
 *
 * Because positions are stored in points, changing the render `scale` (zoom)
 * never corrupts an annotation: only the pixel projection changes.
 */
import type { PageViewport } from 'pdfjs-dist';

export interface PtPoint {
	xPt: number;
	yPt: number;
}

export interface PxPoint {
	xPx: number;
	yPx: number;
}

/**
 * Overlay pixel → PDF point. `xPx`/`yPx` are relative to the overlay's
 * top-left corner. Handles the Y-flip and any page rotation.
 */
export function pxToPt(viewport: PageViewport, xPx: number, yPx: number): PtPoint {
	const [xPt, yPt] = viewport.convertToPdfPoint(xPx, yPx);
	return { xPt, yPt };
}

/**
 * PDF point → overlay pixel, relative to the overlay's top-left corner.
 * Inverse of {@link pxToPt} for the same viewport.
 */
export function ptToPx(viewport: PageViewport, xPt: number, yPt: number): PxPoint {
	const [xPx, yPx] = viewport.convertToViewportPoint(xPt, yPt);
	return { xPx, yPx };
}

/**
 * Scalar length conversions. A *distance* (width/height/font-size) scales by
 * exactly `viewport.scale`, independent of the flip — so these stay simple and
 * exact for the unrotated case this app targets.
 */
export function ptLenToPx(viewport: PageViewport, lengthPt: number): number {
	return lengthPt * viewport.scale;
}

export function pxLenToPt(viewport: PageViewport, lengthPx: number): number {
	return lengthPx / viewport.scale;
}
