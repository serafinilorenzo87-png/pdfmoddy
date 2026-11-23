//! PdfModdy — Tauri 2 entry point.
//!
//! Everything runs locally: the SvelteKit webview does the PDF rendering and
//! overlay work (PDF.js + pdf-lib); Rust only provides file I/O for files the
//! user explicitly picks through the native dialog — or that Windows hands us
//! when a .pdf is opened with PdfModdy (file association). No network, no
//! sidecar.

use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(desktop)]
use tauri::{Emitter, Manager};

/// The PDF path PdfModdy was launched with (file association / "Open with"),
/// consumed once by the frontend on startup via `get_launch_file`.
struct LaunchFile(Mutex<Option<String>>);

/// Pick the PDF path out of a process argument list. The OS already splits the
/// command line into individual, unquoted arguments, so a path containing
/// spaces arrives as one element — we just take the first `.pdf`. `argv[0]`
/// (the executable) is skipped.
fn extract_pdf_path(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".pdf"))
        .cloned()
}

/// Read a file from disk and return its bytes as a base64 string. Works for any
/// absolute path — the file-association launch hands us a full path, not just
/// files chosen through the dialog.
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

/// Return (and clear) the PDF path PdfModdy was launched with, if any. The
/// frontend calls this once on mount to auto-open a file-associated PDF.
#[tauri::command]
fn get_launch_file(state: tauri::State<'_, LaunchFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Path this (first) instance was launched with, before the webview exists.
    let launch_file = extract_pdf_path(&std::env::args().collect::<Vec<_>>());

    let builder = tauri::Builder::default();

    // single-instance MUST be the first registered plugin. On a second launch
    // (e.g. a second "Open with"), its callback runs inside the ALREADY RUNNING
    // instance: we raise the existing window and emit the new path to the
    // frontend, and the second process exits without opening a duplicate.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        if let Some(path) = extract_pdf_path(&argv) {
            let _ = app.emit("open-file", path);
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(LaunchFile(Mutex::new(launch_file)))
        .invoke_handler(tauri::generate_handler![
            read_file_base64,
            write_file_base64,
            get_launch_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running PdfModdy");
}

#[cfg(test)]
mod tests {
    use super::extract_pdf_path;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_pdf_after_exe() {
        let a = args(&["pdfmoddy.exe", r"C:\Users\x\doc.pdf"]);
        assert_eq!(extract_pdf_path(&a).as_deref(), Some(r"C:\Users\x\doc.pdf"));
    }

    #[test]
    fn handles_path_with_spaces() {
        // The OS delivers a spaced path as a SINGLE argv element (quotes already
        // stripped), so nothing special is needed on our side.
        let a = args(&["pdfmoddy.exe", r"C:\My Documents\modulo firmato.pdf"]);
        assert_eq!(
            extract_pdf_path(&a).as_deref(),
            Some(r"C:\My Documents\modulo firmato.pdf")
        );
    }

    #[test]
    fn extension_is_case_insensitive() {
        let a = args(&["pdfmoddy.exe", r"C:\x\DOC.PDF"]);
        assert_eq!(extract_pdf_path(&a).as_deref(), Some(r"C:\x\DOC.PDF"));
    }

    #[test]
    fn ignores_exe_and_non_pdf_flags() {
        let a = args(&["pdfmoddy.exe", "--some-flag", "notapdf.txt"]);
        assert_eq!(extract_pdf_path(&a), None);
    }

    #[test]
    fn no_args_means_no_file() {
        let a = args(&["pdfmoddy.exe"]);
        assert_eq!(extract_pdf_path(&a), None);
    }
}
