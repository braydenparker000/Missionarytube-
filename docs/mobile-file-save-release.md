# Scoped mobile file saving publication

Publish only `assets/file-save.js`, `assets/relay-attachment-content.js`, `guitar/runtime.js` and `guitar/guitar.js`, in dependency-first order, from merged source PR150. The existing live source receipt is the Chat/Tasks overlay from PR182; its digest and all three replaced asset hashes are pinned. Main/full release metadata is retained. Do not run the general deployment or any other dispatch option for this change.

The scoped dispatch uses the existing Azure identity, both production locks, an exact trusted source qualification, prewrite backups retained as a workflow artifact, and exact live-byte/MIME/cache checks. The helper rechecks the existing receipt before each file write, compares the entire blob inventory, and verifies actual Worker version/settings before and after publication. No Worker upload, settings mutation, credentials/access change, schedules, agent activation or content upload occurs. The shared helper is fully published before either importer changes.

Receipt assertions and whole-store guards have synthetic refusal tests. The source tests cover authenticated synthetic files only, feature detection, actual user activation at the native API call, cancellation, repeated taps, exact Chromium download bytes and safe Blob URL lifetime. Physical Android save/share sheet and Files validation remains unperformed; emulation is identified as such.

The existing release policy's workflow blob pin is refreshed to match the additional mutually exclusive dispatch. All previous permissions, production conditions and release gates remain required. The full deployment checkout/build remains on its existing pinned source; this operation is a four-file overlay, never a wholesale publication of the later source branch.
