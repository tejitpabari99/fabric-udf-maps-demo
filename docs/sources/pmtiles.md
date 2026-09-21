# GPS trace: Lakehouse PMTiles file

This source renders the Lakehouse file
`Files/GeoJson/GpsTrace.pmtiles`, a roughly 360 KB PMTiles vector archive. Its
vector source layer is `GpsTrace` and its supported zoom range is 5 through 15.

![GPS trace PMTiles rendered on Azure Maps](pmtiles.png)

## Function

`GpsTracePmtilesApi.get_gpstrace_pmtiles` receives a
`FabricLakehouseClient` through alias `gpstracelh`. It calls
`connectToFiles()`, downloads `GeoJson/GpsTrace.pmtiles`, and returns the
archive as a base64 string.

The proxy invokes the function with a Microsoft Entra token for
`https://analysis.windows.net/powerbi/api`, decodes the archive, and caches it
in memory.

## Direct

The proxy reads the archive directly from OneLake with the storage audience
`https://storage.azure.com` and caches the same bytes in memory.

Both methods then expose the archive over an HTTP **Range**-capable endpoint:

```text
GET /api/pmtiles-archive?method=function|direct     (supports Range: bytes=…)
```

The browser uses the Azure Maps **native PMTiles protocol** — the `pmtiles.js`
library registers a `pmtiles://` handler (`atlas.addProtocol("pmtiles", …)`) and
a `VectorTileSource` with `url: "pmtiles://<archiveUrl>"`. The library issues
Range requests to the archive endpoint and decodes MVT tiles **in the browser**;
the server only relays byte ranges (no tile decode or gunzip). Line, polygon, and
symbol layers reference the `GpsTrace` source layer.

> Alternative (fully backend-free): if the `.pmtiles` file is copied to a public
> Azure Blob / static host, point the `pmtiles://` URL straight at that public URL
> and drop `/api/pmtiles-archive` entirely. This demo keeps the file in OneLake, so
> the Range proxy relays the (authenticated) bytes. See
> [add custom protocol PMTiles](https://learn.microsoft.com/en-us/azure/azure-maps/add-custom-protocol-pmtiles).

## Setup & permissions

1. In workspace `61077f32-d21a-4791-b383-cacbddf222f5`, create or open
   Lakehouse `TejitLH`
   (`b97fcfa2-6e58-4898-ab81-00ed5d1396cb`).
2. Upload `GpsTrace.pmtiles` to
   `Files/GeoJson/GpsTrace.pmtiles`. The archive must contain MVT vector tiles
   and declare the `GpsTrace` source layer.
3. From `fabric-udf`, create the UDF item and upload its definition:

   ```powershell
   python deploy_udf.py --spec pmtiles/spec.json --script pmtiles/function_app.py
   ```

   To update an existing item, add `--udf <udf-id>`.
4. The spec creates `GpsTracePmtilesApi` and binds alias `gpstracelh` to the
   Lakehouse through `connectedDataSources`. This automatically wires the
   `FabricLakehouseClient`; no manual **Manage connections** step is required.
5. The deployer needs permission to create/update the UDF item and bind the
   Lakehouse. The binding grants the UDF connection access to the Lakehouse
   file.
6. In the portal, open `GpsTracePmtilesApi`, select
   **Develop > Publish**, wait for publishing, switch to **Run only**, then
   open `get_gpstrace_pmtiles > ... > Properties`, confirm
   **Public access = On**, and copy the Public URL.
7. Put the URL in the gitignored `.env` file:

   ```text
   UDF_PMTILES_ENDPOINT=<published get_gpstrace_pmtiles URL>
   ```

Allow about two minutes between publishes. The UDF URL is not anonymous and
always requires a Microsoft Entra invocation token.

See the [common UDF guide](../common-udf-guide.md) for the shared UDF rules and
publishing flow.

## What the Direct method needs

The identity running the proxy must:

- run `az login`;
- have OneLake read access on the workspace/Lakehouse; and
- be able to obtain a token for `https://storage.azure.com`.

Direct mode reads:

```text
https://onelake.dfs.fabric.microsoft.com/{workspaceId}/{lakehouseId}/Files/GeoJson/GpsTrace.pmtiles
```
