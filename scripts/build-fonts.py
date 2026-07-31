#!/usr/bin/env python3
"""
Rebuild the embedded Mulish subsets used by the Open Graph renderer.

Two things this does that a plain `pyftsubset` call does not:

1. **Subsets to Latin-1 + Latin Extended-A**, which is what en/de/es need. That
   takes each weight from 104 KB to ~21 KB (12 KB gzipped).

2. **Normalises the name table.** Google Fonts ships the ExtraBold face with
   family name "Mulish ExtraBold" rather than family "Mulish" + subfamily
   "ExtraBold". resvg matches fonts by family *then* weight, so the shipped
   naming means `font-family="Mulish" font-weight="800"` silently falls back to
   the regular face and every headline renders thin. Rewriting the name table
   is what makes weight selection work.

Usage:  python3 scripts/build-fonts.py
Requires: fonttools, and network access to Google Fonts.
"""

import io
import sys
import urllib.request

from fontTools.ttLib import TTFont
from fontTools import subset

FAMILY = "Mulish"
# Old UA so Google Fonts serves TTF rather than WOFF2, which resvg cannot read.
UA = "Mozilla/5.0 (Windows NT 6.1)"

UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0100-017F,"
    "U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+00B7,U+20AC"
)

WEIGHTS = {400: "Regular", 800: "ExtraBold"}


def fetch_ttf(weight: int) -> bytes:
    css_url = f"https://fonts.googleapis.com/css2?family={FAMILY}:wght@{weight}&display=swap"
    req = urllib.request.Request(css_url, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req, timeout=30).read().decode()
    start = css.find("https://")
    end = min(x for x in (css.find(".ttf", start), css.find(".woff", start)) if x != -1)
    url = css[start : end + 4]
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read()


def set_names(font: TTFont, weight: int) -> None:
    """Force family='Mulish', subfamily=<style>, so weight matching resolves."""
    style = WEIGHTS[weight]
    full = FAMILY if weight == 400 else f"{FAMILY} {style}"
    ps = full.replace(" ", "")
    for record in font["name"].names:
        nid = record.nameID
        if nid == 1:
            record.string = FAMILY
        elif nid == 2:
            record.string = style
        elif nid == 4:
            record.string = full
        elif nid == 6:
            record.string = ps
    font["OS/2"].usWeightClass = weight


def main() -> int:
    for weight in WEIGHTS:
        raw = fetch_ttf(weight)
        font = TTFont(io.BytesIO(raw))

        options = subset.Options()
        options.layout_features = []
        options.hinting = False
        options.desubroutinize = True
        options.drop_tables += ["GSUB", "GPOS", "GDEF", "DSIG", "kern"]
        options.name_IDs = ["*"]  # keep names so we can rewrite them below
        options.notdef_outline = True

        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
        subsetter.subset(font)

        set_names(font, weight)

        out = f"worker/assets/mulish-{weight}.ttf"
        font.save(out)

        check = TTFont(out)
        print(
            f"  {out}: family={check['name'].getDebugName(1)!r} "
            f"subfamily={check['name'].getDebugName(2)!r} "
            f"usWeightClass={check['OS/2'].usWeightClass} "
            f"size={len(open(out, 'rb').read()) / 1024:.0f} KB"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
