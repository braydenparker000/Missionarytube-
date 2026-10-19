# Local Manrope font

Source: Google Fonts, `ofl/manrope/Manrope[wght].ttf`, retrieved 2026-10-10 from https://github.com/google/fonts/tree/main/ofl/manrope.
License: SIL Open Font License 1.1; see OFL.txt.

`manrope-latin.woff` retains variable weights 200–800 and Latin/Latin Extended characters, combining marks, general punctuation, arrows, euro, trademark and minus. Other scripts use the system fallback. It is served locally, cached with the podcast shell and used only by `.podcast-page`.

Reproduce with FontTools:

```sh
pyftsubset 'Manrope[wght].ttf' --output-file=manrope-latin.woff --flavor=woff --unicodes='U+0000-024F,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212' --layout-features='*'
```
