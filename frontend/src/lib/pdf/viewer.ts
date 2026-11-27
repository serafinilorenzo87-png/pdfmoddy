/**
 * PDF loading + rendering for PdfModdy.
 *
 * All PDF.js work happens in the browser (Tauri webview). PDF.js is imported
 * lazily (dynamic import) so it never runs during SvelteKit's build-time
 * prerender in Node — where it references DOM globals that don't exist.
 *
 * File bytes come through a thin Rust command (`read_file_base64`) rather than
 * the fs plugin, so no filesystem scope juggling is needed: the dialog plugin
 * gives us a path the user explicitly picked, and Rust reads it.
 */
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjs: PdfjsModule | null = null;

async function ensurePdfjs(): Promise<PdfjsModule> {
    if (!pdfjs) {
        pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }
    return pdfjs;
}

export interface PickedFile {
    path: string;
    name: string;
}

/** Native "open file" dialog, filtered to PDFs. Returns null if cancelled. */
export async function openPdfDialog(): Promise<PickedFile | null> {
    return openFileDialog([{ name: 'PDF', extensions: ['pdf'] }]);
}

/** Native "open file" dialog with custom filters. Returns null if cancelled. */
export async function openFileDialog(
    filters: { name: string; extensions: string[] }[]
): Promise<PickedFile | null> {
    const selected = await open({ multiple: false, directory: false, filters });
    if (!selected || Array.isArray(selected)) return null;
    const path = selected as string;
    const name = path.split(/[\\/]/).pop() ?? path;
    return { path, name };
}

/**
 * Open a link found inside a PDF (http/https/mailto) in the user's default
 * browser or mail client. The Rust side re-validates the scheme, so a crafted
 * link can never launch a local program; anything else is silently ignored.
 */
export async function openExternalUrl(url: string): Promise<void> {
    await invoke('open_external_url', { url });
}

// ── Text-layer selection behaviour ───────────────────────────────────────────
// PDF.js's low-level `TextLayer` only lays out the transparent spans; the smooth
// selection UX — so dragging never also grabs the text *before* where you
// started — lives in its viewer's `TextLayerBuilder`. We port the essential
// part: each text layer gets an `.endOfContent` sentinel, and one shared set of
// document listeners repositions it to the live selection anchor. This mirrors
// pdf.js's own implementation (web/text_layer_builder.js).
const textLayerEnds = new Map<HTMLElement, HTMLElement>();
let selectionAbort: AbortController | null = null;

function resetTextLayerSelection(end: HTMLElement, textLayer: HTMLElement) {
    textLayer.append(end);
    end.style.width = '';
    end.style.height = '';
    textLayer.classList.remove('selecting');
}

