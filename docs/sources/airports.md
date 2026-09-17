# Airports

The `airports-lakehouse` source renders up to 100 rows from the Lakehouse table
`dbo.airports` as GeoJSON points.

The table's physical columns are `_c0` through `_c13`. Its first data row holds
the semantic headers; `_c6` is `latitude` and `_c7` is `longitude`. The point
conversion parses those two columns and skips the nonnumeric header row.

## Function

The proxy invokes the published `get_airports` Fabric User Data Function with
an empty body. The UDF uses its managed `FabricLakehouseClient` connection,
calls `connectToSql()`, and runs:

```sql
SELECT TOP 100 * FROM dbo.airports
```

It returns a JSON-serializable list of row objects. The proxy converts that list
to a GeoJSON `FeatureCollection` using `_c6`/`_c7`. Invocation authentication
uses an Azure CLI token for `https://analysis.windows.net/powerbi/api`.
See the [common UDF guide](../common-udf-guide.md) for deployment, publishing,
and endpoint configuration.

## Direct

The local proxy connects to the Lakehouse SQL analytics endpoint with `mssql`
and an Azure CLI Entra access token for `https://database.windows.net`. It runs
the same `SELECT TOP 100 * FROM dbo.airports` query and converts each numeric
`_c6`/`_c7` pair to a GeoJSON Point with coordinates `[longitude, latitude]`.
