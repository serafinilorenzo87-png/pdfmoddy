/**
 * AcroForm support for PdfModdy — enumerate existing interactive form fields
 * with pdf-lib and write their values back on save.
 *
 * This is COMPLEMENTARY to the overlay annotation system (text / symbols /
 * signatures in M2–M3): the overlay is for PDFs with NO fields, this path is
 * for PDFs that ship real interactive AcroForm fields. We enumerate the fields
 * ourselves (rather than leaning on PDF.js's annotation layer) so that the
 * save path — writing values and optionally flattening — stays entirely under
 * our control and consistent with how `bake.ts` already rewrites the original
 * bytes with pdf-lib.
 *
 * Pure, DOM-free module (no Svelte runes) so it round-trips in Node tests. The
 * reactive store lives in `formfields.svelte.ts`; the on-screen inputs live in
 * `PdfPage.svelte`.
 *
 * ── Coordinate convention ────────────────────────────────────────────────────
 * A widget `/Rect` is given in PDF user space (origin bottom-left, y up). We
 * normalize it to `{ x, y, width, height }` where (x, y) is the BOTTOM-LEFT
 * corner — mirroring pdf-lib's own `getRectangle()`. The screen projection (and
 * the Y-flip to the top-left pixel the DOM needs) is done in `PdfPage.svelte`
 * via `coords.ts`, the single canonical conversion used everywhere else.
 */
import {
	PDFCheckBox,
	PDFDocument,
	PDFDropdown,
	PDFOptionList,
	PDFRadioGroup,
	PDFRef,
	PDFTextField,
	type PDFWidgetAnnotation
} from 'pdf-lib';

/** The field kinds we render as fillable inputs. Push buttons / signatures are skipped. */
export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist';

/** A value held per FIELD (keyed by field name). Checkboxes are boolean, everything else a string. */
export type FormFieldValue = string | boolean;

/**
 * One on-screen input. A field may own several widgets (e.g. a radio group has
 * one widget per option, possibly across pages), so this is per-WIDGET while
 * the value in the store is per-FIELD (shared by `fieldName`).
 */
export interface FormFieldWidget {
	/** Unique per widget (for `{#each}` keys). */
	id: string;
	/** Fully-qualified AcroForm field name — the key into the value store. */
	fieldName: string;
	type: FormFieldType;
	/** 0-based page the widget sits on. */
	pageIndex: number;
	/** Widget rectangle in PDF points; (x, y) = bottom-left corner. */
	rect: { x: number; y: number; width: number; height: number };
	/** radio only: the export/"on" value this particular widget selects. */
	optionValue?: string;
	/** text only. */
	multiline?: boolean;
	/** text only — comb fields (one cell per character); still usable as a plain field. */
	comb?: boolean;
	/** text only — character cap, if the field declares one. */
	maxLength?: number;
	/** radio / dropdown / optionlist: the selectable options. */
	options?: string[];
	/** Field is declared read-only — we show it but disable editing. */
	readOnly?: boolean;
}

export interface DetectResult {
	widgets: FormFieldWidget[];
	/** Initial value per field name, read from the PDF. */
	values: Record<string, FormFieldValue>;
}

/** Normalize a widget rect to bottom-left origin with positive extents. */
function normalizeRect(r: { x: number; y: number; width: number; height: number }) {
	return {
		x: Math.min(r.x, r.x + r.width),
		y: Math.min(r.y, r.y + r.height),
		width: Math.abs(r.width),
		height: Math.abs(r.height)
	};
}

/**
 * Resolve which page a widget lives on. Prefer the widget's own `/P` page
 * reference (set by well-formed producers); fall back to scanning every page's
 * `/Annots` for the widget's dict when `/P` is absent.
 */
function pageIndexOfWidget(
	doc: PDFDocument,
	widget: PDFWidgetAnnotation,
	pageByRefTag: Map<string, number>
): number {
	const p = widget.P();
	if (p) {
		const idx = pageByRefTag.get(p.tag);
		if (idx !== undefined) return idx;
	}
	const pages = doc.getPages();
	for (let i = 0; i < pages.length; i++) {
		const annots = pages[i].node.Annots();
		if (!annots) continue;
		for (let j = 0; j < annots.size(); j++) {
			const el = annots.get(j);
			const dict = el instanceof PDFRef ? doc.context.lookup(el) : el;
			if (dict === widget.dict) return i;
		}
	}
	return 0; // last resort: assume the first page rather than dropping the field
}

