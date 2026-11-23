/**
 * Locale store + translator (Svelte 5 runes). Lightweight, no dependency: a
 * single `$state` holding the active locale and a `t()` that reads it, so every
 * template / `$derived` that calls `t()` re-renders instantly when the locale
 * changes — no page reload.
 *
 * Italian (`it.ts`) is the authoritative source; a key missing from English
 * falls back to Italian, then to the raw key. The choice persists in
 * localStorage under `pdfmoddy.locale.v1` (every access guarded, so private
 * mode / quota / SSR-prerender never throw). Default: Italian.
 */
import { it, type MessageKey } from './it';
import { en } from './en';

export type Locale = 'it' | 'en';

const STORAGE_KEY = 'pdfmoddy.locale.v1';
const DICTS: Record<Locale, Record<MessageKey, string>> = { it, en };

function loadSaved(): Locale {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === 'it' || v === 'en') return v;
	} catch {
		// localStorage unavailable (SSR prerender / private mode) — use default.
	}
	return 'it';
}

class LocaleStore {
	/** Active locale. Reactive: reading it in a template/`$derived` tracks it. */
	current = $state<Locale>(loadSaved());

	set(locale: Locale): void {
		this.current = locale;
		try {
			localStorage.setItem(STORAGE_KEY, locale);
		} catch {
			// Persistence is best-effort; the in-memory switch still works.
		}
	}

	toggle(): void {
		this.set(this.current === 'it' ? 'en' : 'it');
	}
}

export const locale = new LocaleStore();

/**
 * Translate a key for the active locale, interpolating `{name}` placeholders
 * from `params`. Reading `locale.current` here is what makes callers reactive.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
	const dict = DICTS[locale.current];
	let s: string = dict[key] ?? it[key] ?? key;
	if (params) {
		for (const name in params) {
			s = s.split(`{${name}}`).join(String(params[name]));
		}
	}
	return s;
}
