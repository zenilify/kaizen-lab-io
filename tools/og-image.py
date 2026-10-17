#!/usr/bin/env python3
"""Generate site/assets/og-image.png (1200x630) from the site's palette and logo. Needs Pillow:
   python3 -m venv .venv && .venv/bin/pip install pillow && .venv/bin/python tools/og-image.py
The PNG is committed; re-run only when the brand changes."""
import pathlib
from PIL import Image, ImageDraw, ImageFont
root = pathlib.Path(__file__).resolve().parent.parent
W, H = 1200, 630
BG, DOT, TEXT, MUTED = (13, 13, 13), (32, 32, 34), (240, 240, 240), (154, 154, 162)
ORANGE, PURPLE, NAVY = (248, 164, 47), (106, 76, 160), (45, 58, 120)
def font(size, bold=False):
    for c in ["/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if pathlib.Path(c).exists():
            try: return ImageFont.truetype(c, size, index=1 if bold and c.endswith(".ttc") else 0)
            except Exception: pass
    return ImageFont.load_default(size)
img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
for y in range(18, H, 36):
    for x in range(18, W, 36): d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=DOT)
# gradient bar orange -> purple -> navy
for x in range(W):
    t = x / (W - 1)
    a, b, u = (ORANGE, PURPLE, t * 2) if t < .5 else (PURPLE, NAVY, (t - .5) * 2)
    d.line([x, 0, x, 14], fill=tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(3)))
logo = Image.open(root / "site/assets/logo.png").convert("RGBA")
lw = 560; logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
img.paste(logo, (80, 90), logo)
d.text((80 + lw + 14, 96), ".io", font=font(44, True), fill=MUTED)
d.text((80, 230), "A home lab run like", font=font(72, True), fill=TEXT)
d.text((80, 315), "a production line.", font=font(72, True), fill=ORANGE)
d.text((80, 440), "Honest KPIs, a SIPOC map and free lean calculators.", font=font(34), fill=MUTED)
d.text((80, 540), "kaizen-lab.io", font=font(32, True), fill=TEXT)
d.text((W - 80 - 330, 544), "small improvements, measured", font=font(26), fill=MUTED)
img.save(root / "site/assets/og-image.png", optimize=True)
print("wrote site/assets/og-image.png")
