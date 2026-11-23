/**
 * English dictionary. Mirrors every key in `it.ts` (the authoritative source):
 * the `Record<MessageKey, string>` type makes a missing key a compile error.
 * Translations aim to be accurate and concise; shared glyphs/emoji are kept.
 */
import type { MessageKey } from './it';

export const en: Record<MessageKey, string> = {
	// Toolbar — core actions
	'open.button': 'Open PDF',
	'text.add': '+ Add text',
	'text.done': '✓ Done',
	'symbol.check': '✓ Check',
	'symbol.checkDone': '✓ Done',
	'symbol.checkTitle': 'Place check marks (✓) — click on the boxes',
	'symbol.cross': '✕ Cross',
	'symbol.crossDone': '✕ Done',
	'symbol.crossTitle': 'Place crosses (✕) — click on the boxes',
	'symbol.groupAria': 'Symbols',
	'signature.tool': '✒ Signature',
	'signature.toolDone': '✓ Done',
	'signature.toolTitle': 'Signature — pick one from the library and click on the PDF',
	'save.button': 'Save PDF',
	'save.saving': 'Saving…',
	'save.done': 'PDF saved.',
	'export.button': 'Export to Word',
	'export.title': 'Convert the PDF (with signatures and filled fields) to a Word .docx document',
	'export.exporting': 'Exporting…',
	'export.done': 'Word document exported.',
	'export.failed': 'Export failed: {err}',
	'export.needLibre':
		'Exporting to Word needs LibreOffice (free, from libreoffice.org). Install it, or point to the soffice.exe file.',
	'export.locate': 'Locate soffice.exe',
	'export.sofficeSaved': 'LibreOffice path saved.',
	'export.engineDetected': 'Word export uses the LibreOffice engine (detected).',
	'export.engineMissingShort': 'LibreOffice not detected',

	// Language switch
	'lang.it': 'Italian',
	'lang.en': 'English',
	'lang.switchToIt': 'Switch to Italian',
	'lang.switchToEn': 'Switch to English',

	// Text/symbol style bar
	'style.font': 'Font',
	'style.size': 'Size',
	'style.color': 'Color',
	'style.symbolColor': 'Symbol color',

	// AcroForm indicator
	'form.detected': '📝 Form detected: {n} {unit}',
	'form.unitOne': 'field',
	'form.unitMany': 'fields',
	'form.detectedTitle': 'This PDF has form fields you can fill in directly',
	'form.flatten': 'Flatten on save',
	'form.flattenTitle': 'Values become fixed content that can no longer be edited',

	// Signature library panel
	'signature.none': 'No saved signatures.',
	'signature.choose': 'Pick a signature, then click on the PDF:',
	'signature.deleteAria': 'Delete signature',
	'signature.deleteTitle': 'Remove from library',
	'signature.new': '+ New signature',
	'signature.defaultLabel': 'Signature',

	// File info / status
	'file.info': '{name} · {n} {unit}',
	'file.pageOne': 'page',
	'file.pageMany': 'pages',
	'app.loading': 'Loading…',

	// Empty state
	'empty.title': 'No PDF open',
	'empty.hintBefore': 'Click ',
	'empty.hintAfter': ' to get started.',

	// PdfPage overlay box controls
	'box.moveAria': 'Move box',
	'box.move': '⠿ move',
	'box.deleteAria': 'Delete box',
	'box.resizeAria': 'Resize box',
	'box.signatureAlt': 'Signature',

	// Signature modal
	'sigmodal.title': 'New signature',
	'common.close': 'Close',
	'common.cancel': 'Cancel',
	'sigmodal.tabDraw': 'Draw',
	'sigmodal.tabName': 'Cursive name',
	'sigmodal.tabAcquire': 'Acquire',
	'sigmodal.drawHint': 'Draw your signature with the mouse or trackpad.',
	'sigmodal.clear': 'Clear',
	'sigmodal.nameLabel': 'Name to render in cursive (system font "Segoe Script")',
	'sigmodal.namePlaceholder': 'John Smith',
	'sigmodal.previewAlt': 'Signature preview',
	'sigmodal.preview': 'Preview',
	'sigmodal.labelOptional': 'Label (optional)',
	'sigmodal.labelPlaceholderName': 'e.g. John’s signature',
	'sigmodal.labelPlaceholderDraw': 'e.g. Signature 1',
	'sigmodal.errDraw': 'Draw a signature before saving.',
	'sigmodal.errName': 'Type a name before saving.',
	'sigmodal.save': 'Save signature',

	// Acquire signature
	'acquire.filterImages': 'Images',
	'acquire.filterDocs': 'Documents',
	'acquire.errImageFormat': 'Unsupported image format.',
	'acquire.errNoEmbedded': 'No embedded image found in the document.',
	'acquire.errDocUnreadable': 'Document not readable (a valid .docx or .odt is required).',
	'acquire.sourcePrompt': 'Where do you want to take the signature from?',
	'acquire.fromPdf': '📄 From a PDF',
	'acquire.fromPdfSub': 'crop from the page',
	'acquire.fromImage': '🖼️ From an image',
	'acquire.fromImageSub': 'PNG / JPG / …',
	'acquire.fromWord': '📝 From Word / ODT',
	'acquire.fromWordSub': 'embedded images',
	'acquire.changeSource': '← Change source',
	'acquire.chooseImage': 'Choose image…',
	'acquire.chooseDoc': 'Choose document…',
	'acquire.choosePdf': 'Choose PDF…',
	'acquire.dragHint': 'Drag a box around the signature.',
	'acquire.page': 'Page {n}/{total}',
	'acquire.chooseEmbedded': 'Pick the signature image:',

	// Signature editor
	'editor.pan': '✥ Move',
	'editor.crop': '▢ Crop',
	'editor.clearCrop': 'Clear crop',
	'editor.fit': 'Fit',
	'editor.zoom': 'Zoom',
	'editor.zoomHint': 'Wheel to zoom, drag to move.',
	'editor.previewLabel': 'Signature preview (transparent background):',
	'editor.noStroke': 'No stroke detected',
	'editor.bgTransparent': 'Make the background transparent',
	'editor.method': 'Method',
	'editor.methodColor': 'Color (eyedropper)',
	'editor.methodLuminance': 'Brightness',
	'editor.eyedrop': '💧 Eyedropper',
	'editor.eyedropTitle': 'Click the background to make transparent',
	'editor.bgColorTitle': 'Background color',
	'editor.tolerance': 'Tolerance',
	'editor.sensitivity': 'Sensitivity',
	'editor.strength': 'Stroke strength',
	'editor.removeLine': 'Remove the form line under the signature',
	'editor.errNothing': 'Nothing to save: adjust crop, background or strength.',
	'editor.back': '← Back',
	'editor.saveToLibrary': 'Save to library',
	'editor.defaultLabel': 'Acquired signature'
};
