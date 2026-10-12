# Date Added repair

Base: release/astra-live-backport-20261009 at d7daef3d6aa43fdb9d6622843aa50d9de8a075d5.

Native R2 import assigned Date.now() to every track. Both r2Tracks and the IndexedDB cursor merge preserved old.added, so changing only the importer could not repair existing installations. Equal timestamps fell through to alphabetical title sorting; reversing also moved unknown dates to the front.

Native R2 dates now come from validated r2Identity.lastModified (object upload time), marked addedSource=r2-upload. The list explains this basis explicitly: original library-add dates are unavailable. No dates are inferred from filenames, titles, catalog generation time or import time. Local/Drive date semantics are unchanged. Native refresh and offline cached discovery repair legacy timestamps while retaining IDs, ratings, plays, resume position and custom artwork.

Date Added defaults newest first. Reverse selects oldest first. Unknown/nonpositive dates stay last and ties retain input/library order in either direction. An all-unknown category keeps its order and reports unavailable metadata.

Reproduction: the new tests against untouched d7daef3 yield 3 failures (15 existing tests pass): native expected upload 1700000002000 instead of import wall clock; equal dates sort alphabetically; all-unknown reverse changes order. The same tests pass after the repair.

Live catalog read from this environment failed with ECONNREFUSED; no claim is made about the live distribution of dates. No deployment or catalog writes were performed.

Validation: 188 targeted Node tests passed. Native R2 Chromium lifecycle tests passed. The same three local library-history timeouts reproduce on unchanged d7daef3. CI poweramp, frontend, blank-library, migration, relay, owner24 and podcasts lanes passed on ccea437. The performance lane stopped at its full-source candidate fingerprint before measuring; the candidate pin is updated for this source change, retaining the frozen v8 baseline and every geometry, pixel and performance gate.
