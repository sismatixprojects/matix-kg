#!/usr/bin/env python3
"""Renders the Matix KG icon and writes every icon RustDesk ships, at the same sizes,
under matix/brand/assets/<same relative path>. Re-run after changing the design:
    python3 matix/brand/gen_assets.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "assets")
NAVY, BLUE, WHITE = (15, 23, 42, 255), (59, 130, 246, 255), (255, 255, 255, 255)


def render(size=1024, background=True, pad=0.0):
    s = 4 * size  # supersample, then downscale for clean edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = int(s * pad)
    box = s - 2 * p
    u = box / 64.0  # design grid matches public/favicon.svg (64x64)
    X = lambda v: p + v * u
    if background:
        d.rounded_rectangle([X(0), X(0), X(64), X(64)], radius=14 * u, fill=NAVY)
    w = 4 * u
    d.rounded_rectangle([X(12), X(15), X(52), X(42)], radius=4 * u, outline=BLUE, width=int(w))
    d.line([X(26), X(50), X(38), X(50)], fill=BLUE, width=int(w))
    d.line([X(32), X(42), X(32), X(50)], fill=BLUE, width=int(w))
    for cx, cy in ((26, 50), (38, 50)):
        d.ellipse([X(cx) - w / 2, X(cy) - w / 2, X(cx) + w / 2, X(cy) + w / 2], fill=BLUE)
    cursor = [(28, 21), (39, 28), (34, 29.3), (37, 34.5), (34.4, 36), (31.4, 30.8), (28, 34.5)]
    d.polygon([(X(a), X(b)) for a, b in cursor], fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)


def save_like(rel, im_full, foreground=False):
    """Writes an icon at the same path and pixel size as RustDesk's original."""
    src = os.path.join(REPO, rel)
    if not os.path.exists(src):
        print("skip (missing upstream):", rel)
        return
    w, h = Image.open(src).size
    dst = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im = im_full.resize((w, h), Image.LANCZOS)
    if rel.endswith(".png"):
        im.save(dst, optimize=True)
    print("wrote", rel, f"{w}x{h}")


def main():
    full = render(1024)
    fg = render(1024, background=False, pad=0.18)
    mac = render(1024, pad=0.1)  # macOS icons sit inside a margin
    for rel in ["res/icon.png", "res/128x128.png", "res/128x128@2x.png", "res/64x64.png", "res/32x32.png"]:
        save_like(rel, full)
    save_like("res/mac-icon.png", mac)
    # Windows .ico files
    for rel in ["res/icon.ico", "res/tray-icon.ico", "flutter/windows/runner/resources/app_icon.ico"]:
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        full.save(dst, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        print("wrote", rel)
    # Android launcher icons
    res = "flutter/android/app/src/main/res"
    for dpi in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
        save_like(f"{res}/mipmap-{dpi}/ic_launcher.png", full)
        save_like(f"{res}/mipmap-{dpi}/ic_launcher_round.png", full)
        save_like(f"{res}/mipmap-{dpi}/ic_launcher_foreground.png", fg)
    # iOS app icons
    ios = "flutter/ios/Runner/Assets.xcassets/AppIcon.appiconset"
    ios_bg = Image.new("RGBA", (1024, 1024), NAVY)
    ios_bg.alpha_composite(render(1024, background=False, pad=0.06))
    for name in sorted(os.listdir(os.path.join(REPO, ios))):
        if name.endswith(".png"):
            save_like(f"{ios}/{name}", ios_bg.convert("RGB"))
    # In-app logo (Flutter asset)
    svg_dst = os.path.join(OUT, "flutter/assets/icon.svg")
    os.makedirs(os.path.dirname(svg_dst), exist_ok=True)
    with open(os.path.join(REPO, "matix/web/public/favicon.svg")) as f, open(svg_dst, "w") as g:
        g.write(f.read())
    print("wrote flutter/assets/icon.svg")


if __name__ == "__main__":
    main()
