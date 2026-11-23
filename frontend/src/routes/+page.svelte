<script lang="ts">
    import { openPdfDialog, loadPdfDocument, renderAllPages } from '$lib/pdf/viewer';

    let fileName = $state('');
    let numPages = $state(0);
    let loading = $state(false);
    let error = $state('');
    let pagesEl: HTMLDivElement;

    async function openPdf() {
        error = '';
        try {
            const picked = await openPdfDialog();
            if (!picked) return;
            loading = true;
            const loaded = await loadPdfDocument(picked.path);
            fileName = picked.name;
            numPages = loaded.numPages;
            await renderAllPages(loaded, pagesEl);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loading = false;
        }
    }
</script>

<header
    class="flex items-center gap-3 border-b border-brand-dark/30 bg-brand px-4 py-2 text-white shadow-sm"
>
    <span class="select-none text-lg font-bold tracking-tight">PdfModdy</span>
    <button
        onclick={openPdf}
        class="rounded bg-white/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/25 active:bg-white/30"
    >
        Apri PDF
    </button>
    {#if fileName}
        <span class="truncate text-sm text-white/80">{fileName} · {numPages} pagine</span>
    {/if}
    {#if loading}
        <span class="text-sm text-white/80">Carico…</span>
    {/if}
</header>

{#if error}
    <div class="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-brand-dark">
        {error}
    </div>
{/if}

<main class="relative flex-1 overflow-auto bg-canvas">
    {#if !fileName && !loading}
        <div
            class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-ink-muted"
        >
            <p class="text-lg font-medium text-ink">Nessun PDF aperto</p>
            <p class="mt-1 text-sm">
                Clicca <span class="font-semibold text-brand">Apri PDF</span> per iniziare.
            </p>
        </div>
    {/if}
    <div bind:this={pagesEl} class="px-4 pb-8"></div>
</main>
