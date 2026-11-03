# Draws the Oazy Council icon: the council ring around a gold chair, on a dark tile.
import math, sys, os
from PIL import Image, ImageDraw, ImageFilter
N = 1024
root = os.path.join(os.path.dirname(__file__), '..')
img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
bg = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(bg)
d.rounded_rectangle([40, 40, N - 40, N - 40], radius=220, fill=(10, 12, 22, 255))
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
g.ellipse([290, 290, N - 290, N - 290], fill=(255, 215, 106, 90)); glow = glow.filter(ImageFilter.GaussianBlur(80))
bg.alpha_composite(glow)
cols = [(91, 140, 255), (176, 108, 255), (255, 107, 129), (255, 181, 71), (47, 214, 168), (51, 195, 255)]
d = ImageDraw.Draw(bg)
cx = cy = N / 2
# outer ring of the universe
for i in range(120):
    a = i / 120 * 2 * math.pi
    t = (i / 120) * len(cols); c0 = cols[int(t) % len(cols)]; c1 = cols[(int(t) + 1) % len(cols)]; f = t - int(t)
    c = tuple(int(c0[k] * (1 - f) + c1[k] * f) for k in range(3))
    r = 352; x, y = cx + math.cos(a) * r, cy + math.sin(a) * r; s = 9
    d.ellipse([x - s, y - s, x + s, y + s], fill=c + (255,))
# seats
for i in range(8):
    a = -math.pi / 2 + i / 8 * 2 * math.pi + math.pi / 8
    r = 238; x, y = cx + math.cos(a) * r, cy + math.sin(a) * r; s = 40
    c = cols[i % len(cols)]
    d.ellipse([x - s, y - s, x + s, y + s], fill=c + (255,))
    d.ellipse([x - s + 10, y - s + 8, x - s + 34, y - s + 28], fill=(255, 255, 255, 70))
# the chair
s = 112
d.ellipse([cx - s, cy - s, cx + s, cy + s], fill=(255, 215, 106, 255))
d.ellipse([cx - s + 24, cy - s + 24, cx + s - 24, cy + s - 24], fill=(10, 12, 22, 255))
d.ellipse([cx - 40, cy - 40, cx + 40, cy + 40], fill=(255, 215, 106, 255))
img.alpha_composite(bg)
img.save(os.path.join(root, 'app', 'icon.png'))
img.resize((512, 512), Image.LANCZOS).save(os.path.join(root, 'mobile', 'icon.png'))
os.makedirs(os.path.join(root, 'build'), exist_ok=True)
img.save(os.path.join(root, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
# Android launcher icons
for name, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    p = os.path.join(root, 'android', 'res', 'mipmap-' + name); os.makedirs(p, exist_ok=True)
    img.resize((px, px), Image.LANCZOS).save(os.path.join(p, 'ic_launcher.png'))
print('icons written')
