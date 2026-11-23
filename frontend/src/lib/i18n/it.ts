/**
 * Italian dictionary — the AUTHORITATIVE / source language for PdfModdy.
 *
 * Keys are dotted namespaces (flat map). `{name}` placeholders are filled by
 * `t(key, params)` (see locale.svelte.ts). English (`en.ts`) must mirror these
 * exact keys — its type is derived from this object so a missing key is a
 * compile error.
 *
 * Leading glyphs/emoji in a value (✓ ✕ ✥ ▢ 💧 📄 🖼️ 📝 ⠿ ←) are intentional and
 * kept identical across languages — only the words are translated.
 */
export const it = {
	// Toolbar — core actions
	'open.button': 'Apri PDF',
	'text.add': '+ Aggiungi testo',
	'text.done': '✓ Fine testo',
	'symbol.check': '✓ Spunta',
	'symbol.checkDone': '✓ Fine',
	'symbol.checkTitle': 'Posa spunte (V) — clicca sulle caselle',
	'symbol.cross': '✕ Croce',
	'symbol.crossDone': '✕ Fine',
	'symbol.crossTitle': 'Posa croci (X) — clicca sulle caselle',
	'symbol.groupAria': 'Simboli',
	'signature.tool': '✒ Firma',
	'signature.toolDone': '✓ Fine firma',
	'signature.toolTitle': 'Firma — scegli una firma dalla libreria e clicca sul PDF',
	'save.button': 'Salva PDF',
	'save.saving': 'Salvo…',
	'save.done': 'PDF salvato.',
	'export.button': 'Esporta in Word',
	'export.title': 'Converte il PDF (con firme e compilazioni) in un documento Word .docx',
	'export.exporting': 'Esporto…',
	'export.done': 'Documento Word esportato.',
	'export.failed': 'Export non riuscito: {err}',
	'export.needLibre':
		"Per l'export in Word serve LibreOffice (gratis, da libreoffice.org). Installalo, oppure indica il file soffice.exe.",
	'export.locate': 'Indica soffice.exe',
	'export.sofficeSaved': 'Percorso LibreOffice salvato.',

	// Language switch
	'lang.it': 'Italiano',
	'lang.en': 'Inglese',
	'lang.switchToIt': 'Passa all’italiano',
	'lang.switchToEn': 'Passa all’inglese',

	// Text/symbol style bar
	'style.font': 'Font',
	'style.size': 'Corpo',
	'style.color': 'Colore',
	'style.symbolColor': 'Colore simbolo',

	// AcroForm indicator
	'form.detected': '📝 Modulo rilevato: {n} {unit}',
	'form.unitOne': 'campo',
	'form.unitMany': 'campi',
	'form.detectedTitle': 'Questo PDF ha campi modulo compilabili direttamente',
	'form.flatten': 'Appiattisci al salvataggio',
	'form.flattenTitle': 'I valori diventano contenuto fisso non più modificabile',

	// Signature library panel
	'signature.none': 'Nessuna firma salvata.',
	'signature.choose': 'Scegli una firma, poi clicca sul PDF:',
	'signature.deleteAria': 'Elimina firma',
	'signature.deleteTitle': 'Elimina dalla libreria',
	'signature.new': '+ Nuova firma',
	'signature.defaultLabel': 'Firma',

	// File info / status
	'file.info': '{name} · {n} {unit}',
	'file.pageOne': 'pagina',
	'file.pageMany': 'pagine',
	'app.loading': 'Carico…',

	// Empty state
	'empty.title': 'Nessun PDF aperto',
	'empty.hintBefore': 'Clicca ',
	'empty.hintAfter': ' per iniziare.',

	// PdfPage overlay box controls
	'box.moveAria': 'Sposta casella',
	'box.move': '⠿ sposta',
	'box.deleteAria': 'Elimina casella',
	'box.resizeAria': 'Ridimensiona casella',
	'box.signatureAlt': 'Firma',

	// Signature modal
	'sigmodal.title': 'Nuova firma',
	'common.close': 'Chiudi',
	'common.cancel': 'Annulla',
	'sigmodal.tabDraw': 'Disegna',
	'sigmodal.tabName': 'Nome in corsivo',
	'sigmodal.tabAcquire': 'Acquisisci',
	'sigmodal.drawHint': 'Disegna la tua firma col mouse o il trackpad.',
	'sigmodal.clear': 'Pulisci',
	'sigmodal.nameLabel': 'Nome da rendere in corsivo (font di sistema "Segoe Script")',
	'sigmodal.namePlaceholder': 'Mario Rossi',
	'sigmodal.previewAlt': 'Anteprima firma',
	'sigmodal.preview': 'Anteprima',
	'sigmodal.labelOptional': 'Etichetta (facoltativa)',
	'sigmodal.labelPlaceholderName': 'Es. Firma Mario',
	'sigmodal.labelPlaceholderDraw': 'Es. Firma 1',
	'sigmodal.errDraw': 'Disegna una firma prima di salvare.',
	'sigmodal.errName': 'Scrivi un nome prima di salvare.',
	'sigmodal.save': 'Salva firma',

	// Acquire signature
	'acquire.filterImages': 'Immagini',
	'acquire.filterDocs': 'Documenti',
	'acquire.errImageFormat': 'Formato immagine non supportato.',
	'acquire.errNoEmbedded': 'Nessuna immagine incorporata trovata nel documento.',
	'acquire.errDocUnreadable': 'Documento non leggibile (serve un .docx o .odt valido).',
	'acquire.sourcePrompt': 'Da dove vuoi prendere la firma?',
	'acquire.fromPdf': '📄 Da un PDF',
	'acquire.fromPdfSub': 'ritaglia dalla pagina',
	'acquire.fromImage': "🖼️ Da un'immagine",
	'acquire.fromImageSub': 'PNG / JPG / …',
	'acquire.fromWord': '📝 Da Word / ODT',
	'acquire.fromWordSub': 'immagini incorporate',
	'acquire.changeSource': '← Cambia sorgente',
	'acquire.chooseImage': 'Scegli immagine…',
	'acquire.chooseDoc': 'Scegli documento…',
	'acquire.choosePdf': 'Scegli PDF…',
	'acquire.dragHint': 'Trascina un riquadro attorno alla firma.',
	'acquire.page': 'Pag. {n}/{total}',
	'acquire.chooseEmbedded': "Scegli l'immagine della firma:",

	// Signature editor
	'editor.pan': '✥ Sposta',
	'editor.crop': '▢ Ritaglia',
	'editor.clearCrop': 'Azzera ritaglio',
	'editor.fit': 'Adatta',
	'editor.zoom': 'Zoom',
	'editor.zoomHint': 'Rotella per zoom, trascina per spostare.',
	'editor.previewLabel': 'Anteprima firma (sfondo trasparente):',
	'editor.noStroke': 'Nessun tratto rilevato',
	'editor.bgTransparent': 'Rendi lo sfondo trasparente',
	'editor.method': 'Metodo',
	'editor.methodColor': 'Colore (pipetta)',
	'editor.methodLuminance': 'Luminosità',
	'editor.eyedrop': '💧 Pipetta',
	'editor.eyedropTitle': 'Clicca sullo sfondo da rendere trasparente',
	'editor.bgColorTitle': 'Colore di sfondo',
	'editor.tolerance': 'Tolleranza',
	'editor.sensitivity': 'Sensibilità',
	'editor.strength': 'Intensità tratto',
	'editor.removeLine': 'Rimuovi la riga del modulo sotto la firma',
	'editor.errNothing': 'Niente da salvare: regola ritaglio, sfondo o intensità.',
	'editor.back': '← Indietro',
	'editor.saveToLibrary': 'Salva in libreria',
	'editor.defaultLabel': 'Firma acquisita'
} as const;

export type MessageKey = keyof typeof it;
