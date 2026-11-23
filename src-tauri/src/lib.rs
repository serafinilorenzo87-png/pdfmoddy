//! PdfModdy — Tauri 2 entry point.
//!
//! Everything runs locally: the SvelteKit webview does the PDF rendering and
//! overlay work (PDF.js + pdf-lib); Rust only provides file I/O for files the
//! user explicitly picks through the native dialog. No network, no sidecar.

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Read a file from disk and return its bytes as a base64 string.
/// Invoked from the frontend after the user picks a path via the dialog.
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    std::fs::read(&path)
        .map(|bytes| STANDARD.encode(bytes))
        .map_err(|e| format!("read {path}: {e}"))
}

/// Decode a base64 string and write the bytes to disk.
#[tauri::command]
fn write_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| format!("decode: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file_base64, write_file_base64])
        .run(tauri::generate_context!())
        .expect("error while running PdfModdy");
}
