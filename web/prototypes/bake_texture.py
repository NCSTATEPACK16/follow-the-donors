"""Bake the riso texture plates as seamless tiling PNGs.

Grain is ONE baked tiling PNG at low opacity — never an SVG filter and never a
per-frame canvas. That is this project's oldest performance rule: nothing
competes with tile fetches on cellular. Baking it here rather than generating
it in the browser also makes the texture a reviewable artifact with a fixed
byte cost instead of a startup cost that varies by device.

Three plates, because a riso print has three distinct textures and collapsing
them into one generic "noise" is what makes digital riso look like a filter:

  grain    — paper tooth. High frequency, low amplitude, everywhere.
  mottle   — ink coverage variation. Low frequency; the drum does not lay a
             perfectly even field, so large areas breathe.
  speckle  — stray ink. Sparse isolated dots, the roller picking up debris.

Run:  .venv/bin/python web/prototypes/bake_texture.py
"""

import math
import os
import random
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "texture")


def write_png(path, width, height, pixels):
    """Minimal grayscale+alpha PNG writer. No Pillow dependency: the venv is
    pinned for the data pipeline and a texture script must not widen it."""
    raw = b"".join(
        b"\x00" + bytes(v for px in row for v in px) for row in pixels
    )

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 4, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


def tiling_value_noise(size, cells, seed, octaves=1):
    """Value noise on a torus, so the tile repeats without a visible seam.

    Lattice indices wrap modulo `cells`, which is what makes it seamless;
    a plain random field would show a hard edge every `size` pixels and the
    repeat would read as a grid — the single most common tell of fake grain.
    """
    field = [[0.0] * size for _ in range(size)]
    amp_total = 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        amp = 1.0 / (2 ** o)
        amp_total += amp
        rnd = random.Random(seed + o * 977)
        lat = [[rnd.random() for _ in range(c)] for _ in range(c)]
        for y in range(size):
            fy = y / size * c
            y0 = int(fy) % c
            y1 = (y0 + 1) % c
            ty = fy - int(fy)
            wy = ty * ty * (3 - 2 * ty)
            for x in range(size):
                fx = x / size * c
                x0 = int(fx) % c
                x1 = (x0 + 1) % c
                tx = fx - int(fx)
                wx = tx * tx * (3 - 2 * tx)
                a = lat[y0][x0] + (lat[y0][x1] - lat[y0][x0]) * wx
                b = lat[y1][x0] + (lat[y1][x1] - lat[y1][x0]) * wx
                field[y][x] += (a + (b - a) * wy) * amp
    return [[v / amp_total for v in row] for row in field]


def bake_grain(size=128, seed=7):
    """Paper tooth: fine, near-white, mostly transparent."""
    fine = tiling_value_noise(size, size // 2, seed, octaves=2)
    rnd = random.Random(seed + 1)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            n = fine[y][x] * 0.6 + rnd.random() * 0.4      # hash noise on top
            lum = 30 if n < 0.5 else 235                    # bipolar: tooth + fleck
            alpha = int(abs(n - 0.5) * 2 * 46)              # <= 0.18 opacity
            row.append((lum, alpha))
        rows.append(row)
    return size, size, rows


def bake_mottle(size=256, seed=23):
    """Ink coverage variation: large, soft, dark-only."""
    # Higher frequency than a "cloud": at 4 cells the mottle reads as dirt
    # on the paper rather than as uneven ink coverage. 10 cells over 256px
    # puts the variation at roughly the scale of a district.
    low = tiling_value_noise(size, 10, seed, octaves=3)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            n = low[y][x]
            # dark-only: ink pools, it does not un-print the paper
            alpha = int(max(0.0, (n - 0.48)) * 2.0 * 38)
            row.append((20, min(38, alpha)))
        rows.append(row)
    return size, size, rows


def bake_speckle(size=256, seed=41):
    """Stray ink: sparse hard dots, 1-2px, no falloff."""
    rnd = random.Random(seed)
    rows = [[(0, 0) for _ in range(size)] for _ in range(size)]
    for _ in range(int(size * size * 0.0016)):
        cx, cy = rnd.randrange(size), rnd.randrange(size)
        r = rnd.choice([0, 0, 0, 1])
        a = rnd.randint(70, 150)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy > r * r:
                    continue
                rows[(cy + dy) % size][(cx + dx) % size] = (15, a)
    return size, size, rows


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (("grain-128", bake_grain),
                     ("mottle-256", bake_mottle),
                     ("speckle-256", bake_speckle)):
        w, h, px = fn()
        n = write_png(os.path.join(OUT, f"{name}.png"), w, h, px)
        print(f"{name}.png  {w}x{h}  {n:,} bytes")


if __name__ == "__main__":
    main()
