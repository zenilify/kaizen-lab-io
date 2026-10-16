# kaizen-lab.io business-card QR

| File | What | Use it for |
|---|---|---|
| `kaizen-lab-io.svg` | vector, 29 × 29 modules + 4-module quiet zone, black on white | the print shop / layout (scales without loss) |
| `kaizen-lab-io.png` | 1024 × 1024 px, 27 px per module, ≥ 4-module quiet zone | previews, slides, quick proofs |

- **Encodes:** `https://kaizen-lab.io/?src=card` (the `?src=card` tag lets a visit be attributed to the card; the site ignores it otherwise).
- **QR version 3, error correction Q** (~25 % of the symbol can be damaged and still read; above the M minimum).
- **Verified:** the PNG decodes to the URL above at full size and when shrunk to 160 px (OpenCV `QRCodeDetector`, 2026-10-14).
- Generated with `segno` 1.6.6 + Pillow in a throw-away venv (`/tmp/l101-qr`), nothing installed system-wide.

## Print guidance

1. **Minimum size: 20 mm × 20 mm** for the code itself, *plus* the white quiet zone around it. 25 mm is safer on textured card stock.
2. **Keep the quiet zone.** At least 4 modules of white on every side (the files already include it). Do not let text, borders or the card edge eat into it.
3. **Black on white only.** No inverted (white-on-dark) code, no gradients, no logo in the middle, no tint below ~80 % contrast. Matte finish beats gloss (glare).
4. **Use the SVG** for print so the modules stay razor sharp; if the printer needs a bitmap, export at ≥ 600 dpi.
5. **Proof before the run:** print one card at final size and **scan it with two different phones** (one iPhone camera, one Android camera or Google Lens), in normal room light and from 15–25 cm. Both must open `https://kaizen-lab.io/?src=card`.
6. Re-test the printed proof after lamination or spot-UV if the card gets any finish.
