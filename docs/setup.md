# Set up the Fabric User Data Functions

> **Journey:** [README](../README.md) → prerequisites: [Data setup](data_setup.md) + [UDF guide](udf-guide.md) → **UDF setup** → [App deployment](app-guide.md) → [Authorization](auth.md)

## 1. Prerequisites

Complete [Data setup](data_setup.md) and review the [UDF guide](udf-guide.md).

## 2. Architecture

The browser loads the web page and requests map data from the Node app. The Node app uses its identity to call the published UDFs and returns only the map data. The browser never receives Fabric tokens.

| Route | Purpose |
| --- | --- |
| `/api/config` | Returns the map configuration. |
| `/api/data?source=` | Returns data for car parks, airports, or Eventstream. |
| `/api/maps-token` | Returns a short-lived Azure Maps token. |
| `/api/pmtiles-archive` | Serves the PMTiles archive with HTTP Range support. |

The PMTiles UDF returns the archive as base64. The Node app decodes and caches it, then serves it to the browser through the HTTP Range endpoint.

For reference, see [Fabric user data functions overview](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-overview).

## 3. Set up the Lakehouse UDFs

Use these steps for the car parks, PMTiles, and airports UDFs:

1. In the Fabric workspace, create a **User Data Functions** item.
2. Open **Develop** and replace the sample code with the matching Python file from the table below.
3. Select **Manage connections**, add the Lakehouse created during [Data setup](data_setup.md), and set the exact alias shown below.
4. Select **Publish**.
5. Switch to **Run only**, open the function **Properties**, and set **Public access = On**.
6. Copy the **Public URL** into the matching `udf.<source>` value in the repository file `config/constants.js`.

| Source | Python file | Function | Alias | Connect | `config/constants.js` key |
| --- | --- | --- | --- | --- | --- |
| Car parks | `fabric-udf/carpark_function_app.py` | `get_car_parks` | `carparkslh` | `connectToFiles` | `udf.carpark` |
| PMTiles | `fabric-udf/pmtiles_function_app.py` | `get_gpstrace_pmtiles` | `gpstracelh` | `connectToFiles` | `udf.pmtiles` |
| Airports | `fabric-udf/airports_function_app.py` | `get_airports` | `airportslh` | `connectToSql` | `udf.airports` |

The car parks and PMTiles UDFs read `Car_Parks.geojson` and `GpsTrace.pmtiles` from the Lakehouse `Files/` root. The airports UDF runs `SELECT TOP 100 * FROM dbo.airports`; latitude is `_c6` and longitude is `_c7`.

For reference, see [Create a UDF item in the portal](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/create-user-data-functions-portal) and [Connect Fabric UDFs to data sources](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/connect-to-data-sources).

## 4. Set up the Eventstream UDF

1. Create a **User Data Functions** item and paste `fabric-udf/eventstream_function_app.py` into **Develop**.
2. Open **Library management** and add the latest compatible `azure-kusto-data` library.
3. In the Fabric editor, set `CLUSTER_URI`, `DATABASE`, and `TABLE` from the values recorded during [Data setup](data_setup.md). Set `TABLE` to `BicycleES`.
4. Select **Publish**.
5. Switch to **Run only**, open the function **Properties**, and set **Public access = On**.
6. Copy the **Public URL** into `udf.eventstream` in the repository file `config/constants.js`.

Do not add a managed connection. For the runtime Kusto grant, follow [Grant the Eventstream UDF Kusto access](auth.md#grant-the-eventstream-udf-kusto-access).

## 5. Update `config/constants.js`

Edit the repository file `config/constants.js` locally and commit it with the app. It holds `mapsClientId`, `udf.resource`, and the four non-secret UDF Public URLs: `udf.carpark`, `udf.pmtiles`, `udf.airports`, and `udf.eventstream`. Do not paste these values into a portal during this step.

Hosting environment variables are covered in [Deploy and configure the application](app-guide.md).

## 6. Results

| Car parks | PMTiles |
| --- | --- |
| ![Car parks rendered in the app](images/carpark.png) | ![PMTiles rendered in the app](images/pmtiles.png) |

| Airports | Eventstream |
| --- | --- |
| ![Airports rendered in the app](images/airports.png) | ![Eventstream data rendered in the app](images/eventstream.png) |

## 7. Verify the data sources

After you deploy the app, open it and load car parks, PMTiles, airports, and Eventstream. Confirm that each source renders on the map.

## 8. Next step

Continue to [Deploy and configure the application](app-guide.md).
