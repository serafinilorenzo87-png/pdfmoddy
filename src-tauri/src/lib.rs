//! PdfModdy — Tauri 2 entry point.
//!
//! Everything runs locally: the SvelteKit webview does the PDF rendering and
//! overlay work (PDF.js + pdf-lib); Rust only provides file I/O for files the
//! user explicitly picks through the native dialog — or that Windows hands us
//! when a .pdf is opened with PdfModdy (file association). No network, no
//! sidecar.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(desktop)]
use tauri::{Emitter, Manager};

/// Distinct error code the frontend keys on to show the "install LibreOffice /
/// locate soffice.exe" flow instead of a generic failure.
const LIBREOFFICE_NOT_FOUND: &str = "LIBREOFFICE_NOT_FOUND";

/// Max time to wait for a single headless conversion before giving up.
const CONVERT_TIMEOUT: Duration = Duration::from_secs(180);

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

// ── PDF → Word (.docx) via a locally installed LibreOffice ──────────────────
//
// LibreOffice is NOT bundled (it would add ~300–400 MB to a ~2 MB installer):
// we locate an existing install and drive `soffice` headless. The user can
// configure the path if it lives somewhere unusual.

/// Prefer `soffice.com` over `soffice.exe` in the same folder: on Windows the
/// `.com` console wrapper BLOCKS until the conversion finishes, while the `.exe`
/// can detach and return immediately (so `wait()` would see success too early).
fn prefer_com(path: &Path) -> PathBuf {
    if path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("soffice.exe"))
        .unwrap_or(false)
    {
        let com = path.with_file_name("soffice.com");
        if com.is_file() {
            return com;
        }
    }
    path.to_path_buf()
}

/// Resolve a usable `soffice` executable: 1) the user-configured path, 2) the
/// standard Windows install locations, 3) the `PATH`. Returns `None` when
/// LibreOffice cannot be found anywhere.
fn locate_soffice(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = configured {
        let path = Path::new(p);
        if path.is_file() {
            return Some(prefer_com(path));
        }
    }

    // Standard install locations, per OS.
    #[cfg(target_os = "windows")]
    const COMMON: &[&str] = &[
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ];
    #[cfg(target_os = "macos")]
    const COMMON: &[&str] = &["/Applications/LibreOffice.app/Contents/MacOS/soffice"];
    #[cfg(all(unix, not(target_os = "macos")))]
    const COMMON: &[&str] = &[
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/opt/libreoffice/program/soffice",
        "/snap/bin/libreoffice",
    ];

    for c in COMMON {
        let path = Path::new(c);
        if path.is_file() {
            return Some(prefer_com(path));
        }
    }

    // PATH scan. On Windows prefer soffice.com (the blocking console wrapper);
    // elsewhere the executable is just `soffice`.
    #[cfg(target_os = "windows")]
    const PATH_NAMES: &[&str] = &["soffice.com", "soffice.exe"];
    #[cfg(not(target_os = "windows"))]
    const PATH_NAMES: &[&str] = &["soffice"];

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in PATH_NAMES {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

/// Turn an absolute Windows path into a `file:///C:/...` URL, which is what
/// LibreOffice's `-env:UserInstallation` expects.
fn to_file_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    format!("file:///{}", s.trim_start_matches('/'))
}

/// Create a unique temporary directory under the system temp folder.
fn unique_temp_dir(tag: &str) -> std::io::Result<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("pdfmoddy_{tag}_{nanos}_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Wait for a child process with a timeout, killing it if it overruns.
fn wait_with_timeout(child: &mut std::process::Child, timeout: Duration) -> Result<i32, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.code().unwrap_or(-1)),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("conversion timed out".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    }
}

