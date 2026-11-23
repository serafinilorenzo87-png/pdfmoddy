<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import {
		openPdfDialog,
		loadPdfDocument,
		savePdfBytes,
		saveDocxDialog,
		pickSofficeDialog,
		convertPdfToDocx,
		LIBREOFFICE_NOT_FOUND,
		type LoadedPdf
	} from '$lib/pdf/viewer';
	import { bakeAnnotations } from '$lib/pdf/bake';
	import { annotations } from '$lib/pdf/annotations.svelte';
	import { signatures } from '$lib/pdf/signatures.svelte';
	import { formFields } from '$lib/pdf/formfields.svelte';
	import { detectFormFields } from '$lib/pdf/forms';
	import { FONTS } from '$lib/pdf/fonts';
	import { locale, t } from '$lib/i18n/locale.svelte';
	import PdfPage from '$lib/pdf/PdfPage.svelte';
	import SignatureModal from '$lib/pdf/SignatureModal.svelte';

	let loaded = $state<LoadedPdf | null>(null);
	let fileName = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	// Reactive save confirmation (so it re-translates on a language switch).
	let saved = $state(false);
	let sigModalOpen = $state(false);
	const scale = 1.5;

	// ── Word export (LibreOffice) ─────────────────────────────────────────────
	const SOFFICE_KEY = 'pdfmoddy.soffice.v1';
	function loadSoffice(): string | null {
		try {
			return localStorage.getItem(SOFFICE_KEY);
		} catch {
			return null;
		}
	}
	function saveSoffice(path: string): void {
		try {
			localStorage.setItem(SOFFICE_KEY, path);
		} catch {
			// best-effort; export still works this session with the path in memory
		}
	}
	let exporting = $state(false);
	let exported = $state(false);
	let needLibre = $state(false);
	let sofficePath = $state<string | null>(loadSoffice());

	const selected = $derived(
		annotations.selectedId ? annotations.get(annotations.selectedId) : undefined
	);
	// Show the text style toolbar while placing OR when a text box is selected.
	const showTextStyle = $derived(annotations.tool === 'text' || selected?.type === 'text');
	const showSymbolStyle = $derived(annotations.tool === 'symbol' || selected?.type === 'symbol');
	function symbolActive(sym: 'check' | 'cross'): boolean {
		return annotations.tool === 'symbol' && annotations.symbolDefaults.symbol === sym;
	}

	/**
	 * Load a PDF from an absolute path into the viewer. Shared by the "Apri PDF"
	 * dialog and the file-association launch (Windows "Open with" / default app).
	 */
	async function loadPath(path: string, name?: string) {
		error = '';
		saved = false;
		exported = false;
		needLibre = false;
		try {
			loading = true;
			const doc = await loadPdfDocument(path);
			annotations.clear(); // fresh document, fresh overlay
			formFields.clear();
			loaded = doc;
			fileName = name ?? path.split(/[\\/]/).pop() ?? path;
			// Detect existing AcroForm fields so they become directly fillable.
			// A malformed form must not block opening the document for overlay use.
			try {
				const { widgets, values } = await detectFormFields(doc.bytes);
				formFields.load(widgets, values);
			} catch {
				formFields.clear();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function openPdf() {
		error = '';
		const picked = await openPdfDialog();
		if (!picked) return;
		await loadPath(picked.path, picked.name);
	}

	// File-association entry points. On startup, open the PDF this instance was
	// launched with (if any); while running, a second "Open with" arrives as an
	// "open-file" event from the single-instance plugin (window already raised
	// by Rust). Both reuse the exact same load path as the dialog.
	onMount(() => {
		let unlisten: (() => void) | undefined;
		(async () => {
			try {
				const launchPath = await invoke<string | null>('get_launch_file');
				if (launchPath) await loadPath(launchPath);
			} catch {
				// Not running under Tauri (plain browser dev) — nothing to open.
			}
			try {
				unlisten = await listen<string>('open-file', (e) => {
					if (e.payload) loadPath(e.payload);
				});
			} catch {
				// Event system unavailable — dialog opening still works.
			}
		})();
		return () => unlisten?.();
	});

	function addText() {
		if (!loaded) return;
		annotations.tool = annotations.tool === 'text' ? 'none' : 'text';
	}

	function toggleSignature() {
		if (!loaded) return;
		if (annotations.tool === 'signature') {
			annotations.tool = 'none';
			return;
		}
		annotations.tool = 'signature';
		// No signatures yet → jump straight to creating one.
		if (signatures.items.length === 0) sigModalOpen = true;
	}

	function onSignatureSaved(sig: { label: string; pngDataUrl: string; aspect: number }) {
		signatures.add(sig); // also arms it (sets selectedId)
		sigModalOpen = false;
		annotations.tool = 'signature';
	}

	function pickSymbol(sym: 'check' | 'cross') {
		if (!loaded) return;
		// Click the already-active variant to leave the mode.
		if (annotations.tool === 'symbol' && annotations.symbolDefaults.symbol === sym) {
			annotations.tool = 'none';
			return;
		}
		annotations.setSymbolStyle({ symbol: sym });
		annotations.tool = 'symbol';
	}

	async function savePdf() {
		if (!loaded) return;
		error = '';
		saved = false;
		exported = false;
		try {
			saving = true;
			const outBytes = await bakeAnnotations(
				loaded.bytes,
				annotations.items,
				formFields.hasForm ? formFields.values : undefined,
				formFields.hasForm && formFields.flatten
			);
			const suggested = fileName.replace(/\.pdf$/i, '') + '-compilato.pdf';
			saved = await savePdfBytes(outBytes, suggested);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	/** Bake the current PDF (same bytes as "Salva PDF") and convert it to .docx. */
	async function exportWord() {
		if (!loaded) return;
		error = '';
		saved = false;
		exported = false;
		needLibre = false;
		try {
			exporting = true;
			// Same "final" bytes as Save PDF: overlay + form values + flatten toggle,
			// so the Word file includes the signatures / filled fields.
			const outBytes = await bakeAnnotations(
				loaded.bytes,
				annotations.items,
				formFields.hasForm ? formFields.values : undefined,
				formFields.hasForm && formFields.flatten
			);
			const suggested = fileName.replace(/\.pdf$/i, '') + '.docx';
			const outPath = await saveDocxDialog(suggested);
			if (!outPath) return; // user cancelled the save dialog
			await convertPdfToDocx(outBytes, outPath, sofficePath);
			exported = true;
		} catch (e) {
			const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
			if (msg.includes(LIBREOFFICE_NOT_FOUND)) needLibre = true;
			else error = t('export.failed', { err: msg });
		} finally {
			exporting = false;
		}
	}

	/** Let the user point at soffice.exe, remember it, and retry the export. */
	async function locateSoffice() {
		const picked = await pickSofficeDialog();
		if (!picked) return;
		sofficePath = picked;
		saveSoffice(picked);
		needLibre = false;
		await exportWord();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		// The modal owns Escape while it's open (closes the dialog, not the tool).
		if (e.key === 'Escape' && !sigModalOpen) annotations.tool = 'none';
	}}
/>

<header
	class="flex flex-wrap items-center gap-3 border-b border-brand-dark/30 bg-brand px-4 py-2 text-white shadow-sm"
>
	<span class="select-none text-lg font-bold tracking-tight">PdfModdy</span>

	<!-- Language switch: inline-SVG flags (crisp at any size, unlike emoji). -->
	<div class="flex items-center gap-1" role="group" aria-label="Lingua / Language">
		<button
			type="button"
			onclick={() => locale.set('it')}
			aria-pressed={locale.current === 'it'}
			title={t('lang.switchToIt')}
			aria-label={t('lang.it')}
			class="overflow-hidden rounded-sm border transition-all {locale.current === 'it'
				? 'border-white ring-2 ring-white'
				: 'border-white/40 opacity-60 hover:opacity-100'}"
		>
			<svg viewBox="0 0 3 2" width="26" height="17" class="block">
				<rect width="1" height="2" x="0" fill="#009246" />
				<rect width="1" height="2" x="1" fill="#ffffff" />
				<rect width="1" height="2" x="2" fill="#ce2b37" />
			</svg>
		</button>
		<button
			type="button"
			onclick={() => locale.set('en')}
			aria-pressed={locale.current === 'en'}
			title={t('lang.switchToEn')}
			aria-label={t('lang.en')}
			class="overflow-hidden rounded-sm border transition-all {locale.current === 'en'
				? 'border-white ring-2 ring-white'
				: 'border-white/40 opacity-60 hover:opacity-100'}"
		>
			<svg viewBox="0 0 60 30" width="34" height="17" class="block">
				<clipPath id="uk-flag-clip"><rect width="60" height="30" /></clipPath>
				<g clip-path="url(#uk-flag-clip)">
					<rect width="60" height="30" fill="#012169" />
					<path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" stroke-width="6" />
					<path
						d="M0,0 L60,30 M60,0 L0,30"
						clip-path="url(#uk-flag-clip)"
						stroke="#c8102e"
						stroke-width="4"
					/>
					<path d="M30,0 V30 M0,15 H60" stroke="#ffffff" stroke-width="10" />
					<path d="M30,0 V30 M0,15 H60" stroke="#c8102e" stroke-width="6" />
				</g>
			</svg>
		</button>
	</div>

	<button
		onclick={openPdf}
		class="rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25 active:bg-white/30"
	>
		{t('open.button')}
	</button>

	{#if loaded}
		<button
			onclick={addText}
			class={annotations.tool === 'text'
				? 'rounded bg-white px-3 py-1.5 text-sm font-medium text-brand transition-colors'
				: 'rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
		>
			{annotations.tool === 'text' ? t('text.done') : t('text.add')}
		</button>

		<div class="flex items-center gap-1" role="group" aria-label={t('symbol.groupAria')}>
			<button
				onclick={() => pickSymbol('check')}
				aria-pressed={symbolActive('check')}
				title={t('symbol.checkTitle')}
				class={symbolActive('check')
					? 'rounded bg-white px-2.5 py-1.5 text-sm font-semibold text-brand'
					: 'rounded bg-white/15 px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
			>
				{symbolActive('check') ? t('symbol.checkDone') : t('symbol.check')}
			</button>
			<button
				onclick={() => pickSymbol('cross')}
				aria-pressed={symbolActive('cross')}
				title={t('symbol.crossTitle')}
				class={symbolActive('cross')
					? 'rounded bg-white px-2.5 py-1.5 text-sm font-semibold text-brand'
					: 'rounded bg-white/15 px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
			>
				{symbolActive('cross') ? t('symbol.crossDone') : t('symbol.cross')}
			</button>
		</div>

		<button
			onclick={toggleSignature}
			aria-pressed={annotations.tool === 'signature'}
			title={t('signature.toolTitle')}
			class={annotations.tool === 'signature'
				? 'rounded bg-white px-3 py-1.5 text-sm font-semibold text-brand transition-colors'
				: 'rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
		>
			{annotations.tool === 'signature' ? t('signature.toolDone') : t('signature.tool')}
		</button>

		<button
			onclick={savePdf}
			disabled={saving}
			class="rounded bg-white px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-white/90 disabled:opacity-60"
		>
			{saving ? t('save.saving') : t('save.button')}
		</button>

		<button
			onclick={exportWord}
			disabled={exporting}
			title={t('export.title')}
			class="rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25 disabled:opacity-60"
		>
			{exporting ? t('export.exporting') : t('export.button')}
		</button>

		{#if formFields.hasForm}
			<div
				class="flex items-center gap-2 rounded bg-white/15 px-2 py-1 text-xs font-medium"
				title={t('form.detectedTitle')}
			>
				<span>{t('form.detected', {
						n: formFields.fieldCount,
						unit: formFields.fieldCount === 1 ? t('form.unitOne') : t('form.unitMany')
					})}</span>
				<label class="flex items-center gap-1" title={t('form.flattenTitle')}>
					<input type="checkbox" bind:checked={formFields.flatten} class="accent-brand" />
					{t('form.flatten')}
				</label>
			</div>
		{/if}

		{#if showTextStyle}
			{@const style = annotations.activeTextStyle}
			<div class="ml-1 flex items-center gap-2 rounded bg-white/10 px-2 py-1 text-xs">
				<label class="flex items-center gap-1">
					{t('style.font')}
					<select
						value={style.font}
						onchange={(e) => annotations.setTextStyle({ font: e.currentTarget.value as typeof style.font })}
						class="rounded bg-white px-1 py-0.5 text-ink"
					>
						{#each FONTS as f (f.key)}
							<option value={f.key}>{f.label}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center gap-1">
					{t('style.size')}
					<input
						type="number"
						min="6"
						max="96"
						value={style.fontSize}
						oninput={(e) => annotations.setTextStyle({ fontSize: Number(e.currentTarget.value) || style.fontSize })}
						class="w-14 rounded bg-white px-1 py-0.5 text-ink"
					/>
				</label>
				<label class="flex items-center gap-1">
					{t('style.color')}
					<input
						type="color"
						value={style.color}
						oninput={(e) => annotations.setTextStyle({ color: e.currentTarget.value })}
						class="h-6 w-7 rounded bg-white"
					/>
				</label>
			</div>
		{/if}

		{#if showSymbolStyle}
			{@const sym = annotations.activeSymbolStyle}
			<div class="ml-1 flex items-center gap-2 rounded bg-white/10 px-2 py-1 text-xs">
				<label class="flex items-center gap-1">
					{t('style.symbolColor')}
					<input
						type="color"
						value={sym.color}
						oninput={(e) => annotations.setSymbolStyle({ color: e.currentTarget.value })}
						class="h-6 w-7 rounded bg-white"
					/>
				</label>
			</div>
		{/if}

		{#if annotations.tool === 'signature'}
			<div class="basis-full"></div>
			<div class="flex w-full flex-wrap items-center gap-2 rounded bg-white/10 px-2 py-2 text-xs">
				<span class="font-medium text-white/90">
					{signatures.items.length === 0 ? t('signature.none') : t('signature.choose')}
				</span>
				{#each signatures.items as sig (sig.id)}
					{@const active = signatures.selectedId === sig.id}
					<div
						class="group relative flex items-center gap-1 rounded border bg-white p-1"
						class:border-brand-dark={active}
						class:border-white={!active}
					>
						<button
							type="button"
							title={sig.label}
							aria-pressed={active}
							onclick={() => (signatures.selectedId = sig.id)}
							class="flex items-center gap-1.5"
						>
							<img src={sig.pngDataUrl} alt={sig.label} class="h-7 max-w-24 object-contain" />
							<span class="max-w-28 truncate text-ink">{sig.label}</span>
						</button>
						<button
							type="button"
							aria-label={t('signature.deleteAria')}
							title={t('signature.deleteTitle')}
							onclick={() => signatures.remove(sig.id)}
							class="rounded px-1 text-ink-muted hover:bg-brand/10 hover:text-brand">✕</button
						>
					</div>
				{/each}
				<button
					type="button"
					onclick={() => (sigModalOpen = true)}
					class="rounded bg-white px-2.5 py-1 font-medium text-brand hover:bg-white/90"
				>
					{t('signature.new')}
				</button>
			</div>
		{/if}
	{/if}

	{#if fileName}
		{@const pages = loaded?.numPages ?? 0}
		<span class="truncate text-sm text-white/80">
			{t('file.info', {
				name: fileName,
				n: pages,
				unit: pages === 1 ? t('file.pageOne') : t('file.pageMany')
			})}
		</span>
	{/if}
	{#if loading}
		<span class="text-sm text-white/80">{t('app.loading')}</span>
	{/if}
	{#if saved}
		<span class="text-sm text-white/90">{t('save.done')}</span>
	{/if}
	{#if exported}
		<span class="text-sm text-white/90">{t('export.done')}</span>
	{/if}
</header>

{#if needLibre}
	<div
		class="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-ink"
	>
		<span>⚠️ {t('export.needLibre')}</span>
		<button
			onclick={locateSoffice}
			class="rounded bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
		>
			{t('export.locate')}
		</button>
		<button
			onclick={() => (needLibre = false)}
			aria-label={t('common.close')}
			class="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink">✕</button
		>
	</div>
{/if}

{#if error}
	<div class="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-brand-dark">
		{error}
	</div>
{/if}

<main class="relative flex-1 overflow-auto bg-canvas">
	{#if !loaded && !loading}
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-ink-muted"
		>
			<p class="text-lg font-medium text-ink">{t('empty.title')}</p>
			<p class="mt-1 text-sm">
				{t('empty.hintBefore')}<span class="font-semibold text-brand">{t('open.button')}</span>{t('empty.hintAfter')}
			</p>
		</div>
	{/if}

	{#if loaded}
		<div class="flex flex-col items-center px-4 pb-8">
			{#each Array(loaded.numPages) as _, i (i)}
				<PdfPage {loaded} pageIndex={i} {scale} />
			{/each}
		</div>
	{/if}
</main>

<SignatureModal open={sigModalOpen} onsave={onSignatureSaved} onclose={() => (sigModalOpen = false)} />
