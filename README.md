# PdfModdy

App desktop locale per Windows per **firmare e compilare PDF** — firme in corsivo,
spunte (V / X) e campi in stampatello sovrapposti al documento. Nessun cloud,
nessun server: tutto gira sul tuo PC.

> Non è firma digitale crittografica (PAdES/certificati). È firma e compilazione
> *visiva*: aggiunge elementi sopra le pagine e salva un nuovo PDF.

## Stack

- **Tauri 2** — shell desktop nativa (installer `.msi`)
- **SvelteKit 2 / Svelte 5 + Vite + TypeScript + Tailwind** — interfaccia (webview)
- **PDF.js** — rendering delle pagine
- **pdf-lib** — scrittura dell'overlay e salvataggio
- **Rust** — I/O file (solo per i file scelti dall'utente via dialog nativo)

## Layout

```
Pdf/
  frontend/     SvelteKit (interfaccia)
  src-tauri/    shell Rust/Tauri
```

## Sviluppo

Prerequisiti: Node, Rust/Cargo (già presenti).

```powershell
cd frontend
npm install
npm run tauri dev
```

Build dell'installer:

```powershell
cd frontend
npm run tauri build
```

## Roadmap (milestone)

1. **Scaffold** — apertura e rendering PDF ✅ (base)
2. **Overlay** — piazzare elementi sopra le pagine e salvare
3. **Firma** — disegno a mano libera + nome in corsivo, libreria firme
4. **Spunte & testo** — V/X sulle caselle, campi in stampatello, moduli AcroForm
5. **Export & packaging** — salvataggio finale e installer `.exe`
