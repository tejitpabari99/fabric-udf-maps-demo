# Eventstream

The `Bicycle-eventstream` source represents the Fabric Eventstream `SampleES`
(`sample-bicycles`). It is real-time data, so enabling the UI real-time toggle
re-runs the selected method at the chosen interval. Each fetch requests the
newest 100 rows and converts valid `Latitude` / `Longitude` pairs into GeoJSON
Points with coordinates `[longitude, latitude]`.

An Eventstream must write to a destination before its events can be queried.
The current `SampleES` definition has no destination, and neither known
Eventhouse contains a bicycle table:

- `TejitEH` contains `Weather` and `Tejit LH Data`.
- `TejitEV` contains `airports`.

Until a KQL database destination is added, Direct returns an empty
`FeatureCollection` with a server warning and the UDF returns an empty list.
After adding the destination, set `EVENTSTREAM_KUSTO_URI`,
`EVENTSTREAM_KUSTO_DB`, and `EVENTSTREAM_TABLE`; also update the matching
constants in `fabric-udf/eventstream/function_app.py` and redeploy it.

## Function

The proxy invokes the published `get_bikes` Fabric User Data Function with an
empty body. Once configured, the UDF uses `azure-kusto-data` and its runtime's
system managed identity to query the landing table:

```kusto
table("<destination table>")
| where isnotnull(Latitude) and isnotnull(Longitude)
| extend __ingestion_time = ingestion_time()
| order by __ingestion_time desc nulls last
| take 100
| project-away __ingestion_time
```

It returns a JSON-serializable list of row objects, converting datetime values
to ISO 8601 strings. The proxy converts the list to a GeoJSON
`FeatureCollection` using `Latitude` and `Longitude`.

Fabric UDFs cannot use a managed Kusto connection, so this function calls Kusto
through the SDK. The UDF runtime identity must be granted access to the
Eventhouse/database; deployment and publishing can succeed even if that
authorization is missing, but invocation will fail until access is granted.
See the [common UDF guide](../common-udf-guide.md) for deployment, publishing,
and endpoint configuration.

## Direct

The local proxy uses the same newest-first Kusto query against the configured
landing table. It acquires an Azure CLI token for
`https://api.kusto.windows.net`, posts the query to `/v2/rest/query`, and
converts rows to GeoJSON points using `Latitude` and `Longitude`.

If the landing table exists but has not received data yet, the result is an
empty `FeatureCollection`. If no destination is configured, the proxy does not
attempt a Kusto request and returns the same empty result with a helpful
warning.
