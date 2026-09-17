# GpsTrace PMTiles

The `GpsTrace.pmtiles` source renders the Lakehouse file
`Files/GeoJson/GpsTrace.pmtiles` as Mapbox Vector Tiles (MVT) in Azure Maps.
PMTiles stores a complete tile pyramid in one archive, so the browser requests
only the tiles needed for the current map view.

## Tile server

The data endpoint returns archive metadata rather than the complete file:
the vector source-layer name, zoom range, bounds, center, and a tile URL
template. The local proxy serves that template at:

```text
GET /api/pmtiles/{z}/{x}/{y}.mvt?method=function|direct
```

For each method, the proxy fetches the archive once and caches its bytes and
`PMTiles` reader in memory. Tile requests are extracted from that cached archive.
The archive uses gzip compression, so the proxy decompresses directories and
tile payloads before returning raw MVT bytes as `application/x-protobuf`.

## Azure Maps rendering

The browser creates an `atlas.source.VectorTileSource` whose `tiles` option
points at the proxy route. A `LineLayer`, `PolygonLayer`, and `SymbolLayer` all
reference the archive's `GpsTrace` source layer, allowing line, polygon, and
point features to render without converting the archive to GeoJSON. The camera
fits to the bounds stored in the PMTiles header.

## Function

The proxy invokes the published `get_gpstrace_pmtiles` Fabric User Data
Function. The UDF reads the archive through its managed
`FabricLakehouseClient` Files connection and returns the bytes as a base64
string. The proxy decodes that string once, caches the archive, and serves
individual MVT tiles from it.

See the [common UDF guide](../common-udf-guide.md) for deployment, publishing,
authentication, and `UDF_PMTILES_ENDPOINT` configuration.

## Direct

The proxy reads `Files/GeoJson/GpsTrace.pmtiles` directly from OneLake with an
Azure CLI Entra token for `https://storage.azure.com`. It caches the returned
archive bytes and uses the same tile extraction route and Azure Maps renderer as
the Function method.