function enableGlobalSelectionListener() {
    if (selectionAbort) return;
    selectionAbort = new AbortController();
    const { signal } = selectionAbort;
    let isPointerDown = false;
    let prevRange: Range | null = null;

    document.addEventListener('pointerdown', () => { isPointerDown = true; }, { signal });
    const release = () => {
        isPointerDown = false;
        textLayerEnds.forEach(resetTextLayerSelection);
    };
    document.addEventListener('pointerup', release, { signal });
    window.addEventListener('blur', release, { signal });
    document.addEventListener('keyup', () => {
        if (!isPointerDown) textLayerEnds.forEach(resetTextLayerSelection);
    }, { signal });

    document.addEventListener('selectionchange', () => {
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) {
            textLayerEnds.forEach(resetTextLayerSelection);
            return;
        }

        // Mark which text layers the selection currently touches; reset the rest.
        const active = new Set<HTMLElement>();
        for (let i = 0; i < selection.rangeCount; i++) {
            const range = selection.getRangeAt(i);
            for (const div of textLayerEnds.keys()) {
                if (!active.has(div) && range.intersectsNode(div)) active.add(div);
            }
        }
        for (const [div, end] of textLayerEnds) {
            if (active.has(div)) div.classList.add('selecting');
            else resetTextLayerSelection(end, div);
        }

        // Move the sentinel next to the selection's anchor so the browser never
        // extends the selection backwards past where the drag began.
        const range = selection.getRangeAt(0);
        const modifyStart =
            prevRange !== null &&
            (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
                range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
        let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
        if (anchor && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
        const anchorEl = anchor as HTMLElement | null;
        const parentTextLayer =
            (anchorEl?.parentElement?.closest('.textLayer') as HTMLElement | null) ?? null;
        const end = parentTextLayer ? textLayerEnds.get(parentTextLayer) : undefined;
        if (end && parentTextLayer && anchorEl?.parentElement) {
            end.style.width = parentTextLayer.style.width;
            end.style.height = parentTextLayer.style.height;
            anchorEl.parentElement.insertBefore(end, modifyStart ? anchorEl : anchorEl.nextSibling);
        }
        prevRange = range.cloneRange();
    }, { signal });
}

function registerTextLayer(div: HTMLElement, end: HTMLElement) {
    textLayerEnds.set(div, end);
    enableGlobalSelectionListener();
}

function unregisterTextLayer(div: HTMLElement) {
    textLayerEnds.delete(div);
    if (textLayerEnds.size === 0) {
        selectionAbort?.abort();
        selectionAbort = null;
    }
}

/**
 * Render a selectable text layer over a page's canvas. PDF.js lays transparent
 * <span>s matching the rendered glyphs into `container`, so the PDF's real text
 * can be highlighted and copied. The spans are positioned with the
 * `--scale-factor` CSS variable, which the caller must set on `container` to the
 * viewport scale. An `.endOfContent` sentinel plus shared document listeners
 * give the same selection behaviour as the PDF.js viewer (no backward grab).
 * Returns the layer so the caller can `cancel()` it before a re-render (zoom
 * change). Purely visual/interactive — it never alters the PDF.
 */
export async function renderTextLayer(
    page: PDFPageProxy,
    container: HTMLElement,
    viewport: PageViewport
): Promise<{ cancel(): void }> {
    const lib = await ensurePdfjs();
    const textLayer = new lib.TextLayer({
        textContentSource: page.streamTextContent({
            includeMarkedContent: true,
            disableNormalization: true
        }),
        container,
        viewport
    });
    await textLayer.render();

    const end = document.createElement('div');
    end.className = 'endOfContent';
    container.append(end);
    registerTextLayer(container, end);

    return {
        cancel() {
            textLayer.cancel();
            unregisterTextLayer(container);
        }
    };
}

/** Read any file from disk as raw bytes (via the same Rust base64 command). */
export async function readFileBytes(path: string): Promise<Uint8Array> {
    const b64 = await invoke<string>('read_file_base64', { path });
    return base64ToBytes(b64);
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

export interface LoadedPdf {
    pdf: PDFDocumentProxy;
    numPages: number;
    /** Original file bytes, kept intact for later saving/overlay. */
    bytes: Uint8Array;
}

/** Read a PDF from disk and parse it with PDF.js. */
export async function loadPdfDocument(path: string): Promise<LoadedPdf> {
    const b64 = await invoke<string>('read_file_base64', { path });
    const bytes = base64ToBytes(b64);
    const lib = await ensurePdfjs();
    // PDF.js detaches the buffer it's given; hand it a copy so `bytes` survives
    // for the overlay/save milestones.
    const pdf = await lib.getDocument({ data: bytes.slice() }).promise;
    return { pdf, numPages: pdf.numPages, bytes };
}

/** Render every page into `container` as stacked <canvas> sheets. */
export async function renderAllPages(
    loaded: LoadedPdf,
    container: HTMLElement,
    scale = 1.5
): Promise<void> {
    container.innerHTML = '';
    for (let n = 1; n <= loaded.numPages; n++) {
        const page = await loaded.pdf.getPage(n);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.className = 'mx-auto my-4 block rounded-sm bg-white shadow-md';
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        container.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

/** Write bytes to disk via the Rust command, through a native "save" dialog. */
export async function savePdfBytes(bytes: Uint8Array, suggestedName = 'documento.pdf'): Promise<boolean> {
    const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (!path) return false;
    await invoke('write_file_base64', { path, data: bytesToBase64(bytes) });
    return true;
}

/** Error code the Rust converter returns when no LibreOffice install is found. */
export const LIBREOFFICE_NOT_FOUND = 'LIBREOFFICE_NOT_FOUND';

/** Native "save" dialog filtered to .docx. Returns the chosen path or null. */
export async function saveDocxDialog(suggestedName = 'documento.docx'): Promise<string | null> {
    const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Word', extensions: ['docx'] }]
    });
    return path ?? null;
}

/** Native "open" dialog to let the user point at their soffice executable. */
export async function pickSofficeDialog(): Promise<string | null> {
    const picked = await openFileDialog([{ name: 'LibreOffice (soffice)', extensions: ['exe', 'com'] }]);
    return picked?.path ?? null;
}

/**
 * Convert baked PDF bytes to a .docx at `outputDocxPath`, using the local
 * LibreOffice via the Rust command. `sofficePath` is the user-configured
 * executable, if any. Rejects with `LIBREOFFICE_NOT_FOUND` when none is found.
 */
export async function convertPdfToDocx(
    pdfBytes: Uint8Array,
    outputDocxPath: string,
    sofficePath?: string | null
): Promise<void> {
    await invoke('convert_pdf_to_docx', {
        pdfBase64: bytesToBase64(pdfBytes),
        outputDocxPath,
        sofficePath: sofficePath ?? null
    });
}
