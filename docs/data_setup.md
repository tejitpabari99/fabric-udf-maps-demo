**Journey:** [README](../README.md) → **Data setup** → [UDF guide](udf-guide.md) → [Solution setup](setup.md)

# Fabric data setup

## 1. Purpose and expected result

Use the Fabric portal to prepare every data source required by the sample. The entire solution uses one Fabric workspace, one Lakehouse containing two files and one table, and one Eventstream feeding an Eventhouse/KQL database table.

| Source | Expected Fabric location |
| --- | --- |
| Car-park GeoJSON | `Files/GeoJson/Car_Parks.geojson` |
| PMTiles archive | `Files/GeoJson/GpsTrace.pmtiles` |
| Airports CSV data | `dbo.airports` |
| Bicycles sample events | Eventhouse/KQL table `BicycleES` |

All customer-uploaded files come only from the repository folder `docs/data`. In this guide, `<car-park GeoJSON filename>`, `<PMTiles filename>`, and `<airports CSV filename>` each mean the matching owner-provided file committed in `docs/data`; these placeholders are not the final Fabric names.

## 2. Before you begin

- Confirm that you have access to a Fabric capacity-backed or trial-backed workspace and can create a workspace, Lakehouse, Eventstream, Eventhouse/KQL database, and tables.
- If you need a new workspace, follow [Create a workspace](https://learn.microsoft.com/en-us/fabric/fundamentals/create-workspaces).
- For role and ownership questions, see [Who performs each step](auth.md#who-performs-each-step).
- Choose names that meet your organization's naming standards, and keep every Fabric item described in this guide in the same workspace.

## 3. Create or choose the Fabric workspace

1. In the Fabric portal left navigation, select **Workspaces**.
2. Select an existing target workspace or create a workspace using the linked Microsoft Learn guidance.
3. Record the workspace name for later configuration.
4. Create the Lakehouse, Eventstream, Eventhouse, and KQL database in this same workspace.

## 4. Create the Lakehouse

1. Open the target workspace.
2. Select **+ New item**.
3. Search for and select **Lakehouse**.
4. Enter a customer-chosen Lakehouse name and select **Create**.
5. Record the Lakehouse name for later configuration.

## 5. Upload the car-park GeoJSON file

1. Open the Lakehouse explorer and expand **Files**.
2. Create the `GeoJson` folder if it is absent.
3. Select the ellipsis for the `GeoJson` folder, then select **Upload** > **Upload files**.
4. Select `<car-park GeoJSON filename>` from the repository folder `docs/data`.
5. Ensure the uploaded file is renamed or otherwise saved at the canonical destination `Files/GeoJson/Car_Parks.geojson`; the placeholder identifies the owner-provided source file, not the destination name.
6. Verify that `Car_Parks.geojson` appears in the `GeoJson` folder.

## 6. Upload the PMTiles archive

1. In the Lakehouse explorer, select the ellipsis for the same `Files/GeoJson` folder, then select **Upload** > **Upload files**.
2. Select `<PMTiles filename>` from the repository folder `docs/data`.
3. Ensure the uploaded file is renamed or otherwise saved at the canonical destination `Files/GeoJson/GpsTrace.pmtiles`; the placeholder identifies the owner-provided source file, not the destination name.
4. Verify that `GpsTrace.pmtiles` appears in the `GeoJson` folder.
5. Confirm with the file provider that the archive contains MVT vector tiles and a vector source layer compatible with the sample; the renderer discovers the source-layer metadata.

[Use PMTiles with Azure Maps](https://learn.microsoft.com/en-us/azure/azure-maps/add-custom-protocol-pmtiles) provides background information only and is not an alternative setup path for this sample.

The later UDF file paths are relative to the Lakehouse `Files` root, so the sample code uses `GeoJson/Car_Parks.geojson` and `GeoJson/GpsTrace.pmtiles`.

## 7. Create `dbo.airports` from CSV

1. In the Lakehouse explorer under **Files**, create or open a clearly named source folder such as `Files/SourceCsv`.
2. Select the folder ellipsis, select **Upload** > **Upload files**, and choose `<airports CSV filename>` from the repository folder `docs/data`.
3. Select the uploaded CSV ellipsis, then select **Load to tables** > **New table**.
4. Set the schema to `dbo`, set the table name to `airports`, and review the preview before loading.
5. If the first CSV row contains header names, select **Column header**; if the first row contains data, clear **Column header**.
6. Complete the load and confirm that `dbo.airports` appears under **Tables**.

The portal flow does not support custom schema definition, so the supplied CSV must already be compatible with the expected ordinal positions. Do not proceed until portal verification confirms that physical `_c6` contains numeric latitude and physical `_c7` contains numeric longitude in data rows.

| Physical column | Required meaning | Required data |
| --- | --- | --- |
| `_c6` | Latitude | Numeric values in data rows |
| `_c7` | Longitude | Numeric values in data rows |

For portal background, see [Get started with CSV upload](https://learn.microsoft.com/en-us/fabric/data-engineering/get-started-csv-upload) and [Load data into Lakehouse tables](https://learn.microsoft.com/en-us/fabric/data-engineering/load-to-tables).

## 8. Verify the Lakehouse sources

- In the Lakehouse explorer, confirm that `Files/GeoJson/Car_Parks.geojson` exists.
- In the Lakehouse explorer, confirm that `Files/GeoJson/GpsTrace.pmtiles` exists.
- Under **Tables**, confirm that `dbo.airports` exists and contains rows.
- Open the SQL analytics endpoint from the Lakehouse portal experience, open `dbo.airports`, and use the portal preview or query experience to inspect representative rows.
- Confirm again that physical `_c6` contains numeric latitude and physical `_c7` contains numeric longitude in the data rows.

## 9. Create the Eventstream Bicycles sample source

1. In the target workspace, select **+ New item**.
2. Select **Eventstream**, enter a customer-chosen name, and create it.
3. In the Eventstream, select **Add source** > **Sample data** > **Bicycles**, then add the source.
4. Confirm that the Bicycles source begins producing events.

For the sample source background, see [Transform and route sample bike-sharing data](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/transform-sample-data-and-route-to-kql).

## 10. Add the Eventhouse destination

1. Select or create an Eventhouse and KQL database in the same workspace as the Lakehouse and Eventstream.
2. Open the Eventstream in **Edit** mode and select **Add destination** > **Eventhouse**.
3. Choose the option that sends events to Eventhouse without transformations.
4. Select the target workspace, Eventhouse, and KQL database, then select **Save**.
5. Connect the destination if the portal requests it, then select **Publish**.
6. Open **Live view**, select the destination, and select **Configure**.
7. Create or select the KQL table `BicycleES`, inspect and map the incoming columns, and select **Finish**.
8. Ensure `Latitude` and `Longitude` remain present and numeric. Useful sample fields to retain include `No_Bikes`, `No_Empty_Docks`, `Street`, `Neighbourhood`, and `BikepointID`.
9. Open the destination table and verify that events land and that the row count or displayed data refreshes as new events arrive.

For destination details, see [Add an Eventhouse destination to an eventstream](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/add-destination-kql-database).

## 11. Record the Eventhouse values

1. Open the Eventhouse or KQL database portal item details or connection information.
2. Record the **Query URI**.
3. Record the KQL database name.
4. Record the table name `BicycleES`.
5. Keep these values available for later configuration in `fabric-udf/eventstream_function_app.py` and `config/constants.js`.

Complete the separate access step at [Grant the Eventstream UDF Kusto access](auth.md#grant-the-eventstream-udf-kusto-access).

## 12. Completion checklist and next step

- [ ] One target Fabric workspace is selected, and its name is recorded.
- [ ] One Lakehouse is created in that workspace, and its name is recorded.
- [ ] The owner-provided car-park GeoJSON source from `docs/data` is available at `Files/GeoJson/Car_Parks.geojson`.
- [ ] The owner-provided PMTiles source from `docs/data` is available at `Files/GeoJson/GpsTrace.pmtiles`.
- [ ] The owner-provided airports CSV source from `docs/data` is loaded into `dbo.airports`, and the table contains rows.
- [ ] Physical `_c6` contains numeric latitude and physical `_c7` contains numeric longitude in airport data rows.
- [ ] The Eventstream Bicycles sample source is producing events.
- [ ] The Eventhouse/KQL destination table is named `BicycleES`, receives rows, and retains numeric `Latitude` and `Longitude`.
- [ ] The Eventhouse Query URI, KQL database name, and `BicycleES` table name are recorded.
- [ ] All Fabric items are in the same workspace.

Continue to the [UDF guide](udf-guide.md), then complete [solution setup](setup.md).
