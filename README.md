# Fabric data sources on Azure Maps

This local demo renders four Microsoft Fabric data sources on Azure Maps. Each
source can be loaded through either a published Fabric User Data Function
(`Function`) or a source-specific proxy integration (`Direct`).

The Node server is a Backend-for-Frontend (BFF): it serves the browser app,
acquires Microsoft Entra tokens, calls Fabric data sources, and returns only the
data the map needs. The browser never receives Fabric, OneLake, SQL, Kusto, or
UDF access tokens.

> **New here? Start with the [Overview](docs/overview.md)** — a single read that
> explains what this is, how it works, and everything it does.

![Car parks rendered on Azure Maps](docs/images/carpark.png)

## Sources and methods

| Source | Function method | Direct method | Guide |
|---|---|---|---|
| `Car_Parks.geojson` | `CarParksApi.get_car_parks` reads a Lakehouse file | OneLake DFS file read | [Car parks](docs/sources/carpark.md) |
| `GpsTrace.pmtiles` | `GpsTracePmtilesApi.get_gpstrace_pmtiles` returns the archive as base64 | OneLake DFS file read | [PMTiles](docs/sources/pmtiles.md) |
| `dbo.airports` | `AirportsApi.get_airports` queries the Lakehouse SQL connection | Lakehouse SQL analytics endpoint through `mssql` | [Airports](docs/sources/airports.md) |
| `BicycleES` | `EventstreamApi.get_bikes` queries the Eventstream landing table (Kusto) with the UDF managed identity | Kusto REST, with optional timed refresh | [Eventstream bikes](docs/sources/eventstream.md) |

All UDFs share the creation, publishing, invocation, and permission model in
the [common UDF guide](docs/common-udf-guide.md).

- [Port to another tenant / deploy from scratch](docs/port-and-setup-runbook.md)

## Run locally

Prerequisites:

- Node.js 18 or later
- Azure CLI
- An Azure Maps subscription key
- A Microsoft Entra identity with access to the Fabric sources you plan to use

```powershell
az login
Copy-Item .env.example .env
# Edit .env and set AZURE_MAPS_KEY.
npm install
npm start
```

Open <http://localhost:3000>, select a source and method, and load the data.

The shared defaults point to:

- Workspace: `61077f32-d21a-4791-b383-cacbddf222f5`
- Lakehouse: `TejitLH`
- Lakehouse ID: `b97fcfa2-6e58-4898-ab81-00ed5d1396cb`

## Authentication, keys, and permissions

The proxy obtains tokens from the active Azure CLI account with:

```text
az account get-access-token --resource <audience>
```

Whoever runs `npm start` must first run `az login` and must have permission on
each Direct source and each UDF they invoke.

| Operation | Token audience | Required access |
|---|---|---|
| OneLake / ADLS file read | `https://storage.azure.com` | Proxy runner needs OneLake read access on the workspace/Lakehouse |
| Fabric SQL endpoint (TDS) | `https://database.windows.net` | Proxy runner needs read access on the Lakehouse SQL analytics endpoint |
| Kusto / Eventhouse | `https://api.kusto.windows.net` | Proxy runner needs Viewer on the target Eventhouse database |
| Published UDF invocation | `https://analysis.windows.net/powerbi/api` | Proxy runner needs permission to invoke the UDF |

`AZURE_MAPS_KEY` is the only browser-facing credential in this local demo. It is
stored only in `.env`, which is gitignored, and the proxy serves it through
`/api/config`. Do not commit the key. For production, use Microsoft Entra
authentication or SAS authentication for Azure Maps instead of a subscription
key.

UDF invocation URLs live in `config/constants.js` under `udf.<source>`. They
are not anonymous URLs: published UDF endpoints are internet-reachable but
always require a Microsoft Entra token for the UDF audience above.

## Creating and publishing a UDF

Create a **User Data Functions** item in the Fabric portal, open it in
**Develop** mode, and paste the matching
`fabric-udf/<scenario>_function_app.py` file. For Car parks, PMTiles, and
Airports, use **Manage connections** to add the Lakehouse and set the alias to
the alphanumeric value used in the code: `carparkslh`, `gpstracelh`, or
`airportslh`. Car parks and PMTiles use `connectToFiles()`; Airports uses
`connectToSql()`.

For Eventstream, edit `CLUSTER_URI`, `DATABASE`, and `TABLE` at the top of
`fabric-udf/eventstream_function_app.py` before pasting it. This function has
no managed connection; after publishing, grant its runtime managed identity
Kusto **Database Viewer** as described in the source guide.

Choose **Publish**, wait for publishing to complete, switch to **Run only**,
open the function's **... > Properties**, set **Public access = On**, and copy
its Public URL into the matching `config/constants.js` `udf.<source>` value.
Allow about two minutes between publishes.

See the [common UDF guide](docs/common-udf-guide.md) and the relevant source
guide for exact portal steps and permissions.
