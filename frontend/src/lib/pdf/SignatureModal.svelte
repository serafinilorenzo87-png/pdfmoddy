<!--
	Signature creation modal. Two ways to make a signature, both ending as a
	transparent PNG (see signatureImage.ts) so the library and baking stay
	uniform:
	  1. Draw — freehand on a canvas with the mouse / trackpad (black stroke).
	  2. Name  — type a name, rendered in cursive "Segoe Script" and rasterized.
	On save it hands the parent a { label, pngDataUrl, aspect } to store.
-->
<script lang="ts">
	import { trimToPng, renderCursiveName, type RasterizedSignature } from './signatureImage';
	import { t } from '$lib/i18n/locale.svelte';
	import AcquireSignature from './AcquireSignature.svelte';

	let {
		open = false,
		onsave,
		onclose
	}: {
		open?: boolean;
		onsave: (sig: { label: string; pngDataUrl: string; aspect: number }) => void;
		onclose: () => void;
	} = $props();

	type Mode = 'draw' | 'name' | 'acquire';
	let mode = $state<Mode>('draw');
	let label = $state('');
	let typedName = $state('');
	let message = $state('');

	// ── Drawing canvas ────────────────────────────────────────────────────────
	const CANVAS_W = 600;
	const CANVAS_H = 200;
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let hasInk = $state(false);
	let drawing = false;
	let last: { x: number; y: number } | null = null;

	function canvasPoint(e: PointerEvent): { x: number; y: number } {
		const el = canvasEl!;
		const rect = el.getBoundingClientRect();
		// Map CSS pixels to the canvas's internal resolution (they may differ).
		return {
			x: (e.clientX - rect.left) * (el.width / rect.width),
			y: (e.clientY - rect.top) * (el.height / rect.height)
		};
	}

	function strokeTo(p: { x: number; y: number }) {
		const ctx = canvasEl?.getContext('2d');
		if (!ctx || !last) return;
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 3;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(last.x, last.y);
		ctx.lineTo(p.x, p.y);
		ctx.stroke();
	}

	function onCanvasPointerDown(e: PointerEvent) {
		if (!canvasEl) return;
		e.preventDefault();
		canvasEl.setPointerCapture(e.pointerId);
		drawing = true;
		last = canvasPoint(e);
		// A single tap should still leave a dot.
		const ctx = canvasEl.getContext('2d');
		if (ctx) {
			ctx.fillStyle = '#000000';
			ctx.beginPath();
			ctx.arc(last.x, last.y, 1.5, 0, Math.PI * 2);
			ctx.fill();
		}
		hasInk = true;
		message = '';
	}
	function onCanvasPointerMove(e: PointerEvent) {
		if (!drawing) return;
		const p = canvasPoint(e);
		strokeTo(p);
		last = p;
	}
	function onCanvasPointerUp(e: PointerEvent) {
		if (!drawing) return;
		canvasEl?.releasePointerCapture?.(e.pointerId);
		drawing = false;
		last = null;
	}

	function clearCanvas() {
		const ctx = canvasEl?.getContext('2d');
		if (ctx && canvasEl) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		hasInk = false;
		message = '';
	}

	function reset() {
		clearCanvas();
		label = '';
		typedName = '';
		message = '';
		mode = 'draw';
	}

	function close() {
		reset();
		onclose();
	}

	function save() {
		let raster: RasterizedSignature | null = null;
		if (mode === 'draw') {
			if (!canvasEl) return;
			raster = trimToPng(canvasEl);
			if (!raster) {
				message = t('sigmodal.errDraw');
				return;
			}
		} else {
			raster = renderCursiveName(typedName);
			if (!raster) {
				message = t('sigmodal.errName');
				return;
			}
		}
		const fallback = mode === 'name' ? typedName.trim() : t('signature.defaultLabel');
		onsave({
			label: label.trim() || fallback,
			pngDataUrl: raster.dataUrl,
			aspect: raster.aspect
		});
		reset();
	}

	// Live preview of the cursive name.
	const namePreview = $derived(mode === 'name' ? renderCursiveName(typedName) : null);
</script>

<svelte:window
	onkeydown={(e) => {
		if (open && e.key === 'Escape') close();
	}}
