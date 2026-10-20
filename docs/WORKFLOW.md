# Developing and shipping Jarvis

Use [README.md](../README.md#develop) for the maintained source layout, commands,
release inputs and rollback procedure. [AGENTS.md](../AGENTS.md) and the existing
[delivery skill](../.agents/skills/deliver-software-efficiently/SKILL.md) define
validation and authorization requirements.

Edit `frontend/` for UI, `backend/` for the Worker, and `scripts/` for tooling.
Work on a focused branch, test the affected behavior, review one coherent PR,
and wait for required CI. Source provenance is generated automatically; feature
work does not update pin files or historical compatibility fixtures.

A merge commit and production deployment each require explicit owner approval.
Frontend changes use **Deploy to Azure Storage** on the reviewed main SHA and
its successful Validate artifact. Worker changes use the existing separate
Worker publisher. Verify the publisher's readback and the actual live behavior.
Report code reviewed, merged, deployed and verified as separate states.

Older source snapshots and release maps are historical evidence. They do not
select current application source or authorize a new publication.
