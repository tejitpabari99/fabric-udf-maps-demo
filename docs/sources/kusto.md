# Kusto

The `tejit-kusto` source renders up to 100 storm-event rows from the Fabric
Eventhouse table `Weather` as GeoJSON points. Each numeric `BeginLat` /
`BeginLon` pair becomes a Point with coordinates `[longitude, latitude]`;
rows without valid coordinates are skipped.

## Function

The proxy invokes the published `get_weather` Fabric User Data Function with an
empty body. The UDF uses the `azure-kusto-data` library and its runtime's system
managed identity to query the `TejitEH` Eventhouse:

```kusto
Weather
| take 100
| project BeginLat, BeginLon, State, EventType, StartTime
```

It returns a JSON-serializable list of row objects, converting datetime values
to ISO 8601 strings. The proxy converts the list to a GeoJSON
`FeatureCollection` using `BeginLat` and `BeginLon`. UDF invocation
authentication uses an Azure CLI token for
`https://analysis.windows.net/powerbi/api`.

Fabric UDFs cannot use a managed Kusto connection, so this function calls Kusto
over HTTP through the SDK. The UDF runtime identity must be granted access to
the Eventhouse/database; deployment and publishing can succeed even if that
authorization is missing, but invocation will fail until access is granted.
See the [common UDF guide](../common-udf-guide.md) for deployment, publishing,
and endpoint configuration.

## Direct

The local proxy queries the Eventhouse REST API with:

```kusto
Weather | take 100
```

It acquires an Azure CLI token for the Kusto audience
`https://api.kusto.windows.net`, posts ordinary queries to `/v2/rest/query`,
and converts the primary result rows to GeoJSON points using `BeginLat` and
`BeginLon`. Kusto control commands beginning with `.` use `/v1/rest/query`
instead; the shared `kustoQuery` helper selects the endpoint automatically.
