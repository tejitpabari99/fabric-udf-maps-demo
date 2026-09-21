# Managed identity / service principal setup

The proxy authenticates to Fabric with **`@azure/identity` `DefaultAzureCredential`**
(`server/lib/fabric.js`). The same code resolves a credential in this order:

1. **Service principal** from env vars (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`) — use this for **local dev with no `az login`**.
2. **Managed identity** — used automatically when hosted in Azure (App Service /
   Container Apps / Functions). Pin a user-assigned MI with
   `AZURE_MANAGED_IDENTITY_CLIENT_ID`.
3. **Azure CLI** (`az login`) — developer fallback.

> A **managed identity only exists inside Azure** — it cannot run on your laptop.
> For local testing without `az login` you use a **service principal** (an app
> registration + secret/cert). In Azure you use a real managed identity. Same
> code, because `DefaultAzureCredential` handles both.

The identity (SP locally, MI in Azure) needs the **same four grants** for every
source it touches.

## Concepts: SP vs managed identity vs DefaultAzureCredential

They're related but distinct:

- **Service principal (SP)** — an app identity **with a secret/password you create
  and store**. Works anywhere (including a laptop), but you own the secret.
- **Managed identity (MI)** — an app identity that **Azure creates and manages for a
  hosted resource; no secret exists**. Azure injects and rotates the credential at
  runtime. It **only works inside Azure** (there is no MI on a laptop). Under the
  hood an MI is a special, auto-managed service principal.
- **DefaultAzureCredential** — a **code object** (not an identity) that picks
  whichever credential is available, in order: **SP env vars → managed identity →
  `az login`**. Same code, different credential depending on where it runs.

**Why no SP in Azure?** The hosted app gets a **managed identity** for free — a
passwordless, Azure-managed identity — so there is no SP secret to create or store.
You only need an SP **locally**, because a laptop has no managed identity to borrow
(or you just use `az login` locally).

| Where it runs | Credential used | Secret to manage? |
|---|---|---|
| Laptop, SP env vars set | the service principal | yes (SP secret) |
| Laptop, no SP | your `az login` | no |
| Azure App Service | the app's **managed identity** | **no** |

### How a customer only gets *that* data, not other data

Two **independent** layers:

- **Layer 1 — the app's identity → Fabric.** The BFF's identity (SP/MI) is granted
  **least privilege**: only OneLake read on the one file, only Viewer on the one
  Kusto DB, only Execute on the one UDF. If it isn't granted something, it cannot
  read it.
- **Layer 2 — the customer → the BFF.** The browser talks **only to the BFF**, never
  to Fabric, and **never receives a Fabric token**. The BFF exposes only **fixed,
  hardcoded operations** (e.g. `GET /api/data?source=carpark`). The customer cannot
  request arbitrary files or run arbitrary KQL because those endpoints don't exist.

```
customer (anonymous, no Fabric creds)
      │  can only call fixed BFF endpoints
      ▼
   the BFF  ──(its own MI/SP token, scoped to only what it needs)──▶  the ONE file / ONE dataset
```

So the scoping comes from **both** layers: the BFF only *offers* specific
operations, **and** its identity can only *reach* specific data. The one rule that
keeps this safe: **never let the customer pass a raw path / SQL / KQL** — expose
fixed operations with validated parameters only. For per-customer data separation,
deploy separate BFFs (each identity scoped to its own data) or add authorization
inside the BFF.

## What the identity must be granted

| Access | Audience/scope | Grant |
|---|---|---|
| OneLake files (carpark, pmtiles) | `https://storage.azure.com/.default` | Add the identity to the **Fabric workspace** (Viewer+) or share the Lakehouse **Read**; ideally a scoped OneLake data-access role on the `Files/…` path. Requires the tenant setting *"Users/SPs can access OneLake with apps external to Fabric"*. |
| Lakehouse SQL endpoint (airports) | `https://database.windows.net/.default` | Item **Read** + `GRANT SELECT ON OBJECT::dbo.airports TO [<identity display name>]` on the SQL analytics endpoint. |
| Eventhouse/Kusto (eventstream) | `https://api.kusto.windows.net/.default` | `.add database <db> viewers ('aadapp=<clientId>;<tenantId>')` (DB admin) — same command used for the Eventstream UDF identity. |
| **UDF invocation** (all Function methods) | `https://analysis.windows.net/powerbi/api/.default` | Grant the identity **Execute** on each UDF item (or a workspace role that includes it). |

### The UDF-invocation auth, specifically

In the fronting-service pattern the **BFF is the authenticated caller**: it
acquires a token for `https://analysis.windows.net/powerbi/api/.default` **as its
own identity** and calls the published UDF URL with `Authorization: Bearer …`. The
end user stays anonymous. The identity needs **Execute** on the UDF.

- **Service principal invocation** is documented (the invoke tutorial uses
  `ClientSecretCredential`).
- **Managed-identity invocation** is *not* explicitly documented — validate it in
  your tenant. If MI invocation is rejected, use a certificate/secret-based service
  principal for just the UDF call.
- Note: UDF **item management** (create/publish) never supports SP/MI. UDF
  items are created manually in the Fabric portal by a signed-in user.

## Prerequisites that need an admin / you

1. **Create the service principal** (for local no-`az` testing). In this corp
   tenant, `az ad app create` requires a `ServiceManagementReference` (Service Tree
   ID), so it must be created through the approved app-registration process. You
   then provide: **tenant ID, client ID, client secret**.
   - Or skip local SP and just use `az login` locally; use a managed identity only
     in Azure.
2. **Fabric tenant setting** *"Service principals can use Fabric APIs"* (and the
   OneLake external-apps setting) must be **enabled** by a Fabric admin, and the SP
   added to a security group if the setting is group-scoped.
3. For Azure hosting later: a **subscription + resource group** where the App
   Service and its managed identity can be created.

## Local dev with the service principal (no az login)

Put the SP values in `.env` (gitignored):

```
AZURE_TENANT_ID=<tenant-guid>
AZURE_CLIENT_ID=<app-client-id>
AZURE_CLIENT_SECRET=<secret>
```

`DefaultAzureCredential` picks these up first (EnvironmentCredential), so the proxy
uses the SP and never calls `az`. Remove them to fall back to `az login`.

## In Azure (managed identity)

1. Enable **system-assigned managed identity** on the App Service (Settings →
   Identity → System assigned → On), or create a **user-assigned** MI and set
   `AZURE_MANAGED_IDENTITY_CLIENT_ID`.
2. Apply the four grants above to that MI's principal.
3. No secret in config — `DefaultAzureCredential` uses the MI automatically.

## Verify

```powershell
# with SP env vars set (no az login):
node -e "require('./server/lib/fabric').getAzToken('https://storage.azure.com').then(t=>console.log('token len',t.length)).catch(e=>{console.error(e.message);process.exit(1)})"
# then exercise each source:
#   http://localhost:3000/api/data?source=carpark&method=direct
#   http://localhost:3000/api/data?source=eventstream&method=function   (UDF Execute needed)
```

Once the SP/MI is verified for all sources, the `az`-specific fallback can be
dropped from `getAzToken`.
