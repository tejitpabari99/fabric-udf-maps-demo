# Fabric data sources on Azure Maps

This local demo renders five Microsoft Fabric data sources on Azure Maps. Each
source can be loaded through either a published Fabric User Data Function
(`Function`) or a source-specific proxy integration (`Direct`).

The Node server is a Backend-for-Frontend (BFF): it serves the browser app,
acquires Microsoft Entra tokens, calls Fabric data sources, and returns only the
data the map needs. The browser never receives Fabric, OneLake, SQL, Kusto, or
UDF access tokens.

![Car parks rendered on Azure Maps](docs/screenshot-udf.png)

## Sources and methods

| Source | Function method | Direct method | Guide |
|---|---|---|---|
| `Car_Parks.geojson` | `CarParksApi.get_car_parks` reads a Lakehouse file | OneLake DFS file read | [Car parks](docs/sources/carpark.md) |
| `GpsTrace.pmtiles` | `GpsTracePmtilesApi.get_gpstrace_pmtiles` returns the archive as base64 | OneLake DFS file read | [PMTiles](docs/sources/pmtiles.md) |
| `dbo.airports` | `AirportsApi.get_airports` queries the Lakehouse SQL connection | Lakehouse SQL analytics endpoint through `mssql` | [Airports](docs/sources/airports.md) |
| `Weather` | `KustoApi.get_weather` queries Eventhouse with the UDF managed identity | Kusto REST | [Kusto weather](docs/sources/kusto.md) |
| `BicycleES` | `EventstreamApi.get_bikes` queries the Eventstream landing table with the UDF managed identity | Kusto REST, with optional timed refresh | [Eventstream bikes](docs/sources/eventstream.md) |

All UDFs share the deployment, publishing, invocation, and permission model in
the [common UDF guide](docs/common-udf-guide.md).

## Run locally

Prerequisites:

- Node.js 18 or later
- Azure CLI
- An Azure Maps subscription key
- A Microsoft Entra identity with access to the Fabric sources you plan to use

```powershell
az login
Copy-Item .env.example .env
# Edit .env and set AZURE_MAPS_KEY plus any source-specific endpoints.
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
| UDF deployment through Fabric REST | `https://api.fabric.microsoft.com` | Deployer needs permission to create/update UDF items and bind the configured data source |

`AZURE_MAPS_KEY` is the only browser-facing credential in this local demo. It is
stored only in `.env`, which is gitignored, and the proxy serves it through
`/api/config`. Do not commit the key. For production, use Microsoft Entra
authentication or SAS authentication for Azure Maps instead of a subscription
key.

UDF invocation URLs also live in `.env` as `UDF_<SOURCE>_ENDPOINT`. They are not
anonymous URLs: published UDF endpoints are internet-reachable but always
require a Microsoft Entra token for the UDF audience above.

## Deploying a UDF

The scripts under `fabric-udf/` create the UDF item and upload its definition
through Fabric REST. For Lakehouse-backed functions, the definition also wires
the Lakehouse connection through `connectedDataSources`; no manual **Manage
connections** step is required.

Publishing is still manual: open the item in the Fabric portal, choose
**Develop > Publish**, wait for publishing to complete, switch to **Run only**,
open the function's **... > Properties**, confirm **Public access = On**, and
copy its Public URL into the matching `.env` variable. Allow about two minutes
between publishes.

See the [common UDF guide](docs/common-udf-guide.md) and the relevant source
guide for exact commands and permissions.
