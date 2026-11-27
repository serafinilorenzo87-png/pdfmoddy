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
import type { PDFDocumentProxy } from 'pdfjs-dist';

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
