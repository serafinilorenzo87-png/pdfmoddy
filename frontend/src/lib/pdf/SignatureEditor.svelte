<!--
	Interactive signature editor — the last step before a signature enters the
	library, shared by all "acquire" sources (image / PDF crop / Office image).

	Natural order: frame with zoom/pan → draw a crop rectangle to isolate the
	signature → knock out the background (by color via eyedropper, or by
	brightness) → (PDF) remove the form line → strengthen faint ink → save.

	Left = the raw source with the live crop box; right = a LIVE preview of the
	finished, transparent result. Output is always a tight transparent PNG, so
	it shares the library + baking path with the drawn / cursive signatures.
-->
<script lang="ts">
	import {
		finalizeAcquired,
		sampleBorderColor,
		type Rgb,
		type BackgroundOptions
	} from './signatureImage';

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

	type Tool = 'pan' | 'crop' | 'eyedrop';

	let frameEl = $state<HTMLCanvasElement | null>(null);
	let tool = $state<Tool>('pan');
	let scale = $state(1);
	let ox = $state(0);
	let oy = $state(0);
	let crop = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

	let bgEnabled = $state(true);
	let bgMethod = $state<'color' | 'luminance'>('color');
	let bgColor = $state<Rgb>({ r: 255, g: 255, b: 255 });
	let tolerance = $state(0.18);
	let threshold = $state(0.8);
	let removeLines = $state(false);
	let strengthen = $state(0);

	let label = $state('');
	let previewUrl = $state('');
	let previewEmpty = $state(false);
	let message = $state('');

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
	const hex = (c: Rgb) =>
		'#' + [c.r, c.g, c.b].map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');

	function background(): BackgroundOptions {
		if (!bgEnabled) return { method: 'none' };
		return bgMethod === 'color'
			? { method: 'color', color: bgColor, tolerance }
			: { method: 'luminance', threshold };
	}

	function fit() {
		const s = Math.min(FRAME_W / source.width, FRAME_H / source.height);
		scale = clamp(s, MIN_ZOOM, MAX_ZOOM);
		ox = (FRAME_W - source.width * scale) / 2;
		oy = (FRAME_H - source.height * scale) / 2;
		updatePreview();
	}

	// Initial framing + background seed, once per source.
	let inited = false;
	$effect(() => {
		void source;
		if (!inited) {
			inited = true;
			removeLines = allowLineRemoval;
			bgColor = sampleBorderColor(source);
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

	function cropFrameRect(): { left: number; top: number; width: number; height: number } {
		if (!crop) return { left: 0, top: 0, width: FRAME_W, height: FRAME_H };
		const left = clamp(Math.min(crop.x0, crop.x1), 0, FRAME_W);
		const top = clamp(Math.min(crop.y0, crop.y1), 0, FRAME_H);
		const right = clamp(Math.max(crop.x0, crop.x1), 0, FRAME_W);
		const bottom = clamp(Math.max(crop.y0, crop.y1), 0, FRAME_H);
		return { left, top, width: right - left, height: bottom - top };
	}

	// Crop overlay position, in % of the frame (robust to CSS scaling).
	const cropPct = $derived.by(() => {
		if (!crop) return null;
		const r = cropFrameRect();
		return {
			left: (r.left / FRAME_W) * 100,
			top: (r.top / FRAME_H) * 100,
			width: (r.width / FRAME_W) * 100,
			height: (r.height / FRAME_H) * 100
		};
	});

	function buildOutput(): HTMLCanvasElement {
		const r = cropFrameRect();
		const out = document.createElement('canvas');
		out.width = Math.max(1, Math.round(r.width * RENDER_SCALE));
		out.height = Math.max(1, Math.round(r.height * RENDER_SCALE));
		const octx = out.getContext('2d');
		if (octx) {
			octx.setTransform(
				scale * RENDER_SCALE,
				0,
				0,
				scale * RENDER_SCALE,
				(ox - r.left) * RENDER_SCALE,
				(oy - r.top) * RENDER_SCALE
			);
			octx.drawImage(source, 0, 0);
		}
		return out;
	}

	function updatePreview() {
		const result = finalizeAcquired(buildOutput(), {
			background: background(),
			removeLines,
			strengthen
		});
		previewUrl = result?.dataUrl ?? '';
		previewEmpty = !result;
		message = '';
	}

	function setZoom(next: number, cx = FRAME_W / 2, cy = FRAME_H / 2) {
		const ns = clamp(next, MIN_ZOOM, MAX_ZOOM);
		ox = cx - ((cx - ox) * ns) / scale;
		oy = cy - ((cy - oy) * ns) / scale;
		scale = ns;
		updatePreview();
	}

	// ── Pointer interactions (frame-space coords, robust to CSS scaling) ───────
	function frameCoords(e: PointerEvent): { x: number; y: number } {
		const r = frameEl!.getBoundingClientRect();
		return {
			x: ((e.clientX - r.left) * FRAME_W) / r.width,
			y: ((e.clientY - r.top) * FRAME_H) / r.height
		};
	}

	function pickColorAt(fx: number, fy: number) {
		const sx = Math.floor((fx - ox) / scale);
		const sy = Math.floor((fy - oy) / scale);
		if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) return;
		const px = source.getContext('2d')?.getImageData(sx, sy, 1, 1).data;
		if (px) bgColor = { r: px[0], g: px[1], b: px[2] };
	}

	let gesture: { kind: 'pan' | 'crop'; fx: number; fy: number; ox0: number; oy0: number } | null =
		null;
	function onDown(e: PointerEvent) {
		if (!frameEl) return;
		const f = frameCoords(e);
		if (tool === 'eyedrop') {
			pickColorAt(f.x, f.y);
			tool = 'pan';
			bgEnabled = true;
			bgMethod = 'color';
			updatePreview();
			return;
		}
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		if (tool === 'crop') {
			crop = { x0: f.x, y0: f.y, x1: f.x, y1: f.y };
			gesture = { kind: 'crop', fx: f.x, fy: f.y, ox0: ox, oy0: oy };
		} else {
			gesture = { kind: 'pan', fx: f.x, fy: f.y, ox0: ox, oy0: oy };
		}
	}
	function onMove(e: PointerEvent) {
		if (!gesture) return;
		const f = frameCoords(e);
		if (gesture.kind === 'crop' && crop) {
			crop = { ...crop, x1: f.x, y1: f.y };
		} else if (gesture.kind === 'pan') {
			ox = gesture.ox0 + (f.x - gesture.fx);
			oy = gesture.oy0 + (f.y - gesture.fy);
		}
	}
	function onUp(e: PointerEvent) {
		if (!gesture) return;
		(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
		const kind = gesture.kind;
		gesture = null;
		if (kind === 'crop') {
			const r = cropFrameRect();
			if (r.width < 8 || r.height < 8) crop = null;
		}
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
		const result = finalizeAcquired(buildOutput(), {
			background: background(),
			removeLines,
			strengthen
		});
		if (!result) {
			message = 'Niente da salvare: regola ritaglio, sfondo o intensità.';
			return;
		}
		onsave({ label: label.trim() || 'Firma acquisita', pngDataUrl: result.dataUrl, aspect: result.aspect });
	}

	const cursorClass = $derived(
		tool === 'crop' ? 'cursor-crosshair' : tool === 'eyedrop' ? 'cursor-copy' : 'cursor-move'
	);
</script>

<div class="flex flex-wrap gap-4">
	<!-- Framing (raw) + crop box -->
	<div class="flex-1">
		<div class="mb-1 flex items-center gap-1 text-xs">
			<button
				type="button"
				aria-pressed={tool === 'pan'}
				class={tool === 'pan'
					? 'rounded bg-brand px-2 py-0.5 font-medium text-white'
					: 'rounded border border-brand-light px-2 py-0.5 text-ink hover:bg-brand-light/20'}
				onclick={() => (tool = 'pan')}>✥ Sposta</button
			>
			<button
				type="button"
				aria-pressed={tool === 'crop'}
				class={tool === 'crop'
					? 'rounded bg-brand px-2 py-0.5 font-medium text-white'
					: 'rounded border border-brand-light px-2 py-0.5 text-ink hover:bg-brand-light/20'}
				onclick={() => (tool = 'crop')}>▢ Ritaglia</button
			>
			{#if crop}
				<button
					type="button"
					class="rounded border border-brand-light px-2 py-0.5 text-ink-muted hover:bg-brand-light/20"
					onclick={() => {
						crop = null;
						updatePreview();
					}}>Azzera ritaglio</button
				>
			{/if}
			<button
				type="button"
				class="rounded border border-brand-light px-2 py-0.5 text-ink hover:bg-brand-light/20"
				onclick={fit}>Adatta</button
			>
		</div>
		<div class="relative overflow-hidden rounded border border-brand-light">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<canvas
				bind:this={frameEl}
				width={FRAME_W}
				height={FRAME_H}
				class="block w-full touch-none select-none {cursorClass}"
				style:aspect-ratio="{FRAME_W} / {FRAME_H}"
				style:background-image="repeating-linear-gradient(45deg, #f6f6f6 0 10px, #fff 10px 20px)"
				onpointerdown={onDown}
				onpointermove={onMove}
				onpointerup={onUp}
				onwheel={onWheel}
			></canvas>
			{#if cropPct}
				<div
					class="pointer-events-none absolute border-2 border-brand bg-brand/10"
					style:left="{cropPct.left}%"
					style:top="{cropPct.top}%"
					style:width="{cropPct.width}%"
					style:height="{cropPct.height}%"
				></div>
			{/if}
		</div>
		<div class="mt-2 flex items-center gap-2 text-xs text-ink-muted">
			<span>Zoom</span>
			<input
				type="range"
				min={MIN_ZOOM}
				max="3"
				step="0.02"
				value={scale}
				oninput={(e) => setZoom(Number(e.currentTarget.value))}
				class="w-32"
			/>
			<span class="text-[11px]">Rotella per zoom, trascina per spostare.</span>
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
			<input type="checkbox" bind:checked={bgEnabled} onchange={updatePreview} />
			Rendi lo sfondo trasparente
		</label>

		{#if bgEnabled}
			<div class="mt-1 flex items-center gap-2 text-xs text-ink-muted">
				Metodo
				<select
					value={bgMethod}
					onchange={(e) => {
						bgMethod = e.currentTarget.value as 'color' | 'luminance';
						updatePreview();
					}}
					class="rounded border border-brand-light bg-white px-1 py-0.5 text-ink"
				>
					<option value="color">Colore (pipetta)</option>
					<option value="luminance">Luminosità</option>
				</select>
			</div>

			{#if bgMethod === 'color'}
				<div class="mt-1 flex items-center gap-2 text-xs text-ink-muted">
					<button
						type="button"
						aria-pressed={tool === 'eyedrop'}
						class={tool === 'eyedrop'
							? 'rounded bg-brand px-2 py-0.5 font-medium text-white'
							: 'rounded border border-brand-light px-2 py-0.5 text-ink hover:bg-brand-light/20'}
						onclick={() => (tool = 'eyedrop')}
						title="Clicca sullo sfondo da rendere trasparente">💧 Pipetta</button
					>
					<span
						class="inline-block h-4 w-6 rounded border border-brand-light"
						style:background-color={hex(bgColor)}
						title="Colore di sfondo"
					></span>
					<span>Tolleranza</span>
					<input
						type="range"
						min="0.02"
						max="0.6"
						step="0.01"
						value={tolerance}
						oninput={(e) => {
							tolerance = Number(e.currentTarget.value);
							updatePreview();
						}}
						class="w-28"
					/>
				</div>
			{:else}
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
						class="w-32"
					/>
					<span>{threshold.toFixed(2)}</span>
				</label>
			{/if}
		{/if}

		<label class="mt-2 flex items-center gap-2 text-xs text-ink-muted">
			Intensità tratto
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={strengthen}
				oninput={(e) => {
					strengthen = Number(e.currentTarget.value);
					updatePreview();
				}}
				class="w-32"
			/>
			<span>{Math.round(strengthen * 100)}%</span>
		</label>

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