/// Report whether a usable LibreOffice is available (and where), so the UI can
/// proactively show that Word export is ready — or that LibreOffice is missing —
/// before the user even tries to export. `soffice_path` is the user-configured
/// executable, if any. Returns the resolved executable path, or `None`.
#[tauri::command]
fn check_soffice(soffice_path: Option<String>) -> Option<String> {
    locate_soffice(soffice_path.as_deref()).map(|p| p.to_string_lossy().into_owned())
}

/// Convert a PDF (given as base64 bytes) to a .docx at `output_docx_path`, using
/// a locally installed LibreOffice. `soffice_path` is the user-configured
/// executable, if any. Returns `LIBREOFFICE_NOT_FOUND` when no install is found.
///
/// A dedicated temporary `UserInstallation` profile is used so the conversion
/// works even while the user already has LibreOffice open (otherwise the shared
/// profile is locked and headless mode fails). `writer_pdf_import` forces the
/// PDF to import into Writer — without it a generic PDF imports as a Draw
/// document, which the .docx (Writer) filter cannot export.
#[tauri::command]
fn convert_pdf_to_docx(
    pdf_base64: String,
    output_docx_path: String,
    soffice_path: Option<String>,
) -> Result<(), String> {
    let bytes = STANDARD
        .decode(pdf_base64)
        .map_err(|e| format!("decode: {e}"))?;

    let soffice = locate_soffice(soffice_path.as_deref()).ok_or(LIBREOFFICE_NOT_FOUND)?;

    // Temp workspace: input PDF + a fresh profile + output dir, all disposable.
    let work = unique_temp_dir("export").map_err(|e| format!("temp dir: {e}"))?;
    let profile = work.join("profile");
    let outdir = work.join("out");
    std::fs::create_dir_all(&profile).map_err(|e| format!("temp profile: {e}"))?;
    std::fs::create_dir_all(&outdir).map_err(|e| format!("temp out: {e}"))?;

    let input_pdf = work.join("input.pdf");
    std::fs::write(&input_pdf, &bytes).map_err(|e| format!("write input: {e}"))?;

    let log_path = work.join("soffice.log");
    let log = File::create(&log_path).ok();

    let run = |stdout: Stdio, stderr: Stdio| {
        Command::new(&soffice)
            .arg("--headless")
            .arg("--norestore")
            .arg(format!("-env:UserInstallation={}", to_file_url(&profile)))
            .arg("--infilter=writer_pdf_import")
            .arg("--convert-to")
            .arg("docx:MS Word 2007 XML")
            .arg("--outdir")
            .arg(&outdir)
            .arg(&input_pdf)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
    };

    let spawned = match log {
        Some(f) => {
            let f2 = f.try_clone().map_err(|e| format!("log: {e}"))?;
            run(Stdio::from(f), Stdio::from(f2))
        }
        None => run(Stdio::null(), Stdio::null()),
    };
    let mut child = spawned.map_err(|e| format!("launch LibreOffice: {e}"))?;

    let code = wait_with_timeout(&mut child, CONVERT_TIMEOUT).inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&work);
    })?;

    let produced = outdir.join("input.docx");
    if code != 0 || !produced.is_file() {
        let log_tail = std::fs::read_to_string(&log_path).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&work);
        let detail = log_tail.lines().last().unwrap_or("").trim();
        return Err(format!(
            "LibreOffice conversion failed (exit {code}){}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    // Move the result to the user's chosen path (copy + drop the temp tree).
    let copy_res = std::fs::copy(&produced, &output_docx_path);
    let _ = std::fs::remove_dir_all(&work);
    copy_res.map_err(|e| format!("write output: {e}"))?;
    Ok(())
}

// ── Open a web link from a PDF ───────────────────────────────────────────────

/// Whether an external URL is safe to hand to the OS opener: only web and mail
/// links. Everything else — `file:`, `javascript:`, a bare local path, or any
/// custom scheme that could launch a local program — is rejected, so a crafted
/// link annotation inside an opened PDF can never run anything on the machine.
fn is_allowed_external_url(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    u.starts_with("http://") || u.starts_with("https://") || u.starts_with("mailto:")
}

/// Open an external link from a PDF in the user's default browser / mail client.
/// Restricted to http/https/mailto (see `is_allowed_external_url`). Opening goes
/// through the OS handler directly (no shell), so the URL is never interpreted
/// by a command line.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("blocked: only http, https and mailto links are allowed".into());
    }
    opener::open(url.trim()).map_err(|e| format!("open url: {e}"))
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
            get_launch_file,
            check_soffice,
            convert_pdf_to_docx,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running PdfModdy");
}

