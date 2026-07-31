# Embedded fonts

`mulish-400.ttf` and `mulish-800.ttf` are **subsets** of [Mulish](https://github.com/googlefonts/mulish)
by Vernon Adams, Cyreal and Jacques Le Bailly, licensed under the
**SIL Open Font License 1.1** — see [Mulish-OFL.txt](Mulish-OFL.txt).

They are embedded (rather than fetched at runtime) because a Cloudflare Worker has no system fonts,
and satori needs real font data to lay out text. Fetching a font per request would add a network
round trip to every social-crawler hit and a new failure mode.

Subset with:

```bash
python3 -m fontTools.subset mulish-<weight>.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+00B7,U+20AC" \
  --layout-features='' --no-hinting --desubroutinize \
  --drop-tables+=GSUB,GPOS,GDEF,DSIG,kern \
  --output-file=mulish-<weight>-subset.ttf
```

That covers Latin-1 and Latin Extended-A, which is what en/de/es need, and takes each weight from
104 KB to 21 KB (12 KB gzipped).

**Emoji are deliberately not covered.** Mulish has no emoji glyphs and an emoji font would cost more
than the rest of the bundle, so the generated card is typographic — the Kitty's emoji still appears
in the `og:title` text, which every social client renders itself.
