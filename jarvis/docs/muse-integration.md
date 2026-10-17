# Muse conversation

`/muse/` is a static client for the existing shared Worker. The transport and GitHub publication protocol are unchanged. User bodies carry `[Jarvis Muse v1]` plus a newline; replies are routed by `replyTo`. The verified historical connection test `f62e9e27-d106-465c-a2e7-c4dd64323040` belongs to this channel too. All pagination must finish before routing or deciding a message is unanswered.

`channels.js` filters views only. `/jarvis/` and the default `/reader/` exclude Muse; `/reader/?channel=muse` includes only Muse and no Daily Board posts. Original messages remain in shared storage. Muse drafts and queued messages use `jarvis.muse.v1`, independent of Jarvis and Quick AI. A fresh read precedes sends so an uncertain POST can be confirmed without duplicating it. Retries preserve the original message UUID.

`/muse/setup.txt` contains the complete activation instructions for the user's already connected Muse app. No API key is embedded or requested. The page cannot verify an external Muse schedule and must not label it active merely because a historical reply exists. The requested task is every 15 minutes; support, task creation and an unattended scheduled run must be verified inside Muse. No webhook is currently connected. Empty checks should exit early; frequency consumes Muse allowance and is not a guarantee of unlimited usage.

The existing ChatGPT task `6aaf7ee498108191baff16f91ac0865f` keeps its original cadence, enablement and prompt, with a final paragraph headed `Muse channel routing:` added solely to exclude this channel. Daily Board and other tasks are unchanged.

## Deployment and rollback

Source baseline: `de3b21f8153fdb49a15d2461755dbcdc126ff739`.
Storage deployment baseline: `007ec6531b39849042d9c6d98e98568ad719753a` in `braydenparker000/Missionarytube-`.

Deploy through the existing Storage workflow, which backs up current blobs before upload. Preserve the Azure account, hostname, federation, permissions, frontend-only size guard, and Quick AI deployment secret injection. No Worker deployment is needed.

If rolling back, first pause any activated Muse task in the Muse app. Roll the frontend source and Storage release pin back through their normal workflows (or restore the workflow's pre-deployment blob artifact). Preserve the channel exclusions in the hourly responder while tagged messages remain in the inbox; otherwise the old reader exposes them to ChatGPT. Historical messages and publications must not be deleted. Do not remove the hourly exclusion paragraph until the Muse messages have a separate safe routing plan.

Validation: `npm test` covers exact-prefix routing, target-based replies, reader isolation, old test routing, body limits, damaged drafts, uncertain writes, and messages queued during sync. Live checks should verify sending, refresh/reload, draft preservation, Setup copy, default-reader exclusion, Muse-reader inclusion, the Storage site, and the existing Quick AI / DrawerCast links. Final scheduled execution and delivery require the Muse account.
