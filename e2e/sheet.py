import os
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont
it = sys.argv[1]; moves = sys.argv[2].split(",") ; out = sys.argv[3]
cell = int(sys.argv[4]) if len(sys.argv) > 4 else 150
rows = []
for m in moves:
    files = sorted(glob.glob(f"{os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')}/{it}/{m}_[0-9][0-9].png"))
    rows.append((m, files))
cols = max(len(f) for _, f in rows)
W = 90 + cols * cell
imgs = []
for m, files in rows:
    if not files: continue
    im0 = Image.open(files[0]); ar = im0.height / im0.width
    h = int(cell * ar)
    row = Image.new("RGB", (W, h + 4), (246, 240, 226))
    d = ImageDraw.Draw(row); d.text((6, h // 2), m, fill=(40, 30, 20))
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB").resize((cell, h))
        row.paste(im, (90 + i * cell, 2))
    imgs.append(row)
H = sum(r.height for r in imgs)
sheet = Image.new("RGB", (W, H), (255, 255, 255)); y = 0
for r in imgs: sheet.paste(r, (0, y)); y += r.height
sheet.save(out); print(out, sheet.size)
