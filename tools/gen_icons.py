#!/usr/bin/env python3
"""生成鸿升中学智能电源管理图标（应用图标 + 托盘图标）"""
from PIL import Image, ImageDraw
import math
import os

OUT = '/workspace/hongsheng-power/src-tauri/icons'
os.makedirs(OUT, exist_ok=True)

C1 = (46, 91, 255)    # 鸿升蓝 #2E5BFF
C2 = (109, 77, 246)   # 鸿升紫 #6D4DF6
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def make_icon(size, with_round_rect=True):
    S = 4
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))

    # 渐变圆角方块背景
    grad = Image.new('RGB', (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(C1, C2, y / W))
    if with_round_rect:
        radius = int(W * 0.225)
        mask = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=255)
        img.paste(grad, (0, 0), mask)
    else:
        img.paste(grad, (0, 0))

    d = ImageDraw.Draw(img)
    cx, cy = W / 2, W * 0.56
    r = W * 0.265
    lw = max(2, int(W * 0.058))

    # 电源符号圆弧（顶部留缺口）
    d.arc([cx - r, cy - r, cx + r, cy + r], start=305, end=595, fill=WHITE, width=lw)
    a1, a2 = math.radians(305), math.radians(235)
    for a in (a1, a2):
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        d.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=WHITE)

    # 电源竖线
    stem_top, stem_bot = cy - r - W * 0.05, cy - r + W * 0.04
    d.line([(cx, stem_top), (cx, stem_bot)], fill=WHITE, width=lw)
    for yy in (stem_top, stem_bot):
        d.ellipse([cx - lw / 2, yy - lw / 2, cx + lw / 2, yy + lw / 2], fill=WHITE)

    # 时钟指针（10:10 经典角度）
    hand_lw = max(2, int(W * 0.046))
    def hand(angle_from_12, length):
        a = math.radians(angle_from_12 - 90)
        x, y = cx + length * math.cos(a), cy + length * math.sin(a)
        d.line([(cx, cy), (x, y)], fill=WHITE, width=hand_lw)
        d.ellipse([x - hand_lw / 2, y - hand_lw / 2, x + hand_lw / 2, y + hand_lw / 2], fill=WHITE)

    hand(302, r * 0.55)
    hand(58, r * 0.74)
    d.ellipse([cx - hand_lw * 0.75, cy - hand_lw * 0.75, cx + hand_lw * 0.75, cy + hand_lw * 0.75], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


# 应用图标
make_icon(1024).save(f'{OUT}/icon.png')
make_icon(512).save(f'{OUT}/icon_512.png')
make_icon(256).save(f'{OUT}/128x128@2x.png')
make_icon(128).save(f'{OUT}/128x128.png')
make_icon(32).save(f'{OUT}/32x32.png')

# Windows ICO（多尺寸）
icon = make_icon(256)
icon.save(
    f'{OUT}/icon.ico',
    format='ICO',
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

# 托盘图标（32px，透明底圆角方块）
make_icon(32).save(f'{OUT}/tray.png')
make_icon(44).save(f'{OUT}/tray_44.png')

print('icons generated:', sorted(os.listdir(OUT)))
