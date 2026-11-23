/**
 * Reactive store for the detected AcroForm fields (Svelte 5 runes).
 *
 * Mirrors the shape of `annotations.svelte.ts`: a singleton with `$state`
 * holding the enumerated widgets and the per-field values the user edits. The
 * pure detection / write logic lives in `forms.ts`; this file only holds the
 * live, mutable state the UI binds to.
 *
 * Values are keyed by FIELD name (not widget id) so that every widget of the
 * same field — e.g. the options of a radio group — shares one value.
 */
import type { FormFieldValue, FormFieldWidget } from './forms';

class FormFieldStore {
	/** Every fillable widget across all pages. */
	widgets = $state<FormFieldWidget[]>([]);
	/** Current value per field name (string, or boolean for checkboxes). */
	values = $state<Record<string, FormFieldValue>>({});
	/**
	 * Whether "Salva PDF" should flatten the form (values become fixed, no longer
	 * editable). Defaults to true — most people want a final, non-editable PDF —
	 * and is reset on each new document.
	 */
	flatten = $state(true);

	/** True when the open PDF actually carries an interactive form. */
	get hasForm(): boolean {
		return this.widgets.length > 0;
	}

	/** Number of distinct fields (not widgets) — what the indicator shows. */
	get fieldCount(): number {
		return new Set(this.widgets.map((w) => w.fieldName)).size;
	}

	/** Widgets on one page (0-based), for that page's overlay to render. */
	forPage(pageIndex: number): FormFieldWidget[] {
		return this.widgets.filter((w) => w.pageIndex === pageIndex);
	}

	setValue(fieldName: string, value: FormFieldValue): void {
		this.values[fieldName] = value;
	}

	/** Install a freshly detected form (replaces whatever was there). */
	load(widgets: FormFieldWidget[], values: Record<string, FormFieldValue>): void {
		this.widgets = widgets;
		this.values = values;
		this.flatten = true;
	}

	clear(): void {
		this.widgets = [];
		this.values = {};
		this.flatten = true;
	}
}

/** Singleton shared by the viewer and every page overlay. */
export const formFields = new FormFieldStore();
