# Atlas — icon assets

Two placeholders used during M1.1 to make `cargo check` and `tauri-build`
happy. **Neither is the final icon.**

- `icon.png` (68 bytes) — 1x1 transparent PNG. Listed in `bundle.icon`.
- `icon.ico` (1150 bytes) — 16x16 transparent ICO with 32bpp BMP payload.
  Required by `tauri-build` on Windows to generate the Windows Resource
  file (.rc), which embeds an icon into the final `.exe`. The file path
  `icons/icon.ico` is hardcoded by tauri-build, regardless of what the
  `bundle.icon` array says.

Real icons (multiple sizes per platform) will be generated in M1.6 via
`cargo tauri icon <source.png>` from a high-resolution source (≥1024x1024).
That command produces the full bundle-ready set: `icon.ico`, `icon.icns`,
and `Square*.png` variants for Windows Store and Tauri's bundler.

Until then these placeholders are enough for `cargo check` and `cargo build`.
