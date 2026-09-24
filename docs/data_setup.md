# Fabric data setup

> **Journey:** **Data setup** → [UDF setup](udf-setup.md) → [App deployment](app-guide.md) → [Authorization](auth.md)

## Prerequisites

- A Fabric workspace where you can create items.
- A general understanding of Fabric workspaces and data sources such as Lakehouse and Eventhouse.

## Create the Lakehouse and upload data

Create all items for this sample in a single workspace.

1. In the workspace, select **+ New item**, select **Lakehouse**, enter a name, and select **Create**.
2. In the Lakehouse explorer, expand **Files**, select its ellipsis, and select **Upload** > **Upload files**.
3. Upload `docs/data/Car_Parks.geojson` and `docs/data/GpsTrace.pmtiles`.
4. Confirm both files appear under `Files/`.

`docs/data/airports.csv` is uploaded and loaded in the next section.

Note: The UDF assumes files are located at Files/. Change the location in the UDF if you store them elsewhere.

For reference, see [Create a workspace](https://learn.microsoft.com/en-us/fabric/fundamentals/create-workspaces).

## Create `dbo.airports` from CSV

1. In the Lakehouse explorer, select the ellipsis for **Files**, select **Upload** > **Upload files**, and upload `docs/data/airports.csv`.
2. Select the ellipsis for `airports.csv`, then select **Load to tables** > **New table**.
3. Set the schema to `dbo`, set the table name to `airports`, review the preview, and load the table.
4. Verify that `_c6` contains numeric latitude values and `_c7` contains numeric longitude values.

The portal flow does not support a custom schema, so `airports.csv` must be compatible with these column positions.

For reference, see [Get started with CSV upload](https://learn.microsoft.com/en-us/fabric/data-engineering/get-started-csv-upload) and [Load data into Lakehouse tables](https://learn.microsoft.com/en-us/fabric/data-engineering/load-to-tables).

## Create the Eventstream and Eventhouse table

1. In the workspace, select **+ New item**, select **Eventstream**, enter a name, and create it.
2. Select **Add source** > **Sample data** > **Bicycles**, then add the source.
3. Add an **Eventhouse** destination and create or select an Eventhouse and KQL database in the same workspace.
4. Configure the destination to ingest events without transformations, then create or select the table `BicycleES`.
5. Publish the Eventstream and verify that `BicycleES` receives rows with numeric `Latitude` and `Longitude` values.
6. Record the Eventhouse **Query URI**, database name, and table name for `CLUSTER_URI`, `DATABASE`, and `TABLE` in `fabric-udf/eventstream_function_app.py`.

Only the published UDF URL is later added to `config/constants.js`; do not add the Eventhouse values there.

Grant access as described in [Grant the Eventstream UDF Kusto access](auth.md#grant-the-eventstream-udf-kusto-access).

For reference, see [Transform and route sample bike-sharing data](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/transform-sample-data-and-route-to-kql) and [Add an Eventhouse destination to an eventstream](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-kql-database).

## Completion checklist

- [ ] `Car_Parks.geojson` and `GpsTrace.pmtiles` are under Lakehouse `Files/`.
- [ ] `dbo.airports` contains rows with numeric latitude in `_c6` and longitude in `_c7`.
- [ ] `BicycleES` receives Bicycles sample events with numeric `Latitude` and `Longitude`.
- [ ] The Eventhouse Query URI, database name, and table name are recorded.

Continue to [UDF setup](udf-setup.md).
