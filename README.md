# Fabric sources on Azure Maps

## 1. Project summary

This application renders four Microsoft Fabric sources on Azure Maps through published Fabric User Data Functions (UDFs) and a Node app.

The sources are a Lakehouse GeoJSON file, a Lakehouse PMTiles archive, a Lakehouse SQL table, and an Eventstream that feeds an Eventhouse/KQL table.

## 2. What the solution demonstrates

- Published Fabric UDFs provide the controlled boundary between the application and Fabric data.
- The Node app uses its hosted identity to broker UDF invocation and short-lived Azure Maps tokens without exposing those credentials to the browser.
- Three Fabric-managed Lakehouse connections provide source access for the car parks, GPS trace, and airports UDFs.
- The Eventstream UDF uses its Fabric runtime identity to read the Eventhouse/KQL table.
- Azure Maps uses Microsoft Entra authentication.
- The Node app relays the PMTiles archive through HTTP Range responses, and the browser decodes its vector tiles.
- The rendered outcomes are car-park polygons, GPS trace vector tiles, airport points, and real-time bicycle points.

## 3. Documentation order

Follow this customer journey in order: prerequisites [Data setup](docs/data_setup.md) + [UDF guide](docs/udf-guide.md) → [UDF setup](docs/setup.md) → [App deployment](docs/app-guide.md) → [Authorization](docs/auth.md).

1. [Data setup](docs/data_setup.md) owns creation and verification of the four Fabric data inputs.
2. [UDF guide](docs/udf-guide.md) owns the reusable UDF concepts, connection models, lifecycle, contracts, and limits needed before setup.
3. [UDF setup](docs/setup.md) owns the architecture, four UDF creation flows, publication, and application configuration seam.
4. [App deployment](docs/app-guide.md) owns Azure Maps creation, App Service creation, portal deployment, application configuration, and hosted verification.
5. [Authorization](docs/auth.md) owns every identity, tenant setting, permission, role, scope, token audience, and authorization troubleshooting step.

## 4. Architecture at a glance

`Browser → fixed /api/* routes → Node app → published Fabric UDFs`

The browser uses `/api/config`, `/api/data?source=`, `/api/maps-token`, and `/api/pmtiles-archive`. It receives only map data and a short-lived Azure Maps token.

Source data access stays inside Fabric through three managed Lakehouse connections and the Eventstream UDF runtime identity. The App Service managed identity only invokes the published UDFs and requests Azure Maps tokens.

For PMTiles, the UDF returns the archive to the Node app, the Node app exposes archive bytes through an HTTP Range relay, and the browser performs vector-tile decoding.

See [the detailed architecture](docs/setup.md#2-architecture) for the end-to-end request flow.

## 5. UDF-only source table

| Source | Fabric location | UDF file / function | Rendered result |
| --- | --- | --- | --- |
| [Car parks](docs/setup.md#3-set-up-the-lakehouse-udfs) | Lakehouse file `Files/Car_Parks.geojson` | `carpark_function_app.py` / `get_car_parks` | polygons |
| [GPS trace](docs/setup.md#3-set-up-the-lakehouse-udfs) | Lakehouse file `Files/GpsTrace.pmtiles` | `pmtiles_function_app.py` / `get_gpstrace_pmtiles` | vector tiles (PMTiles) |
| [Airports](docs/setup.md#3-set-up-the-lakehouse-udfs) | Lakehouse SQL table `dbo.airports` | `airports_function_app.py` / `get_airports` | points |
| [Bicycles](docs/setup.md#4-set-up-the-eventstream-udf) | Eventstream → Eventhouse/KQL table `BicycleES` | `eventstream_function_app.py` / `get_bikes` | points (real-time) |

## 6. Expected result

The deployed application renders each Fabric source as an interactive Azure Maps layer. Car parks are the lead example:

![Car parks rendered on Azure Maps](docs/images/carpark.png)

See the matching setup steps for [GPS trace vector tiles](docs/setup.md#3-set-up-the-lakehouse-udfs), [airport points](docs/setup.md#3-set-up-the-lakehouse-udfs), and [real-time bicycle points](docs/setup.md#4-set-up-the-eventstream-udf).

## 7. Repository layout

```text
config/constants.js
fabric-udf/
  carpark_function_app.py
  pmtiles_function_app.py
  airports_function_app.py
  eventstream_function_app.py
server/
public/
docs/
  data/
  images/
  data_setup.md
  udf-guide.md
  setup.md
  app-guide.md
  auth.md
```

`config/constants.js` contains only `mapsClientId`, `udf.resource`, `udf.carpark`, `udf.pmtiles`, `udf.airports`, and `udf.eventstream`. `fabric-udf/` contains the four Python UDF implementations. `server/` contains the Node app and its fixed `/api/config`, `/api/data?source=`, `/api/maps-token`, and `/api/pmtiles-archive` routes. `public/` contains the browser application. `docs/data/` contains customer-uploaded source files, `docs/images/` contains rendered outcomes, and the five guides own the ordered customer journey.

## 8. Security summary

The browser receives neither Fabric credentials nor the local-development-only Azure Maps key fallback. The App Service identity only invokes UDFs and requests Maps tokens, while all source access stays inside Fabric through managed Lakehouse connections and the Eventstream UDF runtime identity.

See [Authorization](docs/auth.md) for the identity model, least-privilege grants, scopes, token audiences, and verification steps.
