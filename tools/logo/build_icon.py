"""Build the Age of RMS app icon as a flat vector SVG.

Four isometric land tiles in a diamond, one per terrain family a script can
paint: mountain (top), forest (left), water (right) and desert (bottom). Flat
fills, two tones per object, one outline colour. No gradients or textures, so
it stays crisp from 1024 px down to 16 px.

Writes public/logo/age-of-rms-icon.svg and, under tools/logo/out/, a 1024 px
PNG and the 32 px title bar icon (copy that one to public/app-icon.png). Run
`python tools/logo/build_icon.py` from age-of-rms/, then
`npx tauri icon tools/logo/out/age-of-rms-icon-1024.png` for the full set, and
delete the android and ios folders it adds, since the app ships on Windows
only. Needs `pip install resvg-py`.
"""

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SIZE = 256
W, H, T = 58, 38, 20  # tile half-width, half-height, thickness
CX, CY = 128, 118  # centre of the 2x2 diamond
OUTLINE = "#1d2736"
LINE = 3.2

EARTH_L, EARTH_R = "#8a5d36", "#5f3e24"


def pts(points):
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def poly(points, fill, stroke=None, width=LINE):
    extra = (
        f' stroke="{stroke}" stroke-width="{width}" stroke-linejoin="round"'
        if stroke
        else ""
    )
    return f'<polygon points="{pts(points)}" fill="{fill}"{extra}/>'


def line(points, colour, width):
    return (
        f'<polyline points="{pts(points)}" fill="none" stroke="{colour}" '
        f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def tile(cx, cy, top_fill):
    top = [(cx, cy - H), (cx + W, cy), (cx, cy + H), (cx - W, cy)]
    left = [(cx - W, cy), (cx, cy + H), (cx, cy + H + T), (cx - W, cy + T)]
    right = [(cx, cy + H), (cx + W, cy), (cx + W, cy + T), (cx, cy + H + T)]
    return (
        poly(left, EARTH_L, OUTLINE)
        + poly(right, EARTH_R, OUTLINE)
        + poly(top, top_fill, OUTLINE)
    )


def pine(x, y, s=1.0):
    """A pine standing with its trunk base at (x, y)."""
    out = [f'<rect x="{x - 1.6 * s:.1f}" y="{y - 4 * s:.1f}" width="{3.2 * s:.1f}" height="{4 * s:.1f}" fill="#5a3a1e"/>']
    for lift, half, top in ((3, 9, 13), (10, 7, 12), (17, 5, 11)):
        base = y - lift * s
        apex = base - top * s
        left = [(x, apex), (x - half * s, base), (x, base)]
        right = [(x, apex), (x, base), (x + half * s, base)]
        out.append(poly(left, "#3f8a34"))
        out.append(poly(right, "#2a6628"))
    return "".join(out)


def peak(x, y, half, height):
    """A mountain with a snow cap, base centred on (x, y)."""
    apex = (x, y - height)
    left_base, right_base = (x - half, y), (x + half, y)
    shade = [apex, (x + 2, y - height * 0.45), (x - 3, y), right_base]
    f = 0.38  # where the snow line sits, as a fraction of the height
    sl = (apex[0] + (left_base[0] - apex[0]) * f, apex[1] + (left_base[1] - apex[1]) * f)
    sr = (apex[0] + (right_base[0] - apex[0]) * f, apex[1] + (right_base[1] - apex[1]) * f)
    mid_x = (sl[0] + sr[0]) / 2
    drop = height * f
    cap = [apex, sr, (mid_x + half * 0.16, sr[1] - drop * 0.35), (mid_x - half * 0.02, sr[1] + drop * 0.05), (mid_x - half * 0.2, sl[1] - drop * 0.25), sl]
    return (
        poly([apex, left_base, right_base], "#6f8296")
        + poly(shade, "#52657a")
        + poly(cap, "#f4f8fc")
        + poly([apex, sr, (mid_x + half * 0.16, sr[1] - drop * 0.35), (mid_x + half * 0.02, apex[1] + drop * 0.5)], "#cdd9e6")
    )


def wave(x, y, length, amp):
    steps = 12
    points = [
        (x + length * i / steps, y + amp * math.sin(2 * math.pi * i / steps * 1.5))
        for i in range(steps + 1)
    ]
    return line(points, "#d7ecff", 2.6)


def palm(x, y):
    """A palm with its trunk base at (x, y), fronds fanned from the crown."""
    crown = (x + 5, y - 24)
    trunk = line([(x, y), (x + 1, y - 12), crown], "#7a4e26", 3.4)
    fronds = ""
    for dx, dy in ((-17, 5), (-12, -4), (-4, -9), (6, -9), (14, -3), (18, 6)):
        mid = (crown[0] + dx * 0.55, crown[1] + dy * 0.55 - 4)
        tip = (crown[0] + dx, crown[1] + dy)
        under = (crown[0] + dx * 0.5, crown[1] + dy * 0.5 + 2.5)
        fronds += poly([crown, mid, tip, under], "#2f8a3a")
    nuts = poly([(crown[0] - 2, crown[1]), (crown[0] + 2, crown[1]), (crown[0], crown[1] + 3)], "#5a3a1e")
    return trunk + fronds + nuts


def dune(x, y, length, rise):
    """A dune crest as one smooth arc, drawn as a short polyline."""
    steps = 10
    points = [
        (x + length * i / steps, y - rise * math.sin(math.pi * i / steps))
        for i in range(steps + 1)
    ]
    return line(points, "#c99a45", 3)


def build():
    top_c, left_c = (CX, CY - H), (CX - W, CY)
    right_c, bot_c = (CX + W, CY), (CX, CY + H)

    parts = [tile(*top_c, "#9fb1c2")]
    parts.append(peak(top_c[0] - 16, top_c[1] + 4.5, 24, 36))
    parts.append(peak(top_c[0] + 17, top_c[1] + 9.5, 17, 25))

    parts.append(tile(*left_c, "#6aaa4a"))
    for dx, dy, s in ((-18, 2, 1.05), (8, -8, 0.88), (17, 7, 1.1), (-3, 11, 0.8)):
        parts.append(pine(left_c[0] + dx, left_c[1] + dy, s))

    parts.append(tile(*right_c, "#2f86d6"))
    for dx, dy in ((-28, -4), (-5, -13), (-12, 9), (11, 3)):
        parts.append(wave(right_c[0] + dx, right_c[1] + dy, 19, 1.5))

    parts.append(tile(*bot_c, "#e3bb6a"))
    parts.append(dune(bot_c[0] - 40, bot_c[1] + 4, 26, 6))
    parts.append(dune(bot_c[0] + 1, bot_c[1] + 12, 28, 6))
    parts.append(palm(bot_c[0] - 6, bot_c[1] + 6))

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" '
        f'role="img" aria-label="Age of RMS">{"".join(parts)}</svg>\n'
    )


def main():
    svg = build()
    out = ROOT / "public" / "logo"
    out.mkdir(parents=True, exist_ok=True)
    (out / "age-of-rms-icon.svg").write_text(svg, encoding="utf-8", newline="\n")

    import resvg_py

    for size, name in ((1024, "age-of-rms-icon-1024.png"), (32, "app-icon.png")):
        data = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
        target = ROOT / "tools" / "logo" / "out" / name
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(bytes(data))
    print("ok")


if __name__ == "__main__":
    main()