/**
 * Load `bytes` with pdf-lib and enumerate every fillable form field + its
 * current value. Returns empty arrays when the PDF has no AcroForm. Never
 * mutates anything; this document is thrown away (saving reloads the original).
 */
export async function detectFormFields(bytes: Uint8Array): Promise<DetectResult> {
	const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
	const form = doc.getForm();
	const fields = form.getFields();
	if (fields.length === 0) return { widgets: [], values: {} };

	const pageByRefTag = new Map<string, number>();
	doc.getPages().forEach((page, i) => pageByRefTag.set(page.ref.tag, i));

	const widgets: FormFieldWidget[] = [];
	const values: Record<string, FormFieldValue> = {};

	for (const field of fields) {
		const name = field.getName();
		const readOnly = field.isReadOnly();

		let type: FormFieldType;
		let options: string[] | undefined;
		let multiline = false;
		let comb = false;
		let maxLength: number | undefined;

		if (field instanceof PDFTextField) {
			type = 'text';
			multiline = field.isMultiline();
			comb = field.isCombed();
			maxLength = field.getMaxLength();
			values[name] = field.getText() ?? '';
		} else if (field instanceof PDFCheckBox) {
			type = 'checkbox';
			values[name] = field.isChecked();
		} else if (field instanceof PDFRadioGroup) {
			type = 'radio';
			options = field.getOptions();
			values[name] = field.getSelected() ?? '';
		} else if (field instanceof PDFDropdown) {
			type = 'dropdown';
			options = field.getOptions();
			values[name] = field.getSelected()[0] ?? '';
		} else if (field instanceof PDFOptionList) {
			type = 'optionlist';
			options = field.getOptions();
			values[name] = field.getSelected()[0] ?? '';
		} else {
			// Push buttons / signature fields are not fillable here.
			continue;
		}

		const fieldWidgets = field.acroField.getWidgets();
		fieldWidgets.forEach((w, widgetIndex) => {
			const pageIndex = pageIndexOfWidget(doc, w, pageByRefTag);
			const rect = normalizeRect(w.getRectangle());
			if (rect.width <= 0 || rect.height <= 0) return; // hidden/zero-size widget

			// For radios, the per-widget option is the export value at the same
			// index as the widget: `getOptions()` and `getWidgets()` are both
			// parallel to the field's Kids/Opt arrays. This is what `select()` /
			// `getSelected()` use, whereas the widget's raw on-value may just be a
			// numeric appearance-state index ("0", "1") that does NOT match.
			let optionValue: string | undefined;
			if (type === 'radio') {
				optionValue = options?.[widgetIndex];
				if (optionValue === undefined) {
					const on = w.getOnValue();
					optionValue = on ? on.decodeText() : undefined;
				}
			}

			widgets.push({
				id: `fld_${widgets.length}_${name}`,
				fieldName: name,
				type,
				pageIndex,
				rect,
				optionValue,
				multiline,
				comb,
				maxLength,
				options,
				readOnly
			});
		});
	}

	return { widgets, values };
}

/**
 * Write `values` into the form of an already-loaded pdf-lib document. Each
 * field is set according to its type; a bad option name or an unfillable field
 * is skipped rather than aborting the whole save.
 */
export function applyFormValues(doc: PDFDocument, values: Record<string, FormFieldValue>): void {
	const form = doc.getForm();
	for (const field of form.getFields()) {
		const name = field.getName();
		if (!(name in values)) continue;
		const v = values[name];
		try {
			if (field instanceof PDFTextField) {
				field.setText(typeof v === 'string' ? v : '');
			} else if (field instanceof PDFCheckBox) {
				if (v === true) field.check();
				else field.uncheck();
			} else if (field instanceof PDFRadioGroup) {
				const s = typeof v === 'string' ? v : '';
				if (s) field.select(s);
				else field.clear();
			} else if (field instanceof PDFDropdown) {
				const s = typeof v === 'string' ? v : '';
				if (s) field.select(s);
				else field.clear();
			} else if (field instanceof PDFOptionList) {
				const s = typeof v === 'string' ? v : '';
				if (s) field.select(s);
				else field.clear();
			}
		} catch {
			// Invalid option, mismatched type, or appearance-generation hiccup on
			// one field must not sink the others.
		}
	}
}
