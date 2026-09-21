# Car parks: Lakehouse GeoJSON file

This source renders `Files/GeoJson/Car_Parks.geojson` from Lakehouse `TejitLH`.
The file contains 13 car-park features represented as GeoJSON
`MultiPolygon` geometries.

![Car parks rendered through the Fabric UDF](../images/carpark.png)

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
3. In the Fabric portal, create a **User Data Functions** item, open it in
   **Develop** mode, and paste
   `fabric-udf/carpark_function_app.py`.
4. Open **Manage connections**, add Lakehouse `TejitLH`, and set the
   connection alias to `carparkslh`. The alias is alphanumeric and must match
   the code. This function uses `connectToFiles()`.
5. Select **Publish**, wait
   for publishing, switch to **Run only**, then open
   `get_car_parks > ... > Properties`, set **Public access = On**, and copy
   the Public URL.
6. Put the URL in `config/constants.js`:

   ```javascript
   udf: {
     carpark: "<published get_car_parks URL>"
   }
   ```

Allow about two minutes between publishes. The public endpoint is
internet-reachable but never anonymous; invocation always requires a Microsoft
Entra token.

See the [common UDF guide](../common-udf-guide.md) for the full creation,
publishing, and authentication flow.

## What the Direct method needs

The identity running the proxy must:

- run `az login`;
- have OneLake read access on the workspace/Lakehouse; and
- be able to obtain a token for `https://storage.azure.com`.

No Fabric UDF endpoint is used by Direct mode.
