#!/usr/bin/env python3
"""Generate SANTARA brand assets (logo, app icons, favicon) with Pillow."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "public", "assets")
ICONS = os.path.join(ROOT, "public", "icons")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(ICONS, exist_ok=True)

ORBITRON = "/tmp/Orbitron-900.ttf"
POPPINS_B = "/tmp/Poppins-900.ttf"
POPPINS_M = "/tmp/Poppins-700.ttf"

CYAN = (61, 245, 255)
BLUE = (96, 132, 255)
VIOLET = (154, 92, 255)
PINK = (255, 61, 200)
NAVY = (9, 12, 34)
NAVY2 = (16, 20, 56)
WHITE = (255, 255, 255)


def gradient(size, stops, vertical=True):
    w, h = size
    stops = list(reversed(stops))  # top -> bottom
    img = None
    for i, col in enumerate(stops):
        solid = Image.new("RGB", (w, h), col)
        if img is None:
            img = solid
            continue
        g = Image.linear_gradient("L").resize((w, h) if vertical else (h, w))
        if not vertical:
            g = g.transpose(Image.ROTATE_270)
        # fade between stop i-1 and i
        lo = i / (len(stops) - 1)
        hi = 1.0
        mask = g.point(lambda v, lo=lo, hi=hi: int(max(0, min(255, (v / 255.0 - lo) / max(1e-6, hi - lo) * 255))))
        img = Image.composite(solid, img, mask)
    return img


def glow(layer, radius, boost=1.0, color=None):
    a = layer.split()[-1]
    g = a.filter(ImageFilter.GaussianBlur(radius))
    if boost != 1.0:
        g = g.point(lambda v: min(255, int(v * boost)))
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    src = Image.new("RGBA", layer.size, color + (255,) if color else (255, 255, 255, 255))
    out = Image.composite(src, out, g)
    return out


def make_mark(size=1024, pad=0):
    """The SANTARA 'S' road mark on a rounded neon tile."""
    SS = 3  # supersample
    S = size * SS
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # tile
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    r = int(S * 0.235)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=NAVY + (255,))
    # inner gradient sheen
    sheen = gradient((S, S), [NAVY2, (7, 9, 26)], vertical=True)
    mask_tile = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask_tile).rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    tile = Image.composite(Image.new("RGBA", (S, S), sheen.convert("RGBA")[:3] + (255,)) if False else Image.merge("RGBA", (*sheen.split(), Image.new("L", (S, S), 255))), tile, mask_tile)
    canvas.alpha_composite(tile)

    # neon ring
    ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(ring)
    bw = int(S * 0.028)
    dr.rounded_rectangle([bw // 2, bw // 2, S - 1 - bw // 2, S - 1 - bw // 2], radius=r - bw // 2, outline=(255, 255, 255, 255), width=bw)
    grad_ring = gradient((S, S), [CYAN, VIOLET, PINK], vertical=True)
    ring_rgb = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ring_rgb.paste(grad_ring, (0, 0), ring.split()[-1])
    ring_rgb.putalpha(ring.split()[-1])
    canvas.alpha_composite(ring_rgb)
    canvas.alpha_composite(glow(ring_rgb, S * 0.035, 1.1))

    # the S glyph with gradient fill
    f = ImageFont.truetype(ORBITRON, int(S * 0.86))
    gm = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(gm)
    txt = "S"
    bbox = gd.textbbox((0, 0), txt, font=f)
    gd.text((S / 2 - (bbox[0] + bbox[2]) / 2, S / 2 - (bbox[1] + bbox[3]) / 2 - S * 0.01), txt, font=f, fill=255)
    gm = gm.filter(ImageFilter.GaussianBlur(S * 0.004))

    grad_s = gradient((S, S), [(190, 255, 255), CYAN, BLUE, VIOLET, PINK], vertical=True)
    glyph = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glyph.paste(grad_s, (0, 0), gm)
    glyph.putalpha(gm)
    canvas.alpha_composite(glow(glyph, S * 0.05, 0.95))
    canvas.alpha_composite(glyph)

    canvas = canvas.resize((size, size), Image.LANCZOS)
    if pad:
        base = Image.new("RGBA", (size + pad * 2, size + pad * 2), NAVY + (255,))
        base.alpha_composite(canvas, (pad, pad))
        canvas = base
    return canvas


def spaced_text(draw, xy, text, font, fill, spacing, anchor_y_center=False):
    x, y = xy
    total = sum(draw.textlength(c, font=font) + spacing for c in text) - spacing
    if anchor_y_center:
        y = y - font.size / 2
    for c in text:
        draw.text((x, y), c, font=font, fill=fill)
        x += draw.textlength(c, font=font) + spacing
    return total


def make_logo(path_w=1400, path_h=520):
    SS = 2
    W, H = path_w * SS, path_h * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    mark = make_mark(int(H * 0.86))
    img.alpha_composite(mark, (int(H * 0.07), int(H * 0.07)))

    x0 = int(H * 1.06)
    # wordmark
    f = ImageFont.truetype(POPPINS_B, int(H * 0.40))
    gm = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(gm)
    d.text((x0, int(H * 0.16)), "SANTARA", font=f, fill=255)
    grad_w = gradient((W, H), [(225, 255, 255), CYAN, BLUE, VIOLET, PINK], vertical=True)
    word = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    word.paste(grad_w, (0, 0), gm)
    word.putalpha(gm)
    img.alpha_composite(glow(word, H * 0.035, 0.8))
    img.alpha_composite(word)

    # tagline
    ft = ImageFont.truetype(POPPINS_M, int(H * 0.093))
    d2 = ImageDraw.Draw(img)
    spaced_text(d2, (x0 + 3, int(H * 0.66)), "SETIA ANTAR TANPA RAGU", ft, (150, 226, 255, 255), int(H * 0.030))

    # underline bar
    d3 = ImageDraw.Draw(img)
    bar_y = int(H * 0.60)
    bar = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(bar).rounded_rectangle([x0 + 2, bar_y, x0 + int(W * 0.40), bar_y + int(H * 0.022)], radius=int(H * 0.011), fill=(255, 255, 255, 255))
    bg = gradient((W, H), [CYAN, PINK], vertical=False)
    barc = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    barc.paste(bg, (0, 0), bar.split()[-1])
    barc.putalpha(bar.split()[-1])
    img.alpha_composite(barc)

    return img.resize((path_w, path_h), Image.LANCZOS)


def make_splash(path_w=1080, path_h=1080):
    SS = 2
    W, H = path_w * SS, path_h * SS
    img = Image.new("RGB", (W, H), NAVY)
    # radial glows
    for center, col, rad in [((W * 0.28, H * 0.24), (0, 120, 255), W * 0.55),
                             ((W * 0.78, H * 0.30), (255, 40, 180), W * 0.5),
                             ((W * 0.5, H * 0.82), (0, 220, 255), W * 0.6)]:
        gl = Image.new("RGB", (W, H), (0, 0, 0))
        dg = ImageDraw.Draw(gl)
        dg.ellipse([center[0] - rad, center[1] - rad, center[0] + rad, center[1] + rad], fill=col)
        gl = gl.filter(ImageFilter.GaussianBlur(W * 0.13))
        img = Image.blend(img, Image.new("RGB", (W, H), (0, 0, 0)), 0.0)
        img = Image.composite(Image.blend(img, gl, 0.55), img, Image.new("L", (W, H), 255))
    mark = make_mark(int(W * 0.52))
    img.alpha_composite if False else None
    img.paste(mark, (int((W - mark.width) / 2), int(H * 0.22)), mark)
    f = ImageFont.truetype(POPPINS_B, int(W * 0.145))
    d = Image.new("L", (W, H), 0)
    dd = ImageDraw.Draw(d)
    w = dd.textlength("SANTARA", font=f)
    dd.text(((W - w) / 2, H * 0.60), "SANTARA", font=f, fill=255)
    grad_w = gradient((W, H), [(235, 255, 255), CYAN, VIOLET, PINK], vertical=True)
    word = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    word.paste(grad_w, (0, 0), d)
    word.putalpha(d)
    img = img.convert("RGBA")
    img.alpha_composite(glow(word, W * 0.03, 0.9))
    img.alpha_composite(word)
    ft = ImageFont.truetype(POPPINS_M, int(W * 0.038))
    d3 = ImageDraw.Draw(img)
    tw = spaced_text(d3, (0, int(H * 0.78)), "SETIA ANTAR TANPA RAGU", ft, (170, 235, 255, 230), int(W * 0.0125), True) if False else None
    total = sum(d3.textlength(c, font=ft) + int(W * 0.0125) for c in "SETIA ANTAR TANPA RAGU")
    spaced_text(d3, ((W - total) / 2, int(H * 0.775)), "SETIA ANTAR TANPA RAGU", ft, (170, 235, 255, 235), int(W * 0.0125))
    return img.convert("RGB").resize((path_w, path_h), Image.LANCZOS)


if __name__ == "__main__":
    mark = make_mark(1024)
    mark.save(os.path.join(ASSETS, "logo-mark.png"))
    logo = make_logo()
    logo.save(os.path.join(ASSETS, "logo.png"))
    make_splash(1080, 1080).save(os.path.join(ASSETS, "splash.png"))
    make_mark(192).save(os.path.join(ICONS, "icon-192.png"))
    make_mark(512).save(os.path.join(ICONS, "icon-512.png"))
    make_mark(512, pad=64).save(os.path.join(ICONS, "icon-maskable-512.png"))
    make_mark(180).save(os.path.join(ICONS, "apple-touch-icon.png"))
    make_mark(64).save(os.path.join(ICONS, "favicon-64.png"))
    ico = make_mark(256)
    ico.save(os.path.join(ICONS, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("assets done")
