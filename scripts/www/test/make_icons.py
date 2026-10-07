# 生成 PWA 图标（纯代码绘制，不下载任何素材）
# 产出：img/icon-192.png、img/icon-512.png、img/icon-maskable-512.png、img/favicon.ico
import os
import math
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "img")
os.makedirs(OUT, exist_ok=True)

BG = (250, 240, 235)       # #FAF0EB 页面底色
CARD = (255, 255, 255)     # 日历卡片
CARD_EDGE = (232, 213, 200)  # #E8D5C8
HEAD = (255, 107, 107)     # #FF6B6B 主色
RING = (232, 184, 154)     # #E8B89A
DOT = (247, 208, 138)      # #F7D08A


def rounded(draw, box, radius, fill, outline=None, width=0):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def head_shape(draw, box, y_mid, r, fill):
    """上圆角、下缘平直的色带：整幅矩形铺满，两个上角用四分之一圆补圆"""
    x0, y0, x1 = box[0], box[1], box[2]
    draw.rectangle([x0, y0, x1, y_mid], fill=fill)
    draw.pieslice([x0, y0, x0 + 2 * r, y0 + 2 * r], 180, 270, fill=fill)
    draw.pieslice([x1 - 2 * r, y0, x1, y0 + 2 * r], 270, 360, fill=fill)


def make_icon(size, pad_ratio=0.16, maskable=False):
    """maskable=True 时内容更小，保证被圆形/方形裁切后仍完整"""
    S = size * 4  # 4 倍超采样，缩小时更平滑
    img = Image.new("RGBA", (S, S), BG + (255,))
    d = ImageDraw.Draw(img)

    inset = S * (0.26 if maskable else pad_ratio)
    box = [inset, inset + S * 0.02, S - inset, S - inset - S * 0.02]
    w = box[2] - box[0]
    h = box[3] - box[1]
    r = w * 0.18
    head_h = max(h * 0.28, r * 1.05)   # 色带要高过圆角半径，否则会看成弧形
    y_mid = box[1] + head_h
    lw = max(2, int(S * 0.007))

    # 卡片阴影
    rounded(d, [box[0], box[1] + h * 0.045, box[2], box[3] + h * 0.045], r, (232, 220, 212, 255))
    # 白色卡片
    rounded(d, box, r, CARD + (255,))
    # 顶部色带
    head_shape(d, box, y_mid, r, HEAD + (255,))
    # 描边最后画，压在色带之上
    rounded(d, box, r, None, CARD_EDGE + (255,), lw)

    # 两个挂环（画在顶栏之上）
    ring_w = w * 0.075
    ring_h = h * 0.13
    for cx in (box[0] + w * 0.27, box[0] + w * 0.73):
        d.rounded_rectangle(
            [cx - ring_w / 2, box[1] - ring_h * 0.42, cx + ring_w / 2, box[1] + ring_h * 0.72],
            radius=ring_w / 2, fill=RING + (255,),
        )

    # 日期格：3 列 × 2 行
    pad_x = w * 0.13
    gap_x = w * 0.065
    gap_y = h * 0.07
    top = y_mid + h * 0.10
    bottom = box[3] - h * 0.085
    cw = (w - pad_x * 2 - gap_x * 2) / 3
    ch = (bottom - top - gap_y) / 2
    for row in range(2):
        for col in range(3):
            x = box[0] + pad_x + col * (cw + gap_x)
            y = top + row * (ch + gap_y)
            fill = HEAD + (255,) if (row == 0 and col == 1) else DOT + (255,)
            rounded(d, [x, y, x + cw, y + ch], cw * 0.22, fill)

    return img.resize((size, size), Image.LANCZOS)


print("generating icons…")
for name, px in {"icon-192.png": 192, "icon-512.png": 512}.items():
    p = os.path.join(OUT, name)
    make_icon(px).save(p, "PNG", optimize=True)
    print(" ", p, os.path.getsize(p), "bytes")

p = os.path.join(OUT, "icon-maskable-512.png")
make_icon(512, maskable=True).save(p, "PNG", optimize=True)
print(" ", p, os.path.getsize(p), "bytes")

ico = os.path.join(OUT, "favicon.ico")
make_icon(256).save(ico, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(" ", ico, os.path.getsize(ico), "bytes")
print("OK")
