<!--
	A single PDF page: a `position: relative` box holding the PDF.js <canvas>
	with an absolutely-positioned overlay layer on top. The overlay hosts this
	page's annotations as real DOM elements (draggable / resizable / editable).

	This is the reusable substrate for every later milestone — signatures and
	checkmarks are new annotation types rendered into this same overlay, placed
	with the same pixel⇄point mapping.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
	import type { LoadedPdf } from './viewer';
	import { annotations, type Annotation } from './annotations.svelte';
	import { ptToPx, pxToPt, ptLenToPx, pxLenToPt } from './coords';
	import { fontDef } from './fonts';
	import { SYMBOL_STROKES, SYMBOL_VIEWBOX } from './symbols';

	let {
		loaded,
		pageIndex,
		scale
	}: { loaded: LoadedPdf; pageIndex: number; scale: number } = $props();

	let canvasEl: HTMLCanvasElement;
	let overlayEl: HTMLDivElement;
	let viewport = $state<PageViewport | null>(null);

	// Render (and re-render on zoom change) the page into the canvas, sized for
	// the device pixel ratio so text stays crisp.
	$effect(() => {
		const pageNum = pageIndex + 1;
		const s = scale;
		let cancelled = false;
		(async () => {
			const page: PDFPageProxy = await loaded.pdf.getPage(pageNum);
			const vp = page.getViewport({ scale: s });
			if (cancelled || !canvasEl) return;
			viewport = vp;
			const dpr = window.devicePixelRatio || 1;
			canvasEl.width = Math.floor(vp.width * dpr);
			canvasEl.height = Math.floor(vp.height * dpr);
			canvasEl.style.width = `${vp.width}px`;
			canvasEl.style.height = `${vp.height}px`;
			const ctx = canvasEl.getContext('2d');
			if (!ctx) return;
			await page.render({
				canvasContext: ctx,
				viewport: vp,
				transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
			}).promise;
		})();
		return () => {
			cancelled = true;
		};
	});

	const pageAnnots = $derived(annotations.forPage(pageIndex));
	const placing = $derived(annotations.tool !== 'none');

	// ── Placement: a click on the overlay drops a new text box ────────────────
	// The tool MODE stays armed afterwards so several boxes can be dropped in a
	// row; it's cleared only by the toolbar button / Escape (see +page.svelte).
	function onOverlayPointerDown(e: PointerEvent) {
		if (!placing || !viewport) return;
		// Only drop a NEW annotation when the click lands on the empty overlay
		// itself — never when it originates inside an existing box (textarea,
		// SVG, drag/resize handle). Those select/edit the box instead, so you
		// don't get a cascade of empty rectangles clicking into one to type.
		if (e.target !== overlayEl) return;
		const rect = overlayEl.getBoundingClientRect();
		const { xPt, yPt } = pxToPt(viewport, e.clientX - rect.left, e.clientY - rect.top);

		if (annotations.tool === 'text') {
			const style = annotations.textDefaults;
			const id = annotations.addText({
				pageIndex,
				xPt,
				yPt,
				wPt: 180,
				hPt: 26,
				text: '',
				fontSize: style.fontSize,
				font: style.font,
				color: style.color
			});
			annotations.selectedId = id;
			tick().then(() => {
				overlayEl?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`)?.focus();
			});
		} else if (annotations.tool === 'symbol') {
			const style = annotations.symbolDefaults;
			// Drop a square stamp centered on the click, so the cursor marks the
			// middle of the tick rather than its corner.
			const sizePt = 22;
			const half = ptLenToPx(viewport, sizePt) / 2;
			const centered = pxToPt(viewport, e.clientX - rect.left - half, e.clientY - rect.top - half);
			const id = annotations.addSymbol({
				pageIndex,
				xPt: centered.xPt,
				yPt: centered.yPt,
				wPt: sizePt,
				hPt: sizePt,
				symbol: style.symbol,
				color: style.color
			});
			annotations.selectedId = id;
		}
	}

	function boxStyle(a: Annotation): string {
		if (!viewport) return 'display:none';
		const { xPx, yPx } = ptToPx(viewport, a.xPt, a.yPt);
		const w = ptLenToPx(viewport, a.wPt);
		const h = ptLenToPx(viewport, a.hPt);
		return `left:${xPx}px; top:${yPx}px; width:${w}px; height:${h}px;`;
	}

	// ── Drag (move) ───────────────────────────────────────────────────────────
	let drag: { id: string; startX: number; startY: number; x0: number; y0: number } | null = null;
	function startDrag(e: PointerEvent, a: Annotation) {
		e.preventDefault();
		e.stopPropagation();
		annotations.selectedId = a.id;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		drag = { id: a.id, startX: e.clientX, startY: e.clientY, x0: a.xPt, y0: a.yPt };
	}
	function moveDrag(e: PointerEvent, a: Annotation) {
		if (!drag || drag.id !== a.id || !viewport) return;
		// Project the original point to px, apply the pixel delta, go back to pt —
		// so the flip is always applied through the one canonical path.
		const { xPx, yPx } = ptToPx(viewport, drag.x0, drag.y0);
		const moved = pxToPt(viewport, xPx + (e.clientX - drag.startX), yPx + (e.clientY - drag.startY));
		a.xPt = moved.xPt;
		a.yPt = moved.yPt;
	}
	function endDrag(e: PointerEvent, a: Annotation) {
		if (drag?.id === a.id) {
			(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
			drag = null;
		}
	}

	// ── Resize (bottom-right handle) ──────────────────────────────────────────
	let resize: { id: string; startX: number; startY: number; w0: number; h0: number } | null = null;
	function startResize(e: PointerEvent, a: Annotation) {
		e.preventDefault();
		e.stopPropagation();
		annotations.selectedId = a.id;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		resize = { id: a.id, startX: e.clientX, startY: e.clientY, w0: a.wPt, h0: a.hPt };
	}
	function moveResize(e: PointerEvent, a: Annotation) {
		if (!resize || resize.id !== a.id || !viewport) return;
		const dwPt = pxLenToPt(viewport, e.clientX - resize.startX);
		const dhPt = pxLenToPt(viewport, e.clientY - resize.startY);
		a.wPt = Math.max(24, resize.w0 + dwPt);
		a.hPt = Math.max(16, resize.h0 + dhPt);
	}
	function endResize(e: PointerEvent, a: Annotation) {
		if (resize?.id === a.id) {
			(e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
			resize = null;
		}
	}
</script>

<div class="relative my-4 inline-block">
	<canvas bind:this={canvasEl} class="block rounded-sm bg-white shadow-md"></canvas>

	<!-- Overlay layer: inert by default; armed only when placing a new box.
	     It's a canvas-like placement surface (click to drop a box), not a
	     control — the keyboard path is the "+ Aggiungi testo" button + Escape. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={overlayEl}
		class="absolute inset-0"
		class:cursor-crosshair={placing}
		style:pointer-events={placing ? 'auto' : 'none'}
		onpointerdown={onOverlayPointerDown}
	>
		{#each pageAnnots as a (a.id)}
			{@const selected = annotations.selectedId === a.id}
			<div
				class="group absolute"
				class:z-10={selected}
				style={boxStyle(a)}
				style:pointer-events="auto"
			>
				<!-- drag handle (top bar) -->
				<div
					class="absolute -top-4 left-0 flex h-4 items-center gap-1 rounded-t bg-brand px-1 text-[10px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100"
					style:opacity={selected ? '1' : undefined}
					style:touch-action="none"
					role="button"
					tabindex="-1"
					aria-label="Sposta casella"
					onpointerdown={(e) => startDrag(e, a)}
					onpointermove={(e) => moveDrag(e, a)}
					onpointerup={(e) => endDrag(e, a)}
				>
					<span class="cursor-move select-none">⠿ sposta</span>
					<button
						type="button"
						class="cursor-pointer rounded px-1 hover:bg-white/25"
						aria-label="Elimina casella"
						onpointerdown={(e) => e.stopPropagation()}
						onclick={() => annotations.remove(a.id)}>✕</button
					>
				</div>

				{#if a.type === 'text'}
					{@const fontPx = ptLenToPx(viewport!, a.fontSize)}
					{@const css = fontDef(a.font).css}
					<textarea
						data-id={a.id}
						bind:value={a.text}
						spellcheck="false"
						class="h-full w-full resize-none overflow-hidden rounded-sm border bg-transparent p-0 leading-tight outline-none"
						class:border-brand={selected}
						class:border-dashed={!selected}
						class:border-brand-light={!selected}
						style:font-size="{fontPx}px"
						style:line-height="{fontPx * 1.15}px"
						style:font-family={css.family}
						style:font-weight={css.weight}
						style:font-style={css.style}
						style:color={a.color}
						onfocus={() => (annotations.selectedId = a.id)}
					></textarea>
				{:else if a.type === 'symbol'}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<svg
						viewBox="0 0 {SYMBOL_VIEWBOX} {SYMBOL_VIEWBOX}"
						preserveAspectRatio="none"
						class="h-full w-full rounded-sm border"
						class:border-brand={selected}
						class:border-dashed={!selected}
						class:border-transparent={!selected}
						onpointerdown={() => (annotations.selectedId = a.id)}
					>
						{#each SYMBOL_STROKES[a.symbol] as poly}
							<polyline
								points={poly.map((p) => p.join(',')).join(' ')}
								fill="none"
								stroke={a.color}
								stroke-width="10"
								stroke-linecap="round"
								stroke-linejoin="round"
								/>
						{/each}
					</svg>
				{/if}

				<!-- resize handle (bottom-right) -->
				<div
					class="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-brand opacity-0 transition-opacity group-hover:opacity-100"
					style:opacity={selected ? '1' : undefined}
					style:touch-action="none"
					role="button"
					tabindex="-1"
					aria-label="Ridimensiona casella"
					onpointerdown={(e) => startResize(e, a)}
					onpointermove={(e) => moveResize(e, a)}
					onpointerup={(e) => endResize(e, a)}
				></div>
			</div>
		{/each}
	</div>
</div>
