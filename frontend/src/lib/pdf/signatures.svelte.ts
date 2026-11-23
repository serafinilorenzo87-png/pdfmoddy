/**
 * Reusable signature library (Svelte 5 runes).
 *
 * Signatures the user creates (hand-drawn or a rasterized cursive name) are
 * saved here and can be reused across documents and across app restarts. For
 * v1 we persist to the webview's `localStorage`, which survives WebView2
 * restarts; every access is wrapped in try/catch so a private/blocked/quota'd
 * store never breaks the app (it just behaves as an empty, in-memory library).
 *
 * Each entry is a small record: id, a human label, the PNG data URL, and the
 * aspect ratio used to keep placements proportional. This is library state,
 * separate from the per-document `annotations` store — it is intentionally NOT
 * cleared when a new PDF is opened.
 */

export interface SavedSignature {
	id: string;
	/** User-facing label, e.g. a name or "Firma 1". */
	label: string;
	/** PNG data URL (transparent background, black stroke). */
	pngDataUrl: string;
	/** Natural aspect ratio (width / height). */
	aspect: number;
}

const STORAGE_KEY = 'pdfmoddy.signatures.v1';

let idCounter = 0;
function nextId(): string {
	idCounter += 1;
	return `sig_${Date.now().toString(36)}_${idCounter}`;
}

function isValidEntry(x: unknown): x is SavedSignature {
	if (!x || typeof x !== 'object') return false;
	const s = x as Record<string, unknown>;
	return (
		typeof s.id === 'string' &&
		typeof s.label === 'string' &&
		typeof s.pngDataUrl === 'string' &&
		s.pngDataUrl.startsWith('data:image/') &&
		typeof s.aspect === 'number' &&
		Number.isFinite(s.aspect) &&
		s.aspect > 0
	);
}

class SignatureStore {
	/** Saved signatures, most-recent last. */
	items = $state<SavedSignature[]>([]);
	/** Which saved signature is armed for placement, or null. */
	selectedId = $state<string | null>(null);

	constructor() {
		this.#load();
	}

	#load(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				this.items = parsed.filter(isValidEntry);
			}
		} catch {
			// localStorage unavailable / corrupt JSON — start empty.
		}
	}

	#persist(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
		} catch {
			// Quota exceeded / unavailable — keep the in-memory copy, skip persist.
		}
	}

	/** Save a new signature and arm it for placement; returns its id. */
	add(sig: Omit<SavedSignature, 'id'>): string {
		const id = nextId();
		this.items.push({ id, ...sig });
		this.selectedId = id;
		this.#persist();
		return id;
	}

	remove(id: string): void {
		const i = this.items.findIndex((s) => s.id === id);
		if (i !== -1) this.items.splice(i, 1);
		if (this.selectedId === id) this.selectedId = null;
		this.#persist();
	}

	get(id: string | null): SavedSignature | undefined {
		if (!id) return undefined;
		return this.items.find((s) => s.id === id);
	}
}

/** Singleton signature library shared by the toolbar and page overlays. */
export const signatures = new SignatureStore();
