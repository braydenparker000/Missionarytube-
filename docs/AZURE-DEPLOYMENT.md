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
