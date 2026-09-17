# Hosting this app & sharing Fabric data publicly

Two questions, investigated with Microsoft Learn sources.

1. [Hosting this web app on Azure](#1-hosting-the-app)
2. [Anonymous / public access to a single Lakehouse file or Kusto dataset](#2-anonymous--public-access)

---

## 1. Hosting the app

### The one real change: identity

Today the proxy gets tokens from the developer's `az login`
(`az account get-access-token`). That's an interactive dev credential — not
hostable. Swap it for **`@azure/identity` `DefaultAzureCredential`**, whose chain
uses the Azure CLI locally **and** a Managed Identity in Azure, so the same code
runs in both places:

```js
import { DefaultAzureCredential } from "@azure/identity";
const credential = new DefaultAzureCredential();
const token = (await credential.getToken("https://storage.azure.com/.default")).token;
// scopes: storage.azure.com/.default (OneLake), database.windows.net/.default (SQL),
//         api.kusto.windows.net/.default (Kusto), analysis.windows.net/powerbi/api/.default (UDF)
```

That is the only structural change to `server/lib/fabric.js`. Everything else
(routes, sources, pmtiles tile server) runs unchanged.
Refs: [credential chains](https://learn.microsoft.com/en-us/azure/developer/javascript/sdk/authentication/credential-chains),
[DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest),
[production best practices](https://learn.microsoft.com/en-us/azure/developer/javascript/sdk/authentication/best-practices).

### Where to host

| Option | Fit | Notes |
|---|---|---|
| **Azure App Service (Linux, Node)** — recommended | Deploy the Node server ~unchanged; it also serves the static frontend | Managed identity, Easy Auth, TLS/custom domains, slots. [Node on App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs) |
| Azure Container Apps | Containerize server + static files | Scale-to-zero, revisions; needs an image/registry. [Container Apps MI](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity) |
| Azure Functions | Refactor routes into HTTP triggers | Serverless; not a natural static-file host. [HTTP triggers](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger) |
| Static Web Apps + linked API | Frontend on SWA, BFF as linked Function/App Service/Container App | **SWA-managed Functions don't support managed identity** — use a *linked* backend. [SWA APIs](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions) |

### Grants the hosted identity needs (system-assigned MI)

Enable **Settings → Identity → System assigned → On**, then grant the same access
we granted the demo:

- **OneLake files:** workspace/lakehouse **Read** (or a scoped OneLake data-access role on the `Files/…` path); tenant setting *"access OneLake with apps external to Fabric"* must allow it. [OneLake access](https://learn.microsoft.com/en-us/fabric/onelake/onelake-access-api), [OneLake roles](https://learn.microsoft.com/en-us/fabric/onelake/security/data-access-control-model)
- **SQL analytics endpoint:** item **Read** + `GRANT SELECT ON OBJECT::dbo.airports TO [<identity>]`. [SQL endpoint security](https://learn.microsoft.com/en-us/fabric/onelake/security/sql-analytics-endpoint-onelake-security)
- **Kusto/Eventhouse:** `.add database <db> viewers ('aadapp=<clientId>;<tenantId>')` — same command we used for the UDF identities. [Kusto DB roles](https://learn.microsoft.com/en-us/kusto/management/manage-database-security-roles?view=microsoft-fabric)
- **UDF invocation:** grant the identity **Execute** on the UDF item. ⚠️ Caveat: SP invocation is documented ([tutorial uses `ClientSecretCredential`](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/tutorial-invoke-from-python-app)), but **managed-identity invocation is not explicitly documented** — validate in-tenant, or use a cert-based service principal just for the UDF call. (UDF *item-management* REST doesn't support SP/MI at all, but that's separate from invocation.)

### Azure Maps for a hosted app

The subscription key is extractable from the browser. For production, prefer
**Entra auth** (give the BFF the *Azure Maps Data Reader* role, expose a small
token endpoint; the Web SDK uses `authType:"anonymous"` + `getToken` — that means
the browser doesn't sign in, **not** that Maps is unauthenticated) or **Maps SAS**.
Set Maps CORS to your deployed origin. [Maps auth best practices](https://learn.microsoft.com/en-us/azure/azure-maps/authentication-best-practices), [SPA auth](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-secure-spa-app)

### App-level auth

- Gate to signed-in users → App Service **Easy Auth** (Entra). [Easy Auth](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization)
- Keep it public → allow anonymous inbound; the BFF's MI does all data auth. **Never let callers pass arbitrary OneLake paths / SQL / KQL** — expose fixed operations only.

### App Service checklist

1. Linux Web App, Node LTS. 2. Listen on `process.env.PORT`. 3. Startup: `node server/server.js`.
4. App settings: workspace/lakehouse/SQL/Kusto/UDF ids + endpoints; `NODE_ENV=production`; Maps auth.
5. Enable system-assigned MI + the grants above. 6. HTTPS Only. 7. Maps CORS. 8. Easy Auth if gating.
9. App Insights (don't log tokens). 10. If public: caching, rate limits, payload limits, fixed routes.

**Recommended:** one Linux App Service running the existing Node server + static
app, `DefaultAzureCredential`, system-assigned MI granted the four accesses above.

---

## 2. Anonymous / public access

### Native anonymous access? No.

| Service | Anonymous? | Why |
|---|---|---|
| **User Data Function** | ❌ | "Public access" = internet-reachable, **still requires an Entra bearer token**; generated OpenAPI uses bearer auth. The internal `authLevel:"Anonymous"` binding does not bypass the Fabric gateway. [invoke tutorial](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/tutorial-invoke-from-python-app) |
| **OneLake / ADLS** | ❌ | Entra Storage-audience token required. OneLake SAS is Entra-backed, ≤ 1 hour, workspace setting off by default. [OneLake auth](https://learn.microsoft.com/en-us/fabric/onelake/onelake-access-api), [OneLake SAS](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shared-access-signature-overview) |
| **Eventhouse / Kusto** | ❌ | Every request needs `Authorization: Bearer <Entra>`. No anonymous query endpoint. [Kusto auth](https://learn.microsoft.com/en-us/kusto/api/rest/authentication?view=microsoft-fabric) |
| **Fabric GraphQL** | ❌ | Requires an authenticated user/SP/MI with Execute. [GraphQL](https://learn.microsoft.com/en-us/fabric/data-engineering/connect-apps-api-graphql) |

> **Emerging exception:** **Fabric Apps** have a preview *anonymous data access* model
> (`@role("anonymous", ...)` + tenant/app controls). It applies to Fabric Apps'
> GraphQL, **not** to the standalone OneLake/Kusto/UDF endpoints. Worth watching.
> [Anonymous data access in Fabric Apps](https://learn.microsoft.com/en-us/fabric/apps/anonymous-data-access)

So public/anonymous sharing always means **(A) copy the data to a public store**, or
**(B) put a fronting service that holds the credential and exposes an anonymous endpoint.**

### Share ONE Lakehouse file publicly

- **A — Copy to Azure Blob (best for static files).** Fabric pipeline **Copy activity** (Lakehouse file → Blob, Binary), or a notebook `notebookutils.fs.cp(...)`; schedule if it changes. Publish via **anonymous blob container** or **Static Website `$web`**; optional Front Door/CDN for custom domain + WAF + caching. Truly anonymous, cacheable, cheapest. [Copy activity](https://learn.microsoft.com/en-us/fabric/data-factory/copy-data-activity), [anonymous blob](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-configure), [static website](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-static-website)
- **B — Anonymous Function/App Service over OneLake (best for dynamic/validated).** MI reads the fixed OneLake path; route is anonymous inbound; add cache/ETag/rate-limit/CORS. **This is exactly this demo's proxy, hosted + MI + public.**
- **C — SAS URL.** Semi-anonymous (bearer in the URL), expiring — good for temporary sharing, not a durable public URL.

**Recommended (one public file):** scheduled Copy → dedicated blob-only-public container (only that file) → Front Door. Use the BFF pattern if the file is sensitive/dynamic or must stay in OneLake.

### Share ONE Kusto dataset publicly

- **A — Anonymous fronting API (best for live data).** Function/App Service, MI granted **Database Viewer**, runs a **fixed parameterized** KQL query, returns stable JSON. Anonymous inbound + parameter allowlist (no raw KQL), short cache, rate limits, CORS. [Kusto auth](https://learn.microsoft.com/en-us/kusto/api/rest/authentication?view=microsoft-fabric)
- **B — Export a snapshot to Blob (best if minutes/hours-stale is OK).** Kusto `.export to (json/parquet/csv) …` on a schedule (or continuous export), then serve the blob anonymously / via Front Door. [.export](https://learn.microsoft.com/en-us/kusto/management/data-export/export-data-to-storage?view=microsoft-fabric), [continuous export](https://learn.microsoft.com/en-us/kusto/management/data-export/continuous-data-export?view=microsoft-fabric)

There is **no native anonymous Kusto endpoint** — it's always a fronting service or exported files.

### This demo is already the pattern

```
anonymous/authed browser  ─▶  hosted BFF  ──(Entra token via MI)──▶  OneLake / SQL / Kusto / UDF
```

To turn it into a public API: **host it → give it a managed identity (instead of dev `az`) → grant that identity only what it needs → allow anonymous inbound → keep routes to a fixed file/query/function contract → add caching/rate limits/CORS.** The browser stays anonymous to the BFF; the BFF is always authenticated to Fabric.
