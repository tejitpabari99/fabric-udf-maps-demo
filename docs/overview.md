# Overview

A small, end-to-end demo that answers one question:

> **How do you take data that lives in Microsoft Fabric (a Lakehouse file, a
> Lakehouse table, an Eventhouse/Kusto table, a real-time Eventstream, or a
> vector tileset) and show it on a web map — safely — for a web app?**

It renders four Fabric data sources on the **Azure Maps** Web SDK, and for each
source it shows **two ways** to get the data out of Fabric so you can compare
them. It runs locally and is deployable to Azure App Service.

![Car parks rendered on Azure Maps](images/carpark.png)

---

## What it demonstrates

- Pulling data from **four kinds of Fabric sources** and drawing them on one map:
  - a **Lakehouse file** (GeoJSON polygons),
  - a **Lakehouse table** (points, via the SQL analytics endpoint),
  - an **Eventhouse / Eventstream** table (real-time points),
  - a **PMTiles vector tileset** (a Lakehouse file rendered as vector tiles).
- **Two retrieval methods per source**, switchable live in the UI:
  - **Function** — a published **Fabric User Data Function (UDF)** reads the data
    *inside* Fabric and returns it (an API-wrapper / controlled exposure point).
  - **Direct** — the app's backend reads the source directly (OneLake file, SQL
    endpoint, or Kusto REST).
- A **real-time** mode for the Eventstream source (toggle + refresh interval).
- Standard Azure Maps controls (zoom, compass, pitch, **style picker**, scale).
- **Entra-based Azure Maps auth** so no Maps subscription key is exposed.
- A single **`config/constants.js`** file to point everything at a new
  tenant/workspace, and **no secrets** in the code.

---

## How it works (architecture)

The app is a **Backend-for-Frontend (BFF)**: a small Node server that serves the
browser app *and* brokers every call to Fabric. The browser never receives a
Fabric/OneLake/SQL/Kusto/UDF token.

```
 Browser (Azure Maps Web SDK)
   │  GET /api/config           → sources + Maps auth mode
   │  GET /api/data?source=&method=   → GeoJSON (or PMTiles metadata)
   │  GET /api/maps-token       → short-lived Azure Maps token
   │  GET /api/pmtiles-archive  → the .pmtiles bytes (HTTP Range)
   ▼
 Node BFF  ──(Microsoft Entra tokens, acquired as the server's identity)──►
   ├─ OneLake (files)        aud https://storage.azure.com
   ├─ SQL analytics endpoint aud https://database.windows.net
   ├─ Eventhouse / Kusto     aud https://api.kusto.windows.net
   ├─ Published UDFs         aud https://analysis.windows.net/powerbi/api
   └─ Azure Maps             aud https://atlas.microsoft.com
```

**Why a backend at all?** Fabric UDFs, OneLake, and Kusto are **never anonymous**
— every call needs a Microsoft Entra token. A public browser can't safely hold a
credential, so the BFF holds the identity, enforces a **fixed set of operations**,
and lets end users stay anonymous. "Function" vs "Direct" is just *how the BFF
fetches the data*; both need the BFF.

### Identity
The BFF authenticates with **`@azure/identity` `DefaultAzureCredential`**, which
works everywhere with the same code:
- **Locally** — the developer's `az login` (or a service principal via env vars).
- **In Azure** — the App Service's **managed identity**.

That identity is granted **least-privilege** access to exactly the sources it
needs, so it can only reach the intended data.

---

## The four sources × two methods

| Source | Function (UDF) | Direct | Rendered as |
|---|---|---|---|
| **Car parks** (`Car_Parks.geojson`) | UDF reads the Lakehouse file | OneLake file read | polygons |
| **GPS trace** (`GpsTrace.pmtiles`) | UDF returns the archive (base64) | OneLake file read | vector tiles (`pmtiles://`) |
| **Airports** (`dbo.airports`) | UDF queries the Lakehouse SQL connection | SQL analytics endpoint | points |
| **Bicycles** (Eventstream → Kusto) | UDF queries Kusto (its own identity) | Kusto REST | points (real-time) |

---

## Key concepts worth knowing

- **UDF = "API wrapper."** A published User Data Function is a single, controlled
  HTTP entry point: the web app calls it, and it reads the data server-side inside
  Fabric. You control exactly what it returns.
- **Managed vs manual UDF connections.** Lakehouse/SQL/Warehouse are *managed
  connections* — Fabric brokers auth, no credentials in code (car parks, PMTiles,
  airports). **Kusto/Eventhouse is not** a managed connection, so that UDF
  authenticates with its **own managed identity** and you grant that identity
  Database Viewer (bicycles). See [common UDF guide](common-udf-guide.md).
- **Nothing is anonymous.** UDF public endpoints are internet-reachable but always
  require an Entra token. To serve data to truly anonymous public users you must
  either copy it to a public store (e.g., a public blob) or front it with a
  service that holds the credential — which is exactly what this BFF is. See
  [hosting & public access](hosting-and-public-access.md).
- **Azure Maps auth.** The browser uses `authType: "anonymous"` + a `getToken`
  callback that fetches a **short-lived token** minted by the BFF's identity
  (which has *Azure Maps Data Reader*). No subscription key is exposed. See
  [managed-identity setup](managed-identity-setup.md).
- **PMTiles.** The browser uses the native Azure Maps `pmtiles://` protocol; the
  BFF just relays the archive bytes over an HTTP **Range** endpoint (or you can
  point it at a public blob and skip the backend for tiles).

---

## Running and hosting

- **Local:** `az login`, set an Azure Maps key (or Entra auth), `npm start`,
  open `http://localhost:3000`.
- **Azure App Service:** deploy the Node app, enable a **system-assigned managed
  identity**, and grant it the least-privilege roles. The app is public/anonymous
  to end users; the identity does all the data auth.
- **Cross-tenant:** if the app and the Fabric workspace live in different tenants,
  the managed identity won't work across tenants — use a **service principal in
  the Fabric tenant** instead (same code, via env vars).

Full, portal-based, copy-pasteable steps — including porting everything to a new
tenant — are in the [port & setup runbook](port-and-setup-runbook.md).

---

## Repository layout

```
config/constants.js        # one place to configure a tenant/workspace (no secrets)
fabric-udf/                # the 4 UDF Python files (paste into the Fabric portal)
server/                    # the Node BFF
  server.js                #   routes: /api/config, /api/data, /api/maps-token, /api/pmtiles-archive
  lib/                     #   token acquisition + OneLake/SQL/Kusto/UDF/PMTiles helpers
  sources/                 #   one module per source (drop-in registry)
public/                    # the browser app (Azure Maps Web SDK)
docs/                      # this overview + guides + per-source docs + images
```

---

## Where to go next

- [README](../README.md) — quick start and the source/method table.
- [Common UDF guide](common-udf-guide.md) — how UDFs are written, connected, published, and invoked.
- [Managed-identity setup](managed-identity-setup.md) — identity concepts and the required grants.
- [Hosting & public access](hosting-and-public-access.md) — hosting options and how to expose data anonymously.
- [Port & setup runbook](port-and-setup-runbook.md) — end-to-end, portal-based setup for a new tenant.
- Per-source details: [car parks](sources/carpark.md) · [PMTiles](sources/pmtiles.md) · [airports](sources/airports.md) · [bicycles/eventstream](sources/eventstream.md).