/>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
	>
		<div class="w-full max-w-2xl rounded-lg bg-white shadow-xl">
			<header
				class="flex items-center justify-between rounded-t-lg border-b border-brand-light bg-brand px-4 py-2 text-white"
			>
				<span class="font-semibold">{t('sigmodal.title')}</span>
				<button
					type="button"
					aria-label={t('common.close')}
					class="rounded px-2 py-0.5 text-lg leading-none hover:bg-white/20"
					onclick={close}>✕</button
				>
			</header>

			<div class="flex gap-1 border-b border-brand-light/60 px-4 pt-3">
				<button
					type="button"
					class={mode === 'draw'
						? 'rounded-t border-b-2 border-brand px-3 py-1.5 text-sm font-semibold text-brand'
						: 'rounded-t px-3 py-1.5 text-sm text-ink-muted hover:text-ink'}
					onclick={() => {
						mode = 'draw';
						message = '';
					}}>{t('sigmodal.tabDraw')}</button
				>
				<button
					type="button"
					class={mode === 'name'
						? 'rounded-t border-b-2 border-brand px-3 py-1.5 text-sm font-semibold text-brand'
						: 'rounded-t px-3 py-1.5 text-sm text-ink-muted hover:text-ink'}
					onclick={() => {
						mode = 'name';
						message = '';
					}}>{t('sigmodal.tabName')}</button
				>
				<button
					type="button"
					class={mode === 'acquire'
						? 'rounded-t border-b-2 border-brand px-3 py-1.5 text-sm font-semibold text-brand'
						: 'rounded-t px-3 py-1.5 text-sm text-ink-muted hover:text-ink'}
					onclick={() => {
						mode = 'acquire';
						message = '';
					}}>{t('sigmodal.tabAcquire')}</button
				>
			</div>

			<div class="px-4 py-4">
				{#if mode === 'draw'}
					<p class="mb-2 text-sm text-ink-muted">{t('sigmodal.drawHint')}</p>
					<div class="overflow-hidden rounded border border-brand-light bg-white">
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<canvas
							bind:this={canvasEl}
							width={CANVAS_W}
							height={CANVAS_H}
							class="block w-full cursor-crosshair touch-none"
							style:aspect-ratio="{CANVAS_W} / {CANVAS_H}"
							style:background-image="repeating-linear-gradient(45deg, #f6f6f6 0 10px, #fff 10px 20px)"
							onpointerdown={onCanvasPointerDown}
							onpointermove={onCanvasPointerMove}
							onpointerup={onCanvasPointerUp}
							onpointerleave={onCanvasPointerUp}
						></canvas>
					</div>
					<button
						type="button"
						class="mt-2 rounded border border-brand-light px-2.5 py-1 text-xs text-brand hover:bg-brand-light/20"
						onclick={clearCanvas}>{t('sigmodal.clear')}</button
					>
				{:else if mode === 'name'}
					<label class="mb-1 block text-sm text-ink-muted" for="sig-name-input">
						{t('sigmodal.nameLabel')}
					</label>
					<input
						id="sig-name-input"
						type="text"
						bind:value={typedName}
						placeholder={t('sigmodal.namePlaceholder')}
						class="w-full rounded border border-brand-light px-2 py-1.5 text-ink outline-none focus:border-brand"
						style:font-family={'italic "Segoe Script", cursive'}
					/>
					<div
						class="mt-3 flex h-28 items-center justify-center overflow-hidden rounded border border-brand-light bg-white"
					>
						{#if namePreview}
							<img src={namePreview.dataUrl} alt={t('sigmodal.previewAlt')} class="max-h-24 max-w-full" />
						{:else}
							<span class="text-sm text-ink-muted">{t('sigmodal.preview')}</span>
						{/if}
					</div>
				{:else}
					<AcquireSignature {onsave} ondone={close} />
				{/if}

				{#if mode !== 'acquire'}
					<div class="mt-4">
						<label class="mb-1 block text-xs text-ink-muted" for="sig-label-input">
							{t('sigmodal.labelOptional')}
						</label>
						<input
							id="sig-label-input"
							type="text"
							bind:value={label}
							placeholder={mode === 'name'
								? t('sigmodal.labelPlaceholderName')
								: t('sigmodal.labelPlaceholderDraw')}
							class="w-56 rounded border border-brand-light px-2 py-1 text-sm text-ink outline-none focus:border-brand"
						/>
					</div>
				{/if}

				{#if message}
					<p class="mt-3 text-sm text-brand-dark">{message}</p>
				{/if}
			</div>

			{#if mode !== 'acquire'}
				<footer class="flex justify-end gap-2 border-t border-brand-light/60 px-4 py-3">
					<button
						type="button"
						class="rounded px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
						onclick={close}>{t('common.cancel')}</button
					>
					<button
						type="button"
						class="rounded bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
						disabled={mode === 'draw' ? !hasInk : !typedName.trim()}
						onclick={save}>{t('sigmodal.save')}</button
					>
				</footer>
			{/if}
		</div>
	</div>
{/if}
