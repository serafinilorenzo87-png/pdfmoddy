<!--
	Interactive signature editor — the last step before a signature enters the
	library, shared by all "acquire" sources (image / PDF crop / Office image).

	Left: a fixed frame showing the raw source; the user zooms (slider / wheel)
	and pans (drag) to frame the signature. What's inside the frame is the crop.
	Right: a LIVE preview of the finished result with the background knocked out
	(adjustable threshold) and, when enabled, the form's horizontal line removed.
	Output is always a tight, transparent PNG (same format + baking as the rest).
-->
<script lang="ts">
	import { finalizeAcquired } from './signatureImage';

	let {
		source,
		allowLineRemoval = false,
		onsave,
		oncancel
	}: {
		source: HTMLCanvasElement;
		allowLineRemoval?: boolean;
		onsave: (sig: { label: string; pngDataUrl: string; aspect: number }) => void;
		oncancel: () => void;
	} = $props();

	const FRAME_W = 440;
	const FRAME_H = 260;
	const RENDER_SCALE = 2; // supersample the output for crisper ink
	const MIN_ZOOM = 0.05;
	const MAX_ZOOM = 8;

	let frameEl = $state<HTMLCanvasElement | null>(null);
	let scale = $state(1);
	let ox = $state(0);
	let oy = $state(0);
	let removeBackground = $state(true);
	let threshold = $state(0.8);
	let removeLines = $state(false);
	let label = $state('');
	let previewUrl = $state('');
	let previewEmpty = $state(false);
	let message = $state('');

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

	function fit() {
		const s = Math.min(FRAME_W / source.width, FRAME_H / source.height);
		scale = clamp(s, MIN_ZOOM, MAX_ZOOM);
		ox = (FRAME_W - source.width * scale) / 2;
		oy = (FRAME_H - source.height * scale) / 2;
		updatePreview();
	}

	// Initial framing, once per source.
	let inited = false;
	$effect(() => {
		void source;
		if (!inited) {
			inited = true;
			removeLines = allowLineRemoval;
			fit();
		}
	});

	// Redraw the raw framed view whenever the view transform changes.
	$effect(() => {
		void scale;
		void ox;
		void oy;
		const ctx = frameEl?.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, FRAME_W, FRAME_H);
		ctx.setTransform(scale, 0, 0, scale, ox, oy);
		ctx.drawImage(source, 0, 0);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
	});

	function buildOutput(): HTMLCanvasElement {
		const out = document.createElement('canvas');
		out.width = Math.round(FRAME_W * RENDER_SCALE);
		out.height = Math.round(FRAME_H * RENDER_SCALE);
		const octx = out.getContext('2d');
		if (octx) {
			octx.setTransform(scale * RENDER_SCALE, 0, 0, scale * RENDER_SCALE, ox * RENDER_SCALE, oy * RENDER_SCALE);
			octx.drawImage(source, 0, 0);
		}
		return out;
	}

	function updatePreview() {
		const result = finalizeAcquired(buildOutput(), { removeBackground, threshold, removeLines });
		previewUrl = result?.dataUrl ?? '';
		previewEmpty = !result;
		message = '';
	}

	function setZoom(next: number, cx = FRAME_W / 2, cy = FRAME_H / 2) {
		const ns = clamp(next, MIN_ZOOM, MAX_ZOOM);
		// Keep the point under (cx,cy) fixed while zooming.
		ox = cx - ((cx - ox) * ns) / scale;
		oy = cy - ((cy - oy) * ns) / scale;
		scale = ns;
		updatePreview();
	}

	// ── Pan ─────────────────────────────────────────────────────────────────
	let pan: { px: number; py: number; ox0: number; oy0: number } | null = null;
	function onDown(e: PointerEvent) {
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		pan = { px: e.clientX, py: e.clientY, ox0: ox, oy0: oy };
	}
	function onMove(e: PointerEvent) {
		if (!pan) return;
		ox = pan.ox0 + (e.clientX - pan.px);
		oy = pan.oy0 + (e.clientY - pan.py);
	}
	function onUp(e: PointerEvent) {
		if (!pan) return;
		(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
		pan = null;
		updatePreview();
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const rect = frameEl?.getBoundingClientRect();
		const cx = rect ? ((e.clientX - rect.left) * FRAME_W) / rect.width : FRAME_W / 2;
		const cy = rect ? ((e.clientY - rect.top) * FRAME_H) / rect.height : FRAME_H / 2;
		setZoom(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy);
	}

	function save() {
		const result = finalizeAcquired(buildOutput(), { removeBackground, threshold, removeLines });
		if (!result) {
			message = 'Niente da salvare: inquadra la firma o abbassa la soglia.';
			return;
		}
		onsave({ label: label.trim() || 'Firma acquisita', pngDataUrl: result.dataUrl, aspect: result.aspect });
	}
</script>

<div class="flex flex-wrap gap-4">
	<!-- Framing (raw) -->
	<div class="flex-1">
		<p class="mb-1 text-xs text-ink-muted">Inquadra la firma: rotella per lo zoom, trascina per spostare.</p>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<canvas
			bind:this={frameEl}
			width={FRAME_W}
			height={FRAME_H}
			class="block w-full cursor-move touch-none select-none rounded border border-brand-light"
			style:aspect-ratio="{FRAME_W} / {FRAME_H}"
			style:background-image="repeating-linear-gradient(45deg, #f6f6f6 0 10px, #fff 10px 20px)"
			onpointerdown={onDown}
			onpointermove={onMove}
			onpointerup={onUp}
			onwheel={onWheel}
		></canvas>
		<div class="mt-2 flex items-center gap-2 text-xs text-ink-muted">
			<span>Zoom</span>
			<input
				type="range"
				min={MIN_ZOOM}
				max="3"
				step="0.02"
				value={scale}
				oninput={(e) => setZoom(Number(e.currentTarget.value))}
				class="w-40"
			/>
			<button type="button" class="rounded border border-brand-light px-2 py-0.5 hover:bg-brand-light/20" onclick={fit}>
				Adatta
			</button>
		</div>
	</div>

	<!-- Processed preview + controls -->
	<div class="flex-1">
		<p class="mb-1 text-xs text-ink-muted">Anteprima firma (sfondo trasparente):</p>
		<div
			class="flex min-h-[120px] items-center justify-center rounded border border-brand-light"
			style:background-image="repeating-linear-gradient(45deg, #f6f6f6 0 10px, #fff 10px 20px)"
		>
			{#if previewUrl}
				<img src={previewUrl} alt="Anteprima firma" class="max-h-28 max-w-full" />
			{:else}
				<span class="p-4 text-sm text-ink-muted">
					{previewEmpty ? 'Nessun tratto rilevato' : 'Anteprima'}
				</span>
			{/if}
		</div>

		<label class="mt-3 flex items-center gap-2 text-xs text-ink">
			<input type="checkbox" bind:checked={removeBackground} onchange={updatePreview} />
			Rendi lo sfondo chiaro trasparente
		</label>
		{#if removeBackground}
			<label class="mt-1 flex items-center gap-2 text-xs text-ink-muted">
				Sensibilità
				<input
					type="range"
					min="0.5"
					max="0.98"
					step="0.02"
					value={threshold}
					oninput={(e) => {
						threshold = Number(e.currentTarget.value);
						updatePreview();
					}}
					class="w-40"
				/>
				<span>{threshold.toFixed(2)}</span>
			</label>
		{/if}
		{#if allowLineRemoval}
			<label class="mt-2 flex items-center gap-2 text-xs text-ink">
				<input type="checkbox" bind:checked={removeLines} onchange={updatePreview} />
				Rimuovi la riga del modulo sotto la firma
			</label>
		{/if}
	</div>
</div>

{#if message}
	<p class="mt-2 text-sm text-brand-dark">{message}</p>
{/if}

<div class="mt-4 flex items-center gap-2">
	<input
		type="text"
		bind:value={label}
		placeholder="Etichetta (facoltativa)"
		class="w-56 rounded border border-brand-light px-2 py-1 text-sm text-ink outline-none focus:border-brand"
	/>
	<button type="button" class="ml-auto rounded px-3 py-1.5 text-sm text-ink-muted hover:text-ink" onclick={oncancel}>
		← Indietro
	</button>
	<button
		type="button"
		disabled={!previewUrl}
		class="rounded bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
		onclick={save}>Salva in libreria</button
	>
</div>
