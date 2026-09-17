# Car parks: Lakehouse GeoJSON file

This source renders `Files/GeoJson/Car_Parks.geojson` from Lakehouse `TejitLH`.
The file contains 13 car-park features represented as GeoJSON
`MultiPolygon` geometries.

![Car parks rendered through the Fabric UDF](../screenshot-udf.png)

## Function

`CarParksApi.get_car_parks` receives an injected `FabricLakehouseClient` named
`lakehouse`. Its connection alias is `carparkslh`. The function calls
`lakehouse.connectToFiles()`, downloads
`GeoJson/Car_Parks.geojson`, parses it, and returns the GeoJSON object.

The proxy invokes the published function with a Microsoft Entra token for
`https://analysis.windows.net/powerbi/api` and returns the FeatureCollection to
the browser.

## Direct

The proxy reads the same file from OneLake through:

```text
https://onelake.dfs.fabric.microsoft.com/{workspaceId}/{lakehouseId}/Files/GeoJson/Car_Parks.geojson
```

For the shared deployment:

- Workspace: `61077f32-d21a-4791-b383-cacbddf222f5`
- Lakehouse `TejitLH`: `b97fcfa2-6e58-4898-ab81-00ed5d1396cb`

The proxy parses the response as GeoJSON and sends it to the Azure Maps data
source.

## Setup & permissions

1. In workspace `61077f32-d21a-4791-b383-cacbddf222f5`, create or open
   Lakehouse `TejitLH`.
2. Upload `Car_Parks.geojson` to
   `Files/GeoJson/Car_Parks.geojson`.
3. From `fabric-udf`, create and upload the UDF definition:

   ```powershell
   python deploy.py --create CarParksApi
   ```

   `deploy.py` is the Car Parks source-specific equivalent of
   `deploy_udf.py`. It writes a `connectedDataSources` binding for Lakehouse
   `b97fcfa2-6e58-4898-ab81-00ed5d1396cb`, using the alphanumeric alias
   `carparkslh`. The binding is automatic; do not add a separate portal
   **Manage connections** connection.

   To update an existing item, use:

   ```powershell
   python deploy.py --udf <udf-id>
   ```

   Alternatively, create `CarParksApi` in the portal, paste
   `fabric-udf/function_app.py`, and ensure the same Lakehouse binding and
   alias are present.
4. The deployer needs permission to create/update the UDF item and bind the
   Lakehouse. The `connectedDataSources` binding grants the UDF connection
   access to the Lakehouse file.
5. In the Fabric portal, open `CarParksApi`, select **Develop > Publish**, wait
   for publishing, switch to **Run only**, then open
   `get_car_parks > ... > Properties`, confirm **Public access = On**, and copy
   the Public URL.
6. Put the URL in the gitignored `.env` file:

   ```text
   UDF_CARPARK_ENDPOINT=<published get_car_parks URL>
   ```

Allow about two minutes between publishes. The public endpoint is
internet-reachable but never anonymous; invocation always requires a Microsoft
Entra token.

See the [common UDF guide](../common-udf-guide.md) for the full deployment,
publishing, and authentication flow.

## What the Direct method needs

The identity running the proxy must:

- run `az login`;
- have OneLake read access on the workspace/Lakehouse; and
- be able to obtain a token for `https://storage.azure.com`.

No Fabric UDF endpoint is used by Direct mode.
