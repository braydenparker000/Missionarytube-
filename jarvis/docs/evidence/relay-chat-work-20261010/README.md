# Chat-first work fixture evidence

These are synthetic private conversations served by the real Worker/SQLite and
MCP test handlers in an isolated browser. No live owner messages were read or
changed. Node22.23.3 and Chrome for Testing154.0.8037.97 were used at320×740.

- `chat-work-progress-320.png`: normal chat remains unclassified; the actionable
  request is named by the assistant and shows authenticated progress in place.
- `chat-work-plan-320.png`: the existing v6 task inspector shows goal and plan;
  the deliberately hostile HTML string remains visible inert text.

The candidate is based directly on Relay PR94 head
`3c17c1868bcaf75762d5311d77119a6256975981`. No Podcast changes are included.
The final PR description records exact-head test and hosted qualification results.
Live connector activation is a release-lead follow-up, described in
[the responder procedure](../../relay-chat-first-work.md).