#[cfg(test)]
mod tests {
    use super::{
        check_soffice, extract_pdf_path, is_allowed_external_url, locate_soffice, to_file_url,
    };
    use std::path::Path;

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn file_url_uses_forward_slashes_and_triple_slash() {
        assert_eq!(
            to_file_url(Path::new(r"C:\Users\x\profile")),
            "file:///C:/Users/x/profile"
        );
    }

    #[test]
    fn missing_soffice_is_none() {
        // A path that does not exist, no PATH match in the test env's common dirs.
        let got = locate_soffice(Some(r"Z:\nope\soffice.exe"));
        // Either None (not installed) or a real install found via common paths;
        // both are valid — just assert a configured bogus path is not returned.
        if let Some(p) = got {
            assert_ne!(p.to_string_lossy(), r"Z:\nope\soffice.exe");
        }
    }

    #[test]
    fn allows_web_and_mail_links() {
        assert!(is_allowed_external_url("https://example.com"));
        assert!(is_allowed_external_url("http://example.com/path?q=1&r=2"));
        assert!(is_allowed_external_url("  HTTPS://Example.com/x  "));
        assert!(is_allowed_external_url("mailto:info@example.com"));
    }

    #[test]
    fn blocks_non_web_links() {
        assert!(!is_allowed_external_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url("ftp://example.com/x"));
        assert!(!is_allowed_external_url(r"C:\Windows\System32\cmd.exe"));
        assert!(!is_allowed_external_url(""));
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

    /// Prints the detection result on THIS machine (ignored: machine-dependent).
    /// Run: cargo test -- --ignored --nocapture detects_soffice
    #[test]
    #[ignore]
    fn detects_soffice() {
        let auto = check_soffice(None);
        let with_bogus = check_soffice(Some(r"Z:\nope\soffice.exe".into()));
        println!("check_soffice(None)        = {auto:?}");
        println!("check_soffice(bogus config)= {with_bogus:?}");
        // A bogus configured path must fall back to auto-detection, not be echoed.
        assert_eq!(auto, with_bogus);
    }

    /// Real end-to-end conversion through the actual command. Ignored by default
    /// (needs LibreOffice + a sample PDF), so CI stays green without them. Run:
    ///   PDFMODDY_TEST_PDF=<path> cargo test -- --ignored real_conversion
    /// Optional: PDFMODDY_TEST_SOFFICE=<soffice path> to force a specific install.
    #[test]
    #[ignore]
    fn real_conversion_end_to_end() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let pdf = std::env::var("PDFMODDY_TEST_PDF").expect("set PDFMODDY_TEST_PDF");
        let bytes = std::fs::read(&pdf).expect("read sample pdf");
        let b64 = STANDARD.encode(bytes);
        let out = std::env::temp_dir().join("pdfmoddy_test_out.docx");
        let _ = std::fs::remove_file(&out);
        let soffice = std::env::var("PDFMODDY_TEST_SOFFICE").ok();

        super::convert_pdf_to_docx(b64, out.to_string_lossy().into_owned(), soffice)
            .expect("conversion should succeed");

        let produced = std::fs::read(&out).expect("output docx exists");
        assert!(produced.len() > 1000, "docx looks too small");
        assert_eq!(&produced[0..2], b"PK", "output is not a zip/OOXML file");
        let _ = std::fs::remove_file(&out);
    }
}
