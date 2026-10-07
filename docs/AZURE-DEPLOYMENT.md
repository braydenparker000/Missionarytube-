# Azure Storage deployment

Production URL: https://missionarytube.z13.web.core.windows.net/

The workflow at `.github/workflows/deploy-azure-storage.yml` is committed but safely gated. It runs only when the repository variable `AZURE_DEPLOY_ENABLED` equals `true`. Once enabled, every accepted push to `main` builds `dist/` and uploads it to the Azure Storage static website container.

Authentication uses GitHub OpenID Connect (OIDC), which exchanges a GitHub identity token for a short-lived Azure token. No Azure storage key, client secret, connection string, or long-lived credential belongs in the repository.

## One-time setup from a phone

Use the Azure portal in a mobile browser; desktop-site mode may make the menus easier.

### 1. Create the Azure deployment identity

1. Open Microsoft Entra ID in the Azure portal.
2. Open **App registrations** and create an app such as `missionarytube-github-deploy`.
3. Record its **Application (client) ID** and **Directory (tenant) ID**.
4. Record the Azure **Subscription ID** from **Subscriptions**.
5. Do not create a client secret.

### 2. Restrict the identity to this repository

1. In the app registration, open **Certificates & secrets** → **Federated credentials**.
2. Add the **GitHub Actions deploying Azure resources** scenario.
3. Set organization/user to `braydenparker999`.
4. Set repository to `Missionarytube-`.
5. Set entity type to **Branch** and branch to `main`.
6. Keep the recommended audience `api://AzureADTokenExchange`.
7. Save.

Use the Azure GitHub scenario picker instead of manually inventing an OIDC subject. GitHub repositories created after July 15, 2026 can use immutable repository-ID claims.

### 3. Grant minimum Azure access

1. Open the storage account serving the production URL.
2. Open **Access control (IAM)** → **Add role assignment**.
3. Choose **Storage Blob Data Contributor**.
4. Assign access to the service principal created by the app registration.
5. Scope it to this storage account only.

Role propagation can take several minutes.

### 4. Add GitHub Actions configuration

In GitHub, open this repository → **Settings** → **Secrets and variables** → **Actions**.

Create repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Create repository variables:

- `AZURE_STORAGE_ACCOUNT` = the storage account name only
- leave `AZURE_DEPLOY_ENABLED` unset for the first test

These values are settings, never repository file contents.

### 5. Test, then enable automatic deployment

1. Temporarily set `AZURE_DEPLOY_ENABLED` to `true`.
2. Open **Actions** → **Deploy to Azure Storage** → **Run workflow** on `main`.
3. Confirm the login, build, and upload steps succeed.
4. Open the production URL in a private tab and verify the expected site.
5. Keep `AZURE_DEPLOY_ENABLED=true`; future pushes to `main` deploy automatically.
6. If the test fails or the wrong storage account was selected, immediately set the variable to `false` or delete it before troubleshooting.

The upload overwrites matching files but intentionally does not delete unrelated blobs. This avoids destructive cleanup during early setup. Once the repository layout is stable, a separately reviewed cleanup strategy can be added.

## Readiness and complete rollback backup join

The exact immutable frontend is verified before provider credentials. Worker
preparation/deployment and the qualified-dependency check remain backend-first.
Public configuration is sealed and the existing API/CORS gate passes before
Azure OIDC login and the fixed `missionarytube` target guard.

After that guard, `overlap-jarvis-prewrite.mjs` runs the unchanged real podcast
search/RSS/audio readiness script alongside the unchanged read-only full `$web`
backup helper. Azure OIDC therefore occurs before podcast readiness finishes;
this only advances the already-authorized rollback read. No new credentials,
permissions, account, alternate authentication route or storage write is added.
Readiness receives runtime/network settings and runner process bookkeeping,
without provider-secret or OIDC capability environment variables. Its `HOME`,
`XDG_CONFIG_HOME` and `AZURE_CONFIG_DIR` point to dedicated, initially empty
temporary directories; only backup inherits the original Azure session paths.
The temporary directories are removed after both lane exits, including failure
and cancellation. Both processes run as the same UID, so this reduces accidental
credential discovery and is not a security sandbox against intentional access.

Both lanes must succeed before recording the actual Worker identity. The Worker
checkpoint upload retains `always()` so failed readiness/backup still preserves
available rollback information. A successful storage rollback artifact upload
is additionally required before catalog publication or any frontend overwrite.
The later configured-byte checks, backend rechecks, homepage-last promotion,
final mobile playback and digest-bound receipt are unchanged.

Each lane runs in a supervised POSIX process group. Failure, timeout, SIGINT or
SIGTERM terminates all lane groups, escalates after one second and awaits their
exit. Runner tracking remains available for forced supervisor termination.
Readiness's 30-minute overall failure-path cap retains its existing multi-attempt
publisher budgets; backup's four-minute overall cap retains the existing
30-second inventory and 120-second transfer limits. Authentication, inventory,
corrupt transfers or other backup failures still fail closed. Only missing
AzCopy (`ENOENT`) selects the existing Azure CLI transport.

The overlap helper is part of the reviewed Worker receipt recipe. A recipe
change requires a truthful successful-production bootstrap before later warm
reuse. Concurrent local tests establish ordering and failure safety, not a
measured production speedup; production benefit needs a separate real warm-run
measurement after review and publication approval.
