"""One-shot generator for the four colored tray PNGs (M2.16).

Produces 16x16 PNGs with a solid coloured circle on a transparent
background, one per `TrayState` (idle / refreshing / anomaly / error).
Uses only the Python stdlib (`struct` + `zlib`) so no extra dependency.

Run:
    poetry run python src-tauri/icons/tray/generate.py

Re-running overwrites the PNGs; the bytes are deterministic, so committing
the result keeps the build reproducible.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Resolved relative to this script.
OUT_DIR = Path(__file__).resolve().parent

# Each entry: (filename, RGB triplet for the dot).
# Colours chosen to mirror the Tailwind tokens used in the frontend
# (Sidebar/StatusBar): brand violet, info blue, warning amber, negative red.
ICONS: list[tuple[str, tuple[int, int, int]]] = [
    ("idle.png", (167, 139, 250)),         # violet — same as accent-brand
    ("refreshing.png", (96, 165, 250)),    # blue   — accent-info
    ("anomaly.png", (251, 191, 36)),       # amber  — accent-warning
    ("error.png", (248, 113, 113)),        # red    — accent-negative
]

# Square canvas size in px. 16 keeps the PNG <300 bytes per file and
# matches the Windows tray native icon size.
SIZE = 16


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data)
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def make_rgba_pixels(rgb: tuple[int, int, int]) -> bytes:
    """Return raw 16x16 RGBA pixel bytes (no filter prefix, no headers).

    Used by the Rust tray code via `Image::new(rgba, 16, 16)`. PNG
    decoding isn't on Tauri 2's core surface, so we hand the raw
    pixels to it directly.
    """
    r, g, b = rgb
    centre = SIZE / 2 - 0.5
    radius = SIZE / 2 - 1.0  # 1px transparent ring around the disk
    out: list[int] = []
    for y in range(SIZE):
        for x in range(SIZE):
            dx = x - centre
            dy = y - centre
            if (dx * dx + dy * dy) <= (radius * radius):
                out.extend((r, g, b, 255))
            else:
                out.extend((0, 0, 0, 0))
    return bytes(out)


def make_png_from_rgba(rgba: bytes) -> bytes:
    """Wrap raw RGBA pixels into a 16x16 RGBA PNG (for human inspection)."""
    raw_rows = [
        b"\x00" + rgba[y * SIZE * 4 : (y + 1) * SIZE * 4] for y in range(SIZE)
    ]
    raw = b"".join(raw_rows)
    out = b"\x89PNG\r\n\x1a\n"
    out += _png_chunk(
        b"IHDR",
        struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0),
    )
    out += _png_chunk(b"IDAT", zlib.compress(raw, level=9))
    out += _png_chunk(b"IEND", b"")
    return out


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, rgb in ICONS:
        rgba = make_rgba_pixels(rgb)

        # Raw RGBA bytes — what tray.rs include_bytes! consumes.
        rgba_path = OUT_DIR / name.replace(".png", ".rgba")
        rgba_path.write_bytes(rgba)

        # PNG copy — not used by the build, but useful if Lorenzo wants
        # to preview the tray look outside the running app.
        png_path = OUT_DIR / name
        png_path.write_bytes(make_png_from_rgba(rgba))

        print(
            f"wrote {rgba_path.name} ({rgba_path.stat().st_size}B) "
            f"+ {png_path.name} ({png_path.stat().st_size}B)"
        )


if __name__ == "__main__":
    main()
