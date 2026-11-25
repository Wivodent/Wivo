"""
The work type pictures, from the large originals to the small WebP files the
app bundles. Run through scripts/optimize-worktype-images.mjs (see there).

For each PNG in assets-src/worktypes/3d/ (and its options/ folder):

1. The background is evened out to pure white. The originals are white
   objects (teeth, crowns, trays) on an almost-white background (about 253),
   with no transparency. Cutting the background out does not come out clean:
   the cut runs into the white of the teeth and leaves specks of the
   background's noise. So the background stays, made exactly white, and the
   app shows these pictures on a white plate (components/ui/WorkTypeArt.tsx).
   A picture that already has transparency keeps it.
2. Cropped to the object (and its shadow), centred in a square with a margin.
3. Resized to SIZE x SIZE and saved as WebP at QUALITY under
   src/renderer/src/assets/worktypes/3d/ with the same name.

Needs Pillow and numpy (`pip install pillow numpy`).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-src' / 'worktypes' / '3d'
OUT = ROOT / 'src' / 'renderer' / 'src' / 'assets' / 'worktypes' / '3d'

SIZE = 384
QUALITY = 85
MARGIN = 0.07        # free space around the object, of the square's side
OBJECT = 14          # a pixel this far from the background is part of the picture
TARGET_BYTES = 60_000


def has_transparency(im: Image.Image) -> bool:
    if im.mode not in ('RGBA', 'LA') and 'transparency' not in im.info:
        return False
    return np.asarray(im.convert('RGBA').getchannel('A')).min() < 250


def background_colour(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return np.median(border, axis=0)


def whiten(im: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """The background scaled to pure white, and the box around everything else."""
    rgb = np.asarray(im.convert('RGB'), dtype=np.float32)
    bg = background_colour(rgb)
    ys, xs = np.nonzero(np.abs(rgb - bg).max(axis=2) > OBJECT)
    box = (0, 0, im.width, im.height) if len(xs) == 0 else (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    white = np.clip(rgb * (255.0 / np.maximum(bg, 1)), 0, 255).astype(np.uint8)
    return Image.fromarray(white, 'RGB'), box


def square(im: Image.Image, box: tuple[int, int, int, int], fill) -> Image.Image:
    obj = im.crop(box)
    side = int(max(obj.width, obj.height) / (1 - 2 * MARGIN))
    canvas = Image.new(im.mode, (side, side), fill)
    canvas.paste(obj, ((side - obj.width) // 2, (side - obj.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def convert(src: Path, out: Path) -> int:
    im = Image.open(src)
    if has_transparency(im):
        im = im.convert('RGBA')
        result = square(im, im.getbbox() or (0, 0, im.width, im.height), (0, 0, 0, 0))
    else:
        white, box = whiten(im)
        result = square(white, box, (255, 255, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    result.save(out, 'WEBP', quality=QUALITY, method=6)
    return out.stat().st_size


def main(names: list[str]) -> int:
    sources = sorted(SRC.glob('*.png')) + sorted((SRC / 'options').glob('*.png'))
    if names:
        sources = [p for p in sources if p.stem in names]
    if not sources:
        print(f'No PNG files in {SRC} (or none of: {" ".join(names)}).')
        return 1
    big = []
    total = 0
    for src in sources:
        rel = src.relative_to(SRC).with_suffix('.webp')
        size = convert(src, OUT / rel)
        total += size
        over = size > TARGET_BYTES
        if over:
            big.append(rel.as_posix())
        print(f'{rel.as_posix():36} {size / 1024:6.1f} KB{"  (over 60 KB)" if over else ""}')
    print(f'{len(sources)} pictures, {total / 1024:.0f} KB in all.')
    if big:
        print('Over 60 KB: ' + ', '.join(big))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
