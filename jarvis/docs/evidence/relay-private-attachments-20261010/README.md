# Synthetic private attachment evidence

`linked-private-files-diagnostic.png` is an actual Chromium154 render at390x844
with synthetic PNG/text/PDF fixtures only. It contains no live owner data.

Initial diagnostic backend: e3f4c1a635c77bba5e7e1ee6d0a5cafc586e7f91.
The temporary integration harness supplied the missing capability flag and
normalized ArrayBuffer BLOB bindings for Node SQLite. Staging, linking and content
routes otherwise used the actual backend. Five browser scenarios passed.
This screenshot is visual review evidence, not clean paired-head qualification.
Final paired-head results must be recorded in the PR before integration.

`linked-private-files-clean-pair.png` comes from the unmodified paired backend
`e8f9e2be23520f8eecaf31e65864f28da6214a2e` and frontend
`8dea17b0c20b55836b68e1be58efce6c735515c9`. The local integration commit was
`4efd09b99712d847153c0ca56ddf0ef7d000e715`, tree
`bbeec03f4d301fb763d1b452650abaa89ca0ed51`. All24 focused attachment checks
passed with zero skips, including12 browser cases. No capability injection or
BLOB adapter was used. This is synthetic local Worker/SQLite/browser evidence,
not a live production upload, physical device check or connector usability test.
