# Weather: Eventhouse table

This source renders up to 100 rows from the `Weather` table in Eventhouse
database `TejitEH`. Each valid `BeginLat`/`BeginLon` pair becomes a GeoJSON
point with coordinates `[longitude, latitude]`.

The Fabric Kusto cluster is:

```text
https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com
```

## Function

`KustoApi.get_weather` uses the `azure-kusto-data` package to query `TejitEH`:

```kusto
Weather
| where isnotnull(BeginLat) and BeginLat != 0
  and isnotnull(BeginLon) and BeginLon != 0
| take 100
| project BeginLat, BeginLon, State, EventType, StartTime
```

Kusto/Eventhouse is not a supported UDF managed connection. The function
therefore authenticates outbound with the UDF runtime's managed identity,
using `DefaultAzureCredential` and
`with_azure_token_credential` when available, with managed-identity builder
fallbacks for other SDK versions.

The proxy separately authenticates the UDF invocation with a token for
`https://analysis.windows.net/powerbi/api`.

## Direct

The proxy queries the cluster through Kusto REST with a token for
`https://api.kusto.windows.net`. Ordinary queries use `/v2/rest/query`;
control commands beginning with `.` use `/v1/rest/query`.

It converts rows with valid `BeginLat`/`BeginLon` values into a GeoJSON
FeatureCollection.

## Setup & permissions

1. In the Fabric Eventhouse, create/open KQL database `TejitEH` and create/load
   table `Weather` with `BeginLat` and `BeginLon` columns. The displayed
   properties also use `State`, `EventType`, and `StartTime`.
2. From `fabric-udf`, create the UDF item and upload its definition:

   ```powershell
   python deploy_udf.py --spec kusto/spec.json --script kusto/function_app.py
   ```

   `kusto/spec.json` creates `KustoApi` and includes
   `azure-kusto-data` as a PyPI library. To update an existing item, add
   `--udf <udf-id>`.
3. There is no `connectedDataSources` entry for Kusto. Do not try to create a
   UDF managed Kusto connection; the function uses its runtime managed
   identity.
4. In the portal, open `KustoApi`, select **Develop > Publish**, wait for
   publishing, switch to **Run only**, then open
   `get_weather > ... > Properties`, confirm **Public access = On**, and copy
   the Public URL.
5. Put the URL and Direct-mode settings in the gitignored `.env` file:

   ```text
   KUSTO_URI=https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com
   KUSTO_DB=TejitEH
   UDF_KUSTO_ENDPOINT=<published get_weather URL>
   ```

6. Invoke `get_weather` once. The first call should fail with HTTP 403 and a
   message like:

   ```text
   Principal 'aadapp=<clientId>;<tenantId>' is not authorized to read database 'TejitEH'
   ```

7. Copy the complete `aadapp=<clientId>;<tenantId>` principal. As a database
   administrator, run this in the Eventhouse query editor or through
   `<cluster>/v1/rest/mgmt`:

   ```kusto
   .add database TejitEH viewers ('aadapp=<clientId>;<tenantId>') 'Allow KustoApi UDF to read Weather'
   ```

8. Invoke the function again; it should now succeed.

In this deployment, the `KustoApi` managed identity has application ID
`ef595923-8b9c-4454-b8d4-59572992c2bb`. Still copy the complete principal from
the 403 because the tenant ID is also required.

The deployer needs write permission on the UDF item. A database administrator
must grant the UDF identity Database Viewer on `TejitEH`. The proxy runner
needs permission to invoke the published UDF.

Allow about two minutes between publishes. See the
[common UDF guide](../common-udf-guide.md) for the shared flow.

## What the Direct method needs

The identity running the proxy must:

- run `az login`;
- have Viewer permission on KQL database `TejitEH`; and
- be able to obtain a token for `https://api.kusto.windows.net`.

The Direct method uses the runner's identity, not the UDF managed identity.
