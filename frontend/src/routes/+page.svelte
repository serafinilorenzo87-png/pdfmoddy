<script lang="ts">
	import { openPdfDialog, loadPdfDocument, savePdfBytes, type LoadedPdf } from '$lib/pdf/viewer';
	import { bakeAnnotations } from '$lib/pdf/bake';
	import { annotations } from '$lib/pdf/annotations.svelte';
	import { signatures } from '$lib/pdf/signatures.svelte';
	import { FONTS } from '$lib/pdf/fonts';
	import PdfPage from '$lib/pdf/PdfPage.svelte';
	import SignatureModal from '$lib/pdf/SignatureModal.svelte';

	let loaded = $state<LoadedPdf | null>(null);
	let fileName = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let status = $state('');
	let sigModalOpen = $state(false);
	const scale = 1.5;

	const selected = $derived(
		annotations.selectedId ? annotations.get(annotations.selectedId) : undefined
	);
	// Show the text style toolbar while placing OR when a text box is selected.
	const showTextStyle = $derived(annotations.tool === 'text' || selected?.type === 'text');
	const showSymbolStyle = $derived(annotations.tool === 'symbol' || selected?.type === 'symbol');
	function symbolActive(sym: 'check' | 'cross'): boolean {
		return annotations.tool === 'symbol' && annotations.symbolDefaults.symbol === sym;
	}

	async function openPdf() {
		error = '';
		status = '';
		try {
			const picked = await openPdfDialog();
			if (!picked) return;
			loading = true;
			const doc = await loadPdfDocument(picked.path);
			annotations.clear(); // fresh document, fresh overlay
			loaded = doc;
			fileName = picked.name;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

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
		status = '';
		try {
			saving = true;
			const outBytes = await bakeAnnotations(loaded.bytes, annotations.items);
			const suggested = fileName.replace(/\.pdf$/i, '') + '-compilato.pdf';
			const ok = await savePdfBytes(outBytes, suggested);
			status = ok ? 'PDF salvato.' : '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
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

	<button
		onclick={openPdf}
		class="rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25 active:bg-white/30"
	>
		Apri PDF
	</button>

	{#if loaded}
		<button
			onclick={addText}
			class={annotations.tool === 'text'
				? 'rounded bg-white px-3 py-1.5 text-sm font-medium text-brand transition-colors'
				: 'rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
		>
			{annotations.tool === 'text' ? '✓ Fine testo' : '+ Aggiungi testo'}
		</button>

		<div class="flex items-center gap-1" role="group" aria-label="Simboli">
			<button
				onclick={() => pickSymbol('check')}
				aria-pressed={symbolActive('check')}
				title="Posa spunte (V) — clicca sulle caselle"
				class={symbolActive('check')
					? 'rounded bg-white px-2.5 py-1.5 text-sm font-semibold text-brand'
					: 'rounded bg-white/15 px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
			>
				{symbolActive('check') ? '✓ Fine' : '✓ Spunta'}
			</button>
			<button
				onclick={() => pickSymbol('cross')}
				aria-pressed={symbolActive('cross')}
				title="Posa croci (X) — clicca sulle caselle"
				class={symbolActive('cross')
					? 'rounded bg-white px-2.5 py-1.5 text-sm font-semibold text-brand'
					: 'rounded bg-white/15 px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
			>
				{symbolActive('cross') ? '✕ Fine' : '✕ Croce'}
			</button>
		</div>

		<button
			onclick={toggleSignature}
			aria-pressed={annotations.tool === 'signature'}
			title="Firma — scegli una firma dalla libreria e clicca sul PDF"
			class={annotations.tool === 'signature'
				? 'rounded bg-white px-3 py-1.5 text-sm font-semibold text-brand transition-colors'
				: 'rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25'}
		>
			{annotations.tool === 'signature' ? '✓ Fine firma' : '✒ Firma'}
		</button>

		<button
			onclick={savePdf}
			disabled={saving}
			class="rounded bg-white px-3 py-1.5 text-sm font-semibold text-brand transition-colors hover:bg-white/90 disabled:opacity-60"
		>
			{saving ? 'Salvo…' : 'Salva PDF'}
		</button>

		{#if showTextStyle}
			{@const style = annotations.activeTextStyle}
			<div class="ml-1 flex items-center gap-2 rounded bg-white/10 px-2 py-1 text-xs">
				<label class="flex items-center gap-1">
					Font
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
					Corpo
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
					Colore
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
					Colore simbolo
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
					{signatures.items.length === 0
						? 'Nessuna firma salvata.'
						: 'Scegli una firma, poi clicca sul PDF:'}
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
							aria-label="Elimina firma"
							title="Elimina dalla libreria"
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
					+ Nuova firma
				</button>
			</div>
		{/if}
	{/if}

	{#if fileName}
		<span class="truncate text-sm text-white/80">{fileName} · {loaded?.numPages ?? 0} pagine</span>
	{/if}
	{#if loading}
		<span class="text-sm text-white/80">Carico…</span>
	{/if}
	{#if status}
		<span class="text-sm text-white/90">{status}</span>
	{/if}
</header>

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
			<p class="text-lg font-medium text-ink">Nessun PDF aperto</p>
			<p class="mt-1 text-sm">
				Clicca <span class="font-semibold text-brand">Apri PDF</span> per iniziare.
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
