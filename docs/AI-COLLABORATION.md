# Delivery ownership and review

Use the canonical [delivery SOP](../.agents/skills/deliver-software-efficiently/SKILL.md)
and [root validation policy](../AGENTS.md#required-checks). These rules replace
the former provider-named serial implementation/review lane.

## Production lane

One assigned delivery owner carries the requested result, acceptance criteria,
exact revision, implementation and evidence through the authorized finish line.
Assign reviewers by affected risk and expertise, not model/provider identity.
A handoff is useful only when it resolves a real dependency or review need.

Small isolated changes require a complete diff review and relevant checks, not
a mandatory second agent or serial handoff. Routine documentation-only work
uses diff/privacy, link and factual checks. Behavioral changes require affected
regression and integration evidence. Shared infrastructure, security and release
changes require adversarial review of contracts, negative cases, recovery and
rollback, with independent review where required by the task or existing
release process. Required CI and publisher qualification remain mandatory.

Reviewers distinguish reproducible defects and acceptance gaps from hypotheses
and unrelated improvements. Review the complete bounded change once, then
verify fixes and their impact. New evidence or material risk can reopen review;
unchanged code does not require another round merely because another agent is
available. Do not ship a known serious defect to satisfy a round or time limit.

The delivery owner reports the revision, changes, checks, acceptance evidence,
remaining uncertainty and actual delivery state. Brayden decides product taste
and unresolved tradeoffs. Green CI does not prove runtime acceptance or authorize
publication, and model confidence is not evidence.

## Fair arena lane

When comparing models, both receive the same task specification and exact base commit. Neither may read the other's branch, PR, commentary, or solution until both submissions are frozen. See [EVALUATION.md](EVALUATION.md).

## Prompt packet

Use the same packet for both models in an arena:

```text
Repository: braydenparker000/Missionarytube-
Task spec: evals/tasks/<task-id>.md
Base commit: <full SHA>
Work only from that commit.
Do not inspect the competing branch or PR.
Run every command listed in the task spec.
Submit one branch and PR with test evidence and known limitations.
Do not self-score or change the acceptance criteria.
```

## Review quality tracking

Code review can itself be an arena category. Give both models the same frozen faulty commit and require findings in a structured report. Score verified true positives, missed seeded defects, severity accuracy, false positives, and actionable fixes. Do not reward volume.
