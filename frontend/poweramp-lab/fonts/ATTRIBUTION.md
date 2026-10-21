# Manrope

The variable TrueType source was obtained directly from the official Google
Fonts repository, independently of the Poweramp APK. This distribution provides
`Manrope-wght.woff`, converted to WOFF1 using FontTools so the existing static
publisher serves the recognized font MIME type.
It is distributed under the SIL Open Font License 1.1; the complete upstream
copyright notice and license accompany it in `OFL-Manrope.txt`.

- Project: https://github.com/googlefonts/manrope
- Official distribution: https://github.com/google/fonts/tree/main/ofl/manrope
- Font download: https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf
- License download: https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt
- Retrieved: 2026-10-21 UTC, from the `main` reference.
- Original upstream TrueType SHA-256: `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6`
- License SHA-256: `58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b`
- Distributed WOFF1 SHA-256: `dc07002260c96a6eb4094277999f375a0fe4e91fb5a59980fb86b843a211a521`
- Variable weight axis: 200–800. FontTools `TTFont` with `flavor="woff"` changed
  the container format/compression. Glyph outlines, naming/license records and
  the weight axis were retained; no design edits were made. The source TrueType
  file is not included in the runtime route.

The accompanying upstream license credits Copyright 2018 The Manrope Project
Authors. The font's embedded metadata additionally contains the project's 2019
copyright and the same OFL license declaration; both are retained unchanged.

## Reconstruction role and remaining difference

The independently authored player uses Manrope for its Alternative font option.
The native research identified that option through
`ActivityTheme_Whitepro_AltFont → AltFont_font → @font/manrope_smaller`.
The APK's family declaration assigns its regular variant to weight400 and its
extrabold variant to weight700. This establishes the family role, not equality
between the APK's `*_smaller` resources and this upstream variable font version.
See native evidence `PA1031-S2-STYLE-010` and the font-family declaration
`decoded/res/font/manrope_smaller.xml` in the private research workspace.

No APK font payload was copied. Exact glyph metrics/version equivalence remains
unverified. The native Bold option uses TTNormsPro; this build continues to use
an explicitly documented system-font fallback for that role.
