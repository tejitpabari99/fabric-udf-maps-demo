# Common guide: Fabric User Data Functions

Every `Function` method in this demo invokes a published Microsoft Fabric User
Data Function (UDF). The UDF reads data inside Fabric and returns only the
shape required by the map. The local Node proxy invokes the UDF and unwraps the
Fabric response envelope.

## Authentication model

The Node proxy is a Backend-for-Frontend (BFF). The browser calls the proxy; it
never receives Microsoft Entra tokens.

The proxy gets tokens from the active Azure CLI account:

```text
az account get-access-token --resource <audience>
```

The identity running the proxy must run `az login` and have access to the UDFs
and Direct sources it uses.

| Operation | Audience |
|---|---|
| OneLake / ADLS | `https://storage.azure.com` |
| Fabric SQL endpoint | `https://database.windows.net` |
| Kusto / Eventhouse | `https://api.kusto.windows.net` |
| UDF invocation | `https://analysis.windows.net/powerbi/api` |
| Fabric REST deployment | `https://api.fabric.microsoft.com` |

Published UDF endpoints are internet-reachable, but they are never anonymous.
Every invocation requires a Microsoft Entra token for
`https://analysis.windows.net/powerbi/api`.

Azure Maps uses a separate subscription key. The key is stored only in the
gitignored `.env` file and is returned to the browser by `/api/config`. For a
production deployment, use Microsoft Entra or SAS authentication for Azure
Maps.

## Programming model

```python
import fabric.functions as fn

udf = fn.UserDataFunctions()

@udf.function()
def my_func() -> dict:
    return {"hello": "world"}
```

UDF publishing rules:

- Connection aliases must be alphanumeric only; do not use `_` or `-`.
- Function parameters cannot have default values.
- Parameters and return values require type annotations.
- Return structured JSON data as a `dict` or `list`, not a JSON-encoded string.
  The PMTiles function intentionally returns a base64 string because its result
  is a binary archive rather than JSON data.

Lakehouse connections are injected with `@udf.connection`:

```python
@udf.connection(argName="lakehouse", alias="carparkslh")
@udf.function()
def get_car_parks(lakehouse: fn.FabricLakehouseClient) -> dict:
    files = lakehouse.connectToFiles()
    file_client = files.get_file_client("GeoJson/Car_Parks.geojson")
    return json.loads(file_client.download_file().readall().decode("utf-8"))
```

`FabricLakehouseClient` supports both:

- `connectToFiles()` for Lakehouse Files in OneLake
- `connectToSql()` for the Lakehouse SQL analytics endpoint

Keep responses bounded. UDF service limits include a 30 MB response, a 100
second public-endpoint timeout, and a 4 MB request.

## Create and upload the UDF definition

The generic deployer creates the UDF item when needed and uploads
`function_app.py`, `definition.json`, and `resources/functions.json`:

```powershell
cd fabric-udf
python deploy_udf.py --spec <source>/spec.json --script <source>/function_app.py
```

To update an existing item:

```powershell
python deploy_udf.py --spec <source>/spec.json --script <source>/function_app.py --udf <udf-id>
```

The Car Parks source predates the generic spec format and uses the equivalent
source-specific command:

```powershell
cd fabric-udf
python deploy.py --create CarParksApi
```

Both deployers use the Fabric REST audience
`https://api.fabric.microsoft.com`, create or update the UDF item, and write the
definition headlessly. You can also create the UDF in the Fabric portal and
paste the matching `function_app.py`, but the checked-in deploy scripts are the
repeatable path.

## Permissions

There are three separate identities to consider:

1. **Deployer:** needs permission to create or update the UDF item. For
   Lakehouse-backed definitions, the deployer must also be allowed to bind the
   target Lakehouse.
2. **UDF runtime:** needs access to the underlying source.
3. **Proxy runner:** needs permission to invoke the published UDF. Direct mode
   separately requires source access for the runner's Azure CLI identity.

### Lakehouse Files and SQL

The Car Parks, PMTiles, and Airports definitions include a
`connectedDataSources` entry. The deploy scripts bind the
`FabricLakehouseClient` alias to Lakehouse `TejitLH`
(`b97fcfa2-6e58-4898-ab81-00ed5d1396cb`) in workspace
`61077f32-d21a-4791-b383-cacbddf222f5`.

That binding grants the UDF connection access to the Lakehouse. No manual
**Manage connections** step is required. Keep the alias in the spec/definition,
the `@udf.connection` decorator, and the function metadata identical.

### Kusto and Eventhouse

Kusto/Eventhouse is not a supported UDF managed connection. The Kusto and
Eventstream functions use `azure-kusto-data` with the UDF runtime's managed
identity through `DefaultAzureCredential` or the SDK managed-identity builder
fallback.

After the UDF is published:

1. Invoke it once.
2. The first call normally returns HTTP 403 with a principal such as
   `aadapp=<clientId>;<tenantId>`.
3. Copy that complete principal from the error.
4. As a database administrator, run this control command in the Eventhouse
   query editor or submit it to `<cluster>/v1/rest/mgmt`:

```kusto
.add database <database> viewers ('aadapp=<clientId>;<tenantId>') 'Allow the Fabric UDF to read this database'
```

5. Invoke the UDF again. It should now be able to query the database.

Grant the role on the database named in the function, not merely on another
database in the same Eventhouse.

## Publish and copy the invocation URL

Fabric REST creates the item and definition, but publishing remains a manual
portal step:

1. Open the UDF item in **Develop** mode.
2. Select **Publish**.
3. Wait for publishing to finish. Publishing has an approximately two-minute
   cooldown before another publish.
4. Switch to **Run only**.
5. Select the function, open **... > Properties**, confirm
   **Public access = On**, and copy the Public URL.

The URL follows this pattern:

```text
https://<workspaceIdNoDashes>.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/{workspaceId}/userDataFunctions/{udfId}/functions/{functionName}/invoke
```

Put the URL in `.env` as the source's `UDF_<SOURCE>_ENDPOINT` value.

## Invocation contract

- Method: `POST`
- Body: `{}` for these parameterless functions
- Authorization audience: `https://analysis.windows.net/powerbi/api`
- Response:
  `{ "status": "Succeeded", "output": <return-value>, "errors": [] }`

The proxy helper in [`server/lib/fabric.js`](../server/lib/fabric.js) obtains
the token, invokes the endpoint, checks the status, and unwraps `output`.
