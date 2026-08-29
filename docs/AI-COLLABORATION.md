# Claude and Codex collaboration

The default production lane uses different strengths without giving either model unchecked authority.

## Production lane

### 1. Claude implements

Claude receives the issue, acceptance criteria, current `main` commit, repository instructions, and relevant files. It creates the first implementation and a pull request.

### 2. Codex reviews adversarially

Codex reviews the actual diff and checks:

- acceptance-criteria gaps
- reproducible functional bugs
- Android Chrome and touch behavior
- accessibility regressions
- performance and unnecessary work
- unsafe credential or data handling
- error handling and recovery
- architecture complexity
- missing or weak tests

Codex should distinguish proven issues from hypotheses. It may push focused fixes to the same branch after documenting evidence.

### 3. CI and owner decide

Automated checks are the floor. Brayden decides product taste and unresolved tradeoffs. Green CI does not prove the feature is correct, and model confidence is not evidence.

## Fair arena lane

When comparing models, both receive the same task specification and exact base commit. Neither may read the other's branch, PR, commentary, or solution until both submissions are frozen. See [EVALUATION.md](EVALUATION.md).

## Prompt packet

Use the same packet for both models in an arena:

```text
Repository: braydenparker999/Missionarytube-
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
