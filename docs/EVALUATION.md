# Claude vs Codex evaluation system

The goal is evidence about which workflow performs best on MissionaryTube—not a universal model ranking.

## Categories

- new feature implementation
- UI/UX
- debugging
- refactoring
- performance
- architecture
- code review
- robustness

## Create an arena task

1. Create the task from `evals/tasks/TEMPLATE.md`.
2. Record a full, immutable base commit SHA from `main`.
3. Define observable acceptance criteria before either model starts.
4. Add deterministic tests, performance budgets, fixtures, or seeded defects where appropriate.
5. Freeze the specification.
6. Create both branches directly from the same SHA:
   - `arena/<task-id>/claude`
   - `arena/<task-id>/codex`
7. Give both models the identical prompt packet from `docs/AI-COLLABORATION.md`.
8. Keep each branch and PR hidden from the other model until both are submitted.

If either model sees the other solution, label the run contaminated and do not use it for the headline comparison.

## Scoring

Each task defines its weights before work begins. The default 100-point rubric is:

| Measure | Points | Evidence |
| --- | ---: | --- |
| Functional acceptance criteria | 50 | Automated tests or reproducible manual script |
| Regression safety | 15 | Existing CI and targeted regression tests |
| Robustness and edge cases | 15 | Predeclared invalid/offline/empty/large-input cases |
| Performance budget | 10 | Repeatable timing, memory, request, or size measurement |
| Accessibility and UX | 10 | Automated checks plus blinded owner rubric |

Rules:

- A security or data-loss failure marked critical in the task makes the submission ineligible, regardless of total.
- A submission that does not build receives zero for criteria that cannot be executed.
- Record raw measurements, not just points.
- Do not use model self-scores.
- Do not change tests after viewing a solution unless both are rerun from scratch.
- Time and token usage may be recorded, but they are not scored unless the task declares why and how in advance.
- For architecture, refactoring, and review tasks, replace weights in the frozen spec with task-relevant measurable checks.

For visual work, Brayden reviews anonymized builds labeled A and B against the same short rubric before learning which model produced each one.

## Recording results

Append a result object to `evals/results/scoreboard.json` that validates against `evals/schema/result.schema.json`. Include:

- task ID and category
- base commit
- both model/version labels
- branch and commit SHAs
- raw test and performance evidence
- score breakdown
- contamination status
- winner or tie
- short decision rationale

Commit result records through a pull request so the history remains auditable. Aggregate results only after several tasks per category; one task is a data point, not a verdict.
