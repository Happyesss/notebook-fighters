import os
import glob, json
from PIL import Image, ImageDraw
D = ["clean","sloppy","fourArms","swordsman","quadruped","blob","loneCircle","snake","car","tree","plusSign","bigHead"]
M = ["idle","walk","jump","punch","kick","crouch","block","hit","hitlow","ko","victory"]
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots"); IT = "it14"
def frames(d, m): return sorted(glob.glob(f"{S}/{IT}_{d}/{m}_[0-9][0-9].png"))
def names(d):
    for l in open(f"{S}/{IT}_{d}/log.txt"):
        if l.startswith("moves:"): return json.loads(l[6:])
    return {}
# ---- GIF: every drawing doing the same move at once (4 x 3 grid)
CW, CH = 270, 170
counts = {m: min(len(frames(d, m)) for d in D) for m in M}
out = []
for m in M:
    for i in range(counts[m]):
        g = Image.new("RGB", (CW*4, CH*3+24), (246,240,226)); dr = ImageDraw.Draw(g)
        dr.text((8,6), f"Notebook Fighters - every drawing, same button: {m.upper()}", fill=(40,30,20))
        for k, d in enumerate(D):
            im = Image.open(frames(d, m)[i]).convert("RGB"); im.thumbnail((CW-6, CH-18))
            x, y = (k%4)*CW, 24+(k//4)*CH
            g.paste(im, (x+3+(CW-6-im.width)//2, y+16))
            mv = names(d); lab = d + (f"  ({mv.get('punch')})" if m=="punch" else f"  ({mv.get('kick')})" if m=="kick" else "")
            dr.text((x+6,y+2), lab, fill=(120,40,40))
        out.append(g.resize((g.width*3//4, g.height*3//4), Image.LANCZOS))
    out += [out[-1]]*3
# one shared palette (median cut over a montage keeps the coloured inks), no dithering: small frame diffs → a small GIF
sample = out[::8]
mont = Image.new("RGB", (sample[0].width, sample[0].height*len(sample)))
for k, f in enumerate(sample): mont.paste(f, (0, k*f.height))
pal = mont.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
out = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in out]
out[0].save(f"{S}/moves.gif", save_all=True, append_images=out[1:], duration=110, loop=0, optimize=True)
print(len(out), "gif frames", counts)
# ---- PNG: drawing x move, the key frame of each (plus run/air specials when the body has them)
cols = M + ["x_charge","x_pounce"]
CW2, CH2 = 150, 96
png = Image.new("RGB", (100 + CW2*len(cols), 22 + CH2*len(D)), (246,240,226)); dr = ImageDraw.Draw(png)
for c, m in enumerate(cols): dr.text((100 + c*CW2 + 4, 6), m.replace("x_","run/air: "), fill=(40,30,20))
DP = D[:10] + ["carLeft"] + D[10:]
png = Image.new("RGB", (100 + CW2*len(cols), 22 + CH2*len(DP)), (246,240,226)); dr = ImageDraw.Draw(png)
for c, m in enumerate(cols): dr.text((100 + c*CW2 + 4, 6), m.replace("x_","run/air: "), fill=(40,30,20))
for r, d in enumerate(DP):
    mv = names(d)
    dr.text((4, 22 + r*CH2 + 30), d, fill=(120,40,40))
    dr.text((4, 22 + r*CH2 + 44), f"{mv.get('punch')}/{mv.get('kick')}", fill=(90,90,90))
    for c, m in enumerate(cols):
        f = frames(d, m)
        if not f: continue
        pick = {"ko": len(f)-1, "victory": len(f)//2, "idle": 0}.get(m, int(len(f)*0.45))
        im = Image.open(f[pick]).convert("RGB"); im.thumbnail((CW2-4, CH2-4))
        png.paste(im, (100 + c*CW2 + 2, 22 + r*CH2 + 2))
png.save(f"{S}/moves.png"); print("png", png.size)
