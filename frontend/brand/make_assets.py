"""Cut every logo asset the app needs out of the brand artwork.

    python brand/make_assets.py        (from frontend/, needs Pillow)

The artwork, `wealthos-logo.png`, is a wide banner: the ribbon W with rising
bars, the name, and the tagline, on dark navy. Its background is partly
transparent in patches, so it is first laid on its own navy. Then:

- the mark (the W and bars) is lifted out and set on a navy tile, at the sizes
  and shapes each place wants: the in-app logo, the browser tab, the home
  screen on Android and iOS, and notifications;
- the whole banner becomes the picture shown when a link to the app is shared.

The name beside the mark is not an image. The app sets it in its own type
(`Brand` in `src/components/layout/AppShell.tsx`), so it stays sharp at any
size and follows the light and dark themes.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
PUBLIC = HERE.parent / "public"
NAVY = (1, 6, 19)  # the artwork's own background
# Where the mark sits in the artwork, without the glow under it. The name starts at x = 739.
MARK = (216, 136, 701, 548)
GLOW = 26  # how far around the mark to carry its glow before fading into the tile


def artwork() -> Image.Image:
    """The banner on solid navy."""
    art = Image.open(HERE / "wealthos-logo.png").convert("RGBA")
    flat = Image.new("RGBA", art.size, (*NAVY, 255))
    flat.alpha_composite(art)
    return flat.convert("RGB")


def mark_tile(art: Image.Image, size: int, fill: float, radius: float = 0.0) -> Image.Image:
    """The mark centred on a navy square. `fill` is the share of the square its longer side takes;
    `radius` rounds the corners (as a share of the side) and leaves them transparent."""
    work = 1024  # drawn large and reduced, so small icons stay clean
    left, top, right, bottom = MARK
    box = (left - GLOW, top - GLOW, right + GLOW, bottom + GLOW)
    scale = work * fill / max(right - left, bottom - top)
    piece = art.crop(box)
    piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)

    # Fade the edges of the cut-out, so its glow melts into the tile with no visible box.
    edge = round(GLOW * scale)
    mask = Image.new("L", piece.size, 0)
    ImageDraw.Draw(mask).rectangle((edge, edge, piece.width - edge, piece.height - edge), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(edge / 2.2))

    tile = Image.new("RGB", (work, work), NAVY)
    tile.paste(piece, ((work - piece.width) // 2, (work - piece.height) // 2), mask)
    tile = tile.resize((size, size), Image.LANCZOS).convert("RGBA")
    if radius:
        big = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(big).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * radius), fill=255)
        tile.putalpha(big.resize((size, size), Image.LANCZOS))
    return tile


def share_card(art: Image.Image) -> Image.Image:
    """The whole banner at the 1200 × 630 that link previews use."""
    width, height = 1200, 630
    banner = art.resize((width, round(art.height * width / art.width)), Image.LANCZOS)
    # The banner is shorter than the card: fade its top and bottom into navy.
    fade = 36
    mask = Image.new("L", banner.size, 255)
    draw = ImageDraw.Draw(mask)
    for i in range(fade):
        shade = round(255 * i / fade)
        draw.line((0, i, width, i), fill=shade)
        draw.line((0, banner.height - 1 - i, width, banner.height - 1 - i), fill=shade)
    card = Image.new("RGB", (width, height), NAVY)
    card.paste(banner, (0, (height - banner.height) // 2), mask)
    return card


def main() -> None:
    art = artwork()
    made = {
        # In the app: the tile is rounded in CSS, and drawn at up to 44 px, so 192 covers the sharpest screens.
        "logo-mark.png": mark_tile(art, 192, fill=0.80),
        # Browser tab. Small, so the mark fills more of the tile.
        "favicon-32.png": mark_tile(art, 32, fill=0.84, radius=0.22),
        # Installed app on Android and desktop: a rounded tile, and a full square whose mark stays inside the safe circle.
        "pwa-192.png": mark_tile(art, 192, fill=0.72, radius=0.22),
        "pwa-512.png": mark_tile(art, 512, fill=0.72, radius=0.22),
        "pwa-maskable-512.png": mark_tile(art, 512, fill=0.56),
        # iOS home screen: a full square with no transparency; iOS rounds it itself.
        "apple-touch-icon.png": mark_tile(art, 180, fill=0.70).convert("RGB"),
        "og-image.png": share_card(art),
    }
    for name, image in made.items():
        image.save(PUBLIC / name, optimize=True)
        print(f"{name:24} {image.width} x {image.height}")
    # Older browsers ask for /favicon.ico whatever the page says.
    mark_tile(art, 256, fill=0.84, radius=0.22).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"{'favicon.ico':24} 16, 32, 48")


if __name__ == "__main__":
    main()
