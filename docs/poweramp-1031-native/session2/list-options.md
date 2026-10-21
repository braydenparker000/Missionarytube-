# Dynamic library configuration

List Options is a real settings surface outside the PreferenceScreen inventory. `ListOptsActivity` constructs controls from the current library entity interfaces, so different lists expose different capabilities. [Machine-readable contracts](list-options-registry.json) retain nine control families and the ten-row scene mapping. Evidence: `PA1031-S2-LIST-001` through `010`.

The verified All Songs chain is radio selection → `ql0`/`tl0` → `sf1.F/I` → `m30.m0/l` in `frp` → zoom/data-change bus event → `p31` → `pd` scene construction or `sf1` query ordering. Other providers share the interface contract but their exact choices and database orderings must not be assumed identical. The registration inventory includes their distinct stored slots without counting each as a fully traced chain.

Zoom values are semantic integers -4 through 5, not ordinal positions in the displayed radio group. Portrait grids have 4, 3 or 2 columns for zoom1,2,5; landscape adds one column below aspect1.8 or two at/above it. Smali confirms floating-point aspect division. Titles Only selects alternate row scenes independently; the three smallest artwork-free modes intrinsically use one line. Row heights come from the resolved `hl0` style object and are not screenshot measurements.

Compact Header is independently stored per category, and the control is disabled when `hl0.u` rejects the font scale. Sort reversal occupies bit0x40000000 while the low bits retain the provider's sort value. Home and visible categories are separate controls: choosing a home does not turn the library into one immutable screen. Fresh initialization sets category home (-1); registration0 and an explicitly selected All Songs0 remain distinct facts.

Search category selection uses an unnamed slot in the `search` store. Remember List Position and Per-track Progress are per-entity database metadata, not global preferences. Duration updates its label while dragging, then commits milliseconds on release. All changes are immediate model mutations; closing the dialog flushes relevant stores, with no Apply button. The unlimited limit tag was checked in compiled APK XML because Apktool's escaped string representation was misleading.

This closes the shared dynamic control mechanism and named All Songs consumers. It does not establish every list's SQL sorting edge cases, every remembered-position playback path, or observed runtime geometry.
