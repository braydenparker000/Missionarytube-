# Publishing contract — structured Daily Board v1

No Worker, API, SQL migration or automation cadence change is required.
The existing trusted issue importer and immutable SQLite briefing body are used.
Retain the one existing 07:00 Rosario publisher. The parent owns its cutover.

1. Research and source a real report using [`schema.js`](../frontend/daily-board/v1/schema.js) and the
   [fixtures](../tests/fixtures/daily-board/) as shape
   examples only. Never copy synthetic assertions into reporting.
2. Use schema `jarvis-daily-board-v1`, a stable UUID, explicit Rosario date
   `YYYY-MM-DD`, timezone `America/Argentina/Cordoba`, visibility `public`,
   `synthetic:false`, title (120 chars), summary (1000 chars), and 1–12 stories.
   Stories have stable slug IDs, title, label, composition `flow|split|band`,
   claim `fact|forecast|interpretation`, sources and blocks. Each source has
   title, HTTPS URL without query/fragment/credentials, `publishedOn` and
   `eventOn` (ISO dates or null), and a note clarifying provenance/limitations.
   Blocks are `prose`, `comparison`, `timeline`, `chart`, `explanation`, or
   previously deployed local `image`. All blocks have ID and readable text.
   Use examples for exact per-block keys. Do not use local images unless those
   exact real assets have separately been deployed; no synthetic image is live.
3. Review all prose, links and assets for public visibility. Then prepare:

   `node scripts/daily-board-report.mjs report.json publication.json --reviewed-public`

   This writes locally with exclusive creation. It refuses synthetic content,
   invalid/unknown fields, unsafe URLs, oversized reports, and wrapper overflow.
4. Publish the resulting JSON as a comment using the existing authorized owner
   identity and issue writer. The outer contract is unchanged:
   `{schema:"jarvis-publication-v1",type:"briefing",id,date,title,body}`.
   The body is exactly `summary + "\n\n[Jarvis structured report v1]\n" +
   canonical(report)`, with 20,000 UTF-8 bytes maximum. The complete wrapper
   must also fit the importer's 30,000-character ceiling. Do not hand-escape or
   truncate it. The publisher function `prepare(report,{reviewedPublic:true})`
   returns this exact object for programmatic use.
5. Read the existing `/shared/state?after=0` API (follow nextCursor if present)
   until the matching ID is present. Pass that entry through `decodeReport`;
   compare to the original using `verifyReadback`. Verify matching title/date,
   sources and full content. A comment success is not ingestion proof.
6. Retry the exact same UUID and canonical body after an uncertain result;
   reconcile readback first. Changed content for the same ID or a second
   publication for the same date conflicts. Do not mint another ID to bypass
   an existing date reservation. Escalate genuine corrections for review.

The existing owner/source authentication is unchanged. The public write path
cannot post briefings. Historical plain-text reports render normally. Unsupported
structured reports show their readable summary. No report-supplied JavaScript,
HTML, styles, formulas or remote embeds execute. Publication timestamps come
from trusted GitHub comments, separately from local report and source event dates.

Use the destination issue #250 only after the parent confirms its automation
cutover. Until then the legacy issue remains valid. Both are read by the live
Worker as verified by read-only workflow run 39097771082, commit
64ac7e70db402a1cd3be73217b46e845762f2981, code SHA256
74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d.
