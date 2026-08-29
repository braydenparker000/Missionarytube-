# Arena task: <task-id>

Status: draft
Category: <new feature implementation | UI/UX | debugging | refactoring | performance | architecture | code review | robustness>
Base commit: <full 40-character SHA>

## Goal

Describe one meaningful outcome without prescribing a model-specific implementation.

## Constraints

- Static Azure Storage compatibility
- Android Chrome is the primary client
- No credentials or private user configuration
- No inspection of the competing branch or PR
- Add task-specific constraints here

## Acceptance criteria

Use observable, independently verifiable statements.

1. Given ..., when ..., then ...
2. Given ..., when ..., then ...
3. ...

## Required commands

```bash
npm test
npm run build
# Add identical task-specific commands for both competitors.
```

## Test fixtures and edge cases

List frozen fixtures, offline behavior, invalid input, empty state, large input, and recovery cases.

## Performance budget

Define the device/runtime, warm-up, repetitions, metric, and threshold. Write `not scored` if irrelevant.

## Scoring weights

| Measure | Points |
| --- | ---: |
| Functional acceptance criteria | 50 |
| Regression safety | 15 |
| Robustness and edge cases | 15 |
| Performance budget | 10 |
| Accessibility and UX | 10 |

## Critical disqualifiers

List security, privacy, corruption, or data-loss behavior that makes a submission ineligible.

## Submission record

- Claude branch:
- Claude commit:
- Codex branch:
- Codex commit:
- Contamination check:
