/**
 * Shared font catalogue: the standard-14 PDF fonts PdfModdy exposes, mapped to
 * both pdf-lib's `StandardFonts` (for baking) and a CSS description (for the
 * DOM preview). Keeping the two in one place is what makes the on-screen box
 * match the saved PDF.
 *
 * Reused by: the annotation model (default font), the toolbar (dropdown),
 * PdfPage (CSS preview) and bake.ts (embedding). Signatures in M3 can ignore
 * this, but the "pick a style then place" flow around it is the reusable part.
 */
import { StandardFonts } from 'pdf-lib';

export type FontKey =
	| 'helvetica'
	| 'helvetica-bold'
	| 'helvetica-italic'
	| 'times'
	| 'times-bold'
	| 'times-italic'
	| 'courier'
	| 'courier-bold';

export interface FontCss {
	family: string;
	weight: 'normal' | 'bold';
	style: 'normal' | 'italic';
}

export interface FontDef {
	key: FontKey;
	label: string;
	/** pdf-lib standard font used when baking. */
	standard: StandardFonts;
	/** CSS so the DOM preview matches the baked glyphs' family/weight/style. */
	css: FontCss;
}

export const FONTS: readonly FontDef[] = [
	{ key: 'helvetica', label: 'Helvetica', standard: StandardFonts.Helvetica, css: { family: 'Arial, Helvetica, sans-serif', weight: 'normal', style: 'normal' } },
	{ key: 'helvetica-bold', label: 'Helvetica Bold', standard: StandardFonts.HelveticaBold, css: { family: 'Arial, Helvetica, sans-serif', weight: 'bold', style: 'normal' } },
	{ key: 'helvetica-italic', label: 'Helvetica Italic', standard: StandardFonts.HelveticaOblique, css: { family: 'Arial, Helvetica, sans-serif', weight: 'normal', style: 'italic' } },
	{ key: 'times', label: 'Times Roman', standard: StandardFonts.TimesRoman, css: { family: '"Times New Roman", Times, serif', weight: 'normal', style: 'normal' } },
	{ key: 'times-bold', label: 'Times Bold', standard: StandardFonts.TimesRomanBold, css: { family: '"Times New Roman", Times, serif', weight: 'bold', style: 'normal' } },
	{ key: 'times-italic', label: 'Times Italic', standard: StandardFonts.TimesRomanItalic, css: { family: '"Times New Roman", Times, serif', weight: 'normal', style: 'italic' } },
	{ key: 'courier', label: 'Courier', standard: StandardFonts.Courier, css: { family: '"Courier New", Courier, monospace', weight: 'normal', style: 'normal' } },
	{ key: 'courier-bold', label: 'Courier Bold', standard: StandardFonts.CourierBold, css: { family: '"Courier New", Courier, monospace', weight: 'bold', style: 'normal' } }
];

export const FONT_BY_KEY: Record<FontKey, FontDef> = Object.fromEntries(
	FONTS.map((f) => [f.key, f])
) as Record<FontKey, FontDef>;

export const DEFAULT_FONT: FontKey = 'helvetica';

/** Resolve a key to its definition, falling back to the default if unknown. */
export function fontDef(key: FontKey): FontDef {
	return FONT_BY_KEY[key] ?? FONT_BY_KEY[DEFAULT_FONT];
}
