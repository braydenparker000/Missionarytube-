# Owner–Mast chat activation without Work

`RELAY_MAST_ENABLED` and `RELAY_MAST_TOKEN_SHA256` activate the existing private
chat transport only. Mast Work additionally requires the exact string `true` in
`RELAY_MAST_WORK_ENABLED`. Absent, false, malformed or non-string values keep Work
disabled at both owner and adapter storage boundaries. No Work binding is added
by this release, and no runner, job, grant or schedule is activated.

The approved chat fingerprint is installed only by the deployment repository's
bounded settings flow, preserving the distinct Lucy–Muse channel and all other
bindings. This document contains no private key. Existing Work tests explicitly
enable their synthetic fixture gate; production Work remains disabled.
