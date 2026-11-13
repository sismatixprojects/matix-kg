#!/usr/bin/env python3
"""Renders the MatixBridge icon and writes every icon RustDesk ships, at the same sizes,
under matix/brand/assets/<same relative path>. Re-run after changing the design:
    python3 matix/brand/gen_assets.py
"""
import json
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "assets")
NAVY, BLUE, WHITE = (15, 23, 42, 255), (59, 130, 246, 255), (255, 255, 255, 255)


MARK = json.load(open(os.path.join(HERE, "source", "matix-mark.json")))
GRAD = [(34, 211, 238), (6, 182, 212), (3, 105, 161)]  # matixerp.com: #22d3ee -> #06b6d4 -> #0369a1


def gradient(size):
    """Diagonal 3-stop gradient, top-left to bottom-right."""
    g = Image.new("RGBA", (size, size))
    gp = g.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            if t < 0.55:
                a, b, u = GRAD[0], GRAD[1], t / 0.55
            else:
                a, b, u = GRAD[1], GRAD[2], (t - 0.55) / 0.45
            gp[x, y] = tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(3)) + (255,)
    return g


def render(size=1024, background=True, pad=0.0, mark_scale=0.56):
    """MatixBridge icon: the white Matix mark on the Matix gradient tile."""
    s = 4 * size  # supersample, then downscale for clean edges
    p = int(s * pad)
    box = s - 2 * p
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    if background:
        tile = gradient(256).resize((box, box), Image.BICUBIC)
        mask = Image.new("L", (box, box), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, box - 1, box - 1], radius=int(box * 14 / 64), fill=255)
        im.paste(tile, (p, p), mask)
    d = ImageDraw.Draw(im)
    w, h = MARK["w"], MARK["h"]
    k = box * mark_scale / max(w, h)
    ox = p + (box - w * k) / 2
    oy = p + (box - h * k) / 2
    for shape in MARK["shapes"]:
        d.polygon([(ox + x * k, oy + y * k) for x, y in shape], fill=WHITE)
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
    fg = render(1024, background=False, pad=0.22, mark_scale=0.62)
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
    ios_bg = gradient(256).resize((1024, 1024), Image.BICUBIC)
    ios_bg.alpha_composite(render(1024, background=False, pad=0.0))
    for name in sorted(os.listdir(os.path.join(REPO, ios))):
        if name.endswith(".png"):
            save_like(f"{ios}/{name}", ios_bg.convert("RGB"))
    # macOS app icon (.icns), built with Apple's iconutil when available (run on a Mac).
    import shutil, subprocess, tempfile
    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = os.path.join(tmp, "AppIcon.iconset")
            os.makedirs(iconset)
            for size in (16, 32, 128, 256, 512):
                for scale in (1, 2):
                    px = size * scale
                    name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
                    mac.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
            dst = os.path.join(OUT, "flutter/macos/Runner/AppIcon.icns")
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            subprocess.run(["iconutil", "-c", "icns", iconset, "-o", dst], check=True)
            print("wrote flutter/macos/Runner/AppIcon.icns")
    else:
        print("skip AppIcon.icns (iconutil not found; run on macOS)")
    # In-app logo (Flutter asset)
    svg_dst = os.path.join(OUT, "flutter/assets/icon.svg")
    os.makedirs(os.path.dirname(svg_dst), exist_ok=True)
    with open(os.path.join(REPO, "matix/web/public/favicon.svg")) as f, open(svg_dst, "w") as g:
        g.write(f.read())
    print("wrote flutter/assets/icon.svg")


if __name__ == "__main__":
    main()
