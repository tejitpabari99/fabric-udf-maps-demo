# Common guide: Fabric User Data Functions (UDF)

Every "Function" method in this demo works the same way: a **published Fabric User
Data Function** reads the data *inside Fabric* and returns it, and the local proxy
invokes that function. This guide is the shared reference; each source doc only
notes what is specific to it.

## Why a UDF (the "API wrapper")

The UDF is a single, controlled exposure point. Instead of handing callers direct
Lakehouse / SQL / Kusto access, they call one function that returns exactly what you
choose to return. Auth is enforced by Fabric (Entra) and the data access happens
server-side with the function's managed connections.

## Programming model

```python
import fabric.functions as fn
udf = fn.UserDataFunctions()

@udf.function()
def my_func() -> dict:            # return dict/list/str/... -> JSON in the "output" envelope
    return {"hello": "world"}
```

Rules that bit us (all enforced at publish time):
- Function **parameters cannot have default values**.
- Connection **alias must be alphanumeric only** (no `_` or `-`).
- Every parameter and the return value need type annotations.
- Return a parsed object (`dict`/`list`), not a JSON string, so callers don't double-parse.

Connections are injected with `@udf.connection`:

```python
@udf.connection(argName="lakehouse", alias="carparkslh")   # alias: alphanumeric only
@udf.function()
def get_car_parks(lakehouse: fn.FabricLakehouseClient) -> dict:
    files = lakehouse.connectToFiles()                     # Lakehouse Files (OneLake)
    fc = files.get_file_client("GeoJson/Car_Parks.geojson")
    return json.loads(fc.download_file().readall().decode("utf-8"))
```

Connection client types:
- `fn.FabricLakehouseClient` → `.connectToFiles()` (OneLake files) / `.connectToSql()` (SQL endpoint)
- `fn.FabricSqlConnection` → `.connect()` for a Warehouse / SQL DB / Lakehouse SQL endpoint

Service limits: 30 MB return, 100 s public-endpoint timeout, 4 MB request. Take a
`TOP`/`take` subset for large tables.

## Deploy (mostly automated)

Item **create + code + connection binding** is done headlessly via the Fabric REST
API — no portal needed for these:

```powershell
# from fabric-udf/
python deploy_udf.py --spec <source>/spec.json --script <source>/function_app.py
# prints UDF_ID=<guid>
```

`deploy_udf.py` builds the three definition parts (`function_app.py`,
`definition.json`, `resources/functions.json`) and calls
`POST /v1/workspaces/{ws}/userDataFunctions` + `.../updateDefinition`. The
`connectedDataSources` in the spec **wires the managed connection automatically** —
you do not need the portal "Manage connections" step (verified for Lakehouse Files).

`spec.json` shape is documented at the top of `deploy_udf.py`.

## Publish + get the URL (portal — the only manual step)

REST has no publish operation. In the Fabric portal:
1. Open the UDF item → it opens in **Develop** mode.
2. Click **Publish** (wait ~1–2 min; provisions the Python runtime).
3. Switch the mode dropdown to **Run only**.
4. Select the function → **⋯** → **Properties** → confirm **Public access = On** →
   copy the **Public URL**.

The URL looks like:
```
https://<workspaceIdNoDashes>.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/{ws}/userDataFunctions/{id}/functions/{funcName}/invoke
```

Put it in `.env` as `UDF_<SOURCE>_ENDPOINT`.

## Invoke (what the proxy does)

- **Method:** POST, body `{}` (or `{ "param": value }`).
- **Auth:** `Authorization: Bearer <token>` where the token audience is
  **`https://analysis.windows.net/powerbi/api`** (the Power BI / Fabric data plane —
  NOT `api.fabric.microsoft.com`). UDF endpoints are internet-reachable but **never
  anonymous**.
- **Response envelope:** `{ "status": "Succeeded", "output": <your return value>, "errors": [] }`.
  The proxy unwraps `output`.

```powershell
$tok = az account get-access-token --resource "https://analysis.windows.net/powerbi/api" --query accessToken -o tsv
Invoke-WebRequest -Method Post -Uri $env:UDF_URL -Headers @{Authorization="Bearer $tok"} -Body "{}" -ContentType application/json
```

In the demo, [`server/lib/fabric.js`](../server/lib/fabric.js) `invokeUdf()` acquires
the token via the Azure CLI and unwraps the envelope.
