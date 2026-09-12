"""Generates PWA icon PNGs for My Reading Library. Run with: python gen-icons.py"""
from PIL import Image, ImageDraw
import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (99, 102, 241)      # --primary-color
BG_DARK = (15, 23, 42)   # --background
WHITE = (248, 250, 252)


def draw_book(draw, cx, cy, scale, color):
    # Open book: two trapezoid "pages" meeting at a center spine.
    w = scale * 0.78
    h = scale * 0.52
    spine_x = cx
    top_y = cy - h / 2
    bottom_y = cy + h / 2
    lift = scale * 0.06  # outer corners lift up slightly

    left_page = [
        (spine_x, top_y),
        (spine_x - w, top_y - lift),
        (spine_x - w, bottom_y - lift),
        (spine_x, bottom_y),
    ]
    right_page = [
        (spine_x, top_y),
        (spine_x + w, top_y - lift),
        (spine_x + w, bottom_y - lift),
        (spine_x, bottom_y),
    ]
    draw.polygon(left_page, fill=color)
    draw.polygon(right_page, fill=color)

    # Spine line
    draw.line([(spine_x, top_y), (spine_x, bottom_y)], fill=BG, width=max(2, int(scale * 0.03)))

    # Page lines (a few short strokes on each page)
    line_w = max(1, int(scale * 0.018))
    for i in range(3):
        frac = 0.35 + i * 0.18
        y = top_y + (bottom_y - top_y) * frac
        lift_y = -lift * (1 - frac)
        draw.line(
            [(spine_x - w * 0.75, y + lift_y), (spine_x - w * 0.15, y)],
            fill=BG, width=line_w,
        )
        draw.line(
            [(spine_x + w * 0.15, y), (spine_x + w * 0.75, y + lift_y)],
            fill=BG, width=line_w,
        )


def make_icon(size, path, padding_ratio=0.12, rounded=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if rounded:
        radius = int(size * 0.22)
        draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=BG)
    else:
        draw.rectangle([(0, 0), (size - 1, size - 1)], fill=BG)

    content_scale = size * (1 - padding_ratio * 2)
    draw_book(draw, size / 2, size / 2, content_scale, WHITE)

    img.save(path, "PNG")


def make_maskable(size, path):
    # Maskable icons need extra safe-zone padding (~20%) since OSes crop to shape.
    make_icon(size, path, padding_ratio=0.22, rounded=False)


sizes = [16, 32, 48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512]
for s in sizes:
    make_icon(s, os.path.join(OUT_DIR, f"icon-{s}.png"))

make_maskable(192, os.path.join(OUT_DIR, "icon-maskable-192.png"))
make_maskable(512, os.path.join(OUT_DIR, "icon-maskable-512.png"))

# Favicon.ico with multiple embedded sizes
fav_sizes = [16, 32, 48]
fav_imgs = [Image.open(os.path.join(OUT_DIR, f"icon-{s}.png")) for s in fav_sizes]
fav_imgs[0].save(
    os.path.join(os.path.dirname(__file__), "..", "favicon.ico"),
    format="ICO",
    sizes=[(s, s) for s in fav_sizes],
)

print("Icons generated in", OUT_DIR)
