<!--
	"Acquisisci firma" — import a signature into the library from an existing
	file, three sources (all fully offline, no network / no external engine):

	  • PDF   — render a page and drag a box around the signature (coarse crop).
	  • Immagine — pick a PNG/JPG/… scan or photo.
	  • Word/ODT — a .docx/.odt is a ZIP of embedded images; pick one. (No page
	    rendering: only inserted images, not typed text.)

	Each source yields a raw canvas that is handed to <SignatureEditor> for
	zoom / pan framing, background knockout and (for PDF) form-line removal. The
	editor returns a tight transparent PNG, so every acquired signature flows
	into the SAME library + baking path as the drawn / cursive ones.
-->
<script lang="ts">
	import { openFileDialog, readFileBytes, loadPdfDocument, type LoadedPdf } from './viewer';
	import {
		loadImageToCanvas,
		cropCanvas,
		extractOfficeImages,
		bytesToDataUrl,
		imageMimeForName,
		IMAGE_EXTENSIONS,
		type ExtractedImage
	} from './signatureImage';
	import SignatureEditor from './SignatureEditor.svelte';

	let {
		onsave,
		ondone
	}: {
		onsave: (sig: { label: string; pngDataUrl: string; aspect: number }) => void;
		ondone: () => void;
	} = $props();

	type Source = 'pdf' | 'image' | 'word';
	let source = $state<Source | null>(null);
	let busy = $state(false);
	let message = $state('');

	// The acquired raw canvas, handed to the editor once set.
	let staged = $state<HTMLCanvasElement | null>(null);

	// ── PDF source ─────────────────────────────────────────────────────────────
	let pdf = $state<LoadedPdf | null>(null);
	let pageIndex = $state(0);
	let pdfCanvasEl = $state<HTMLCanvasElement | null>(null);
	let sel = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	let selecting = false;

	// ── Word/ODT source ──────────────────────────────────────────────────────
	let officeImages = $state<ExtractedImage[]>([]);

	function resetAll() {
		source = null;
		staged = null;
		pdf = null;
		pageIndex = 0;
		sel = null;
		officeImages = [];
		message = '';
	}

	function handleEditorSave(sig: { label: string; pngDataUrl: string; aspect: number }) {
		onsave(sig);
		resetAll();
		ondone();
	}

	// ── Image import ───────────────────────────────────────────────────────────
	async function pickImage() {
		message = '';
		try {
			const picked = await openFileDialog([{ name: 'Immagini', extensions: IMAGE_EXTENSIONS }]);
			if (!picked) return;
			busy = true;
			const mime = imageMimeForName(picked.name);
			if (!mime) {
				message = 'Formato immagine non supportato.';
				return;
			}
			const bytes = await readFileBytes(picked.path);
			staged = await loadImageToCanvas(bytesToDataUrl(bytes, mime));
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// ── Word/ODT import ──────────────────────────────────────────────────────
	async function pickOffice() {
		message = '';
		try {
			const picked = await openFileDialog([{ name: 'Documenti', extensions: ['docx', 'odt'] }]);
			if (!picked) return;
			busy = true;
			const bytes = await readFileBytes(picked.path);
			officeImages = extractOfficeImages(bytes);
			staged = null;
			if (officeImages.length === 0) {
				message = 'Nessuna immagine incorporata trovata nel documento.';
			}
		} catch {
			message = 'Documento non leggibile (serve un .docx o .odt valido).';
		} finally {
			busy = false;
		}
	}

	async function chooseOfficeImage(img: ExtractedImage) {
		message = '';
		try {
			busy = true;
			staged = await loadImageToCanvas(img.dataUrl);
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// ── PDF import ─────────────────────────────────────────────────────────────
	async function pickPdf() {
		message = '';
		try {
			const picked = await openFileDialog([{ name: 'PDF', extensions: ['pdf'] }]);
			if (!picked) return;
			busy = true;
			pdf = await loadPdfDocument(picked.path);
			pageIndex = 0;
			sel = null;
			staged = null;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// Render the current PDF page into the modal canvas (fit to a sane width).
	$effect(() => {
		const doc = pdf;
		const idx = pageIndex;
		const el = pdfCanvasEl;
		if (!doc || !el || staged) return;
		let cancelled = false;
		(async () => {
			const page = await doc.pdf.getPage(idx + 1);
			const base = page.getViewport({ scale: 1 });
			const fit = Math.min(1.6, 560 / base.width);
			const vp = page.getViewport({ scale: fit });
			if (cancelled) return;
			el.width = Math.floor(vp.width);
			el.height = Math.floor(vp.height);
			const ctx = el.getContext('2d');
			if (!ctx) return;
			await page.render({ canvasContext: ctx, viewport: vp }).promise;
		})();
		return () => {
			cancelled = true;
		};
	});

	function selRectCss(): { left: number; top: number; width: number; height: number } | null {
		if (!sel) return null;
		return {
			left: Math.min(sel.x0, sel.x1),
			top: Math.min(sel.y0, sel.y1),
			width: Math.abs(sel.x1 - sel.x0),
			height: Math.abs(sel.y1 - sel.y0)
		};
	}

	function onPdfPointerDown(e: PointerEvent) {
		if (!pdfCanvasEl) return;
		const rect = pdfCanvasEl.getBoundingClientRect();
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		selecting = true;
		sel = {
			x0: e.clientX - rect.left,
			y0: e.clientY - rect.top,
			x1: e.clientX - rect.left,
			y1: e.clientY - rect.top
		};
	}
	function onPdfPointerMove(e: PointerEvent) {
		if (!selecting || !sel || !pdfCanvasEl) return;
		const rect = pdfCanvasEl.getBoundingClientRect();
		sel = { ...sel, x1: e.clientX - rect.left, y1: e.clientY - rect.top };
	}
	function onPdfPointerUp(e: PointerEvent) {
		if (!selecting || !sel || !pdfCanvasEl) return;
		selecting = false;
		(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
		const r = selRectCss();
		if (!r || r.width < 6 || r.height < 6) {
			sel = null;
			return;
		}
		// Map the CSS-pixel selection to the canvas's own pixel grid, then crop;
		// the crop opens in the editor for refinement + line removal.
		const rect = pdfCanvasEl.getBoundingClientRect();
		const sx = pdfCanvasEl.width / rect.width;
		const sy = pdfCanvasEl.height / rect.height;
		staged = cropCanvas(pdfCanvasEl, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
	}
</script>

{#if staged}
	<SignatureEditor
		source={staged}
		allowLineRemoval={source === 'pdf'}
		onsave={handleEditorSave}
		oncancel={() => {
			staged = null;
			sel = null;
		}}
	/>
{:else if source === null}
	<p class="mb-3 text-sm text-ink-muted">Da dove vuoi prendere la firma?</p>
	<div class="grid grid-cols-3 gap-2">
		<button
			type="button"
			class="rounded border border-brand-light p-3 text-sm font-medium text-ink hover:bg-brand-light/20"
			onclick={() => (source = 'pdf')}
		>
			📄 Da un PDF
			<span class="mt-1 block text-xs font-normal text-ink-muted">ritaglia dalla pagina</span>
		</button>
		<button
			type="button"
			class="rounded border border-brand-light p-3 text-sm font-medium text-ink hover:bg-brand-light/20"
			onclick={() => (source = 'image')}
		>
			🖼️ Da un'immagine
			<span class="mt-1 block text-xs font-normal text-ink-muted">PNG / JPG / …</span>
		</button>
		<button
			type="button"
			class="rounded border border-brand-light p-3 text-sm font-medium text-ink hover:bg-brand-light/20"
			onclick={() => (source = 'word')}
		>
			📝 Da Word / ODT
			<span class="mt-1 block text-xs font-normal text-ink-muted">immagini incorporate</span>
		</button>
	</div>
{:else}
	<div class="mb-3 flex items-center gap-2">
		<button type="button" class="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink" onclick={resetAll}>
			← Cambia sorgente
		</button>
		{#if source === 'image'}
			<button
				type="button"
				disabled={busy}
				class="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
				onclick={pickImage}>Scegli immagine…</button
			>
		{:else if source === 'word'}
			<button
				type="button"
				disabled={busy}
				class="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
				onclick={pickOffice}>Scegli documento…</button
			>
		{:else}
			<button
				type="button"
				disabled={busy}
				class="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"
				onclick={pickPdf}>Scegli PDF…</button
			>
		{/if}
	</div>

	<!-- PDF: render + drag a selection rectangle -->
	{#if source === 'pdf' && pdf}
		<div class="mb-2 flex items-center gap-2 text-xs text-ink-muted">
			<span>Trascina un riquadro attorno alla firma.</span>
			{#if pdf.numPages > 1}
				<span class="ml-auto flex items-center gap-1">
					<button
						type="button"
						class="rounded border border-brand-light px-1.5 hover:bg-brand-light/20 disabled:opacity-40"
						disabled={pageIndex === 0}
						onclick={() => {
							pageIndex -= 1;
							sel = null;
						}}>‹</button
					>
					Pag. {pageIndex + 1}/{pdf.numPages}
					<button
						type="button"
						class="rounded border border-brand-light px-1.5 hover:bg-brand-light/20 disabled:opacity-40"
						disabled={pageIndex >= pdf.numPages - 1}
						onclick={() => {
							pageIndex += 1;
							sel = null;
						}}>›</button
					>
				</span>
			{/if}
		</div>
		<div class="relative inline-block max-h-80 overflow-auto rounded border border-brand-light">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<canvas
				bind:this={pdfCanvasEl}
				class="block cursor-crosshair touch-none select-none"
				onpointerdown={onPdfPointerDown}
				onpointermove={onPdfPointerMove}
				onpointerup={onPdfPointerUp}
			></canvas>
			{#if selRectCss()}
				{@const r = selRectCss()}
				<div
					class="pointer-events-none absolute border-2 border-brand bg-brand/10"
					style:left="{r?.left}px"
					style:top="{r?.top}px"
					style:width="{r?.width}px"
					style:height="{r?.height}px"
				></div>
			{/if}
		</div>
	{/if}

	<!-- Word/ODT: grid of embedded images -->
	{#if source === 'word' && officeImages.length > 0}
		<p class="mb-2 text-xs text-ink-muted">Scegli l'immagine della firma:</p>
		<div class="grid max-h-56 grid-cols-4 gap-2 overflow-auto">
			{#each officeImages as img, i (img.name + i)}
				<button
					type="button"
					class="flex items-center justify-center rounded border border-brand-light bg-white p-1 hover:border-brand"
					onclick={() => chooseOfficeImage(img)}
				>
					<img src={img.dataUrl} alt={img.name} class="max-h-16 max-w-full object-contain" />
				</button>
			{/each}
		</div>
	{/if}

	{#if message}
		<p class="mt-2 text-sm text-brand-dark">{message}</p>
	{/if}
{/if}
