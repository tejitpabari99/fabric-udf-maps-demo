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

## How UDFs connect to each source type

Fabric UDFs have two distinct connection models. Choose the model based on
whether the source type is supported by Fabric managed connections. See
[Connect to data sources from Fabric User Data Functions](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/connect-to-data-sources).

### Managed connections

For a supported source, declare the connection with `@udf.connection`, then
use **Manage connections** in the UDF item to add the source with the same
alias. Fabric brokers authentication and injects a typed client into the
function, so the Python code contains no credentials.

Supported managed source types include:

- Lakehouse through `FabricLakehouseClient`, using `connectToFiles()` or
  `connectToSql()`
- Fabric SQL Database and Warehouse through `FabricSqlConnection`
- Mirrored Database for read-only access
- Variable Library
- Cosmos DB and Key Vault through their supported connection types

This repository uses one managed Lakehouse connection in three ways:

| Source | Alias | Injected client and operation |
|---|---|---|
| Car parks | `carparkslh` | `FabricLakehouseClient.connectToFiles()` reads `GeoJson/Car_Parks.geojson` |
| PMTiles | `gpstracelh` | `FabricLakehouseClient.connectToFiles()` reads `GeoJson/GpsTrace.pmtiles` |
| Airports | `airportslh` | `FabricLakehouseClient.connectToSql()` queries `dbo.airports` |

The decorator alias and the connection alias configured in the portal must
match:

```python
@udf.connection(argName="lakehouse", alias="airportslh")
@udf.function()
def get_airports(lakehouse: fn.FabricLakehouseClient) -> list[dict]:
    connection = lakehouse.connectToSql()
    # Query through the Fabric-brokered connection.
```

### Non-managed sources

If a source is not in the supported managed-connection list, the UDF connects
to it manually in Python with the source's client library. Examples include
Kusto/Eventhouse, external APIs, and Azure Blob Storage.

Manual does not mean embedding a key or secret. The code authenticates as the
UDF runtime's **own managed identity**, and that identity must be granted access
on the target source. The Eventstream UDF in this repository uses
`azure-kusto-data` with `azure.identity.DefaultAzureCredential` and
`with_azure_token_credential`:

```python
from azure.identity import DefaultAzureCredential
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

credential = DefaultAzureCredential(
    exclude_interactive_browser_credential=True
)
builder = KustoConnectionStringBuilder.with_azure_token_credential(
    CLUSTER_URI,
    credential,
)
client = KustoClient(builder)
result = client.execute(DATABASE, QUERY)
```

There is no `@udf.connection` decorator or managed connection for this
Kusto-backed function. After publishing, invoke the UDF once and copy the
complete principal from the expected authorization error:

```text
Principal 'aadapp=<clientId>;<tenantId>' is not authorized to read database '<database>'
```

Then, as an Eventhouse database administrator, grant that UDF identity
**Database Viewer**:

```kusto
.add database <database> viewers ('aadapp=<clientId>;<tenantId>') 'Allow the Fabric UDF to read this database'
```

## Create the UDF in the portal (copy-paste)

Create each UDF manually:

1. In the Fabric portal, create a **User Data Functions** item from **New** or
   from the target workspace.
2. Open the item in **Develop** mode and paste the matching file:
   - `fabric-udf/carpark_function_app.py`
   - `fabric-udf/pmtiles_function_app.py`
   - `fabric-udf/airports_function_app.py`
   - `fabric-udf/eventstream_function_app.py`
3. For Car parks, PMTiles, and Airports, open **Manage connections**, add the
   Lakehouse, and set its alias to the alphanumeric value used in the code:
   `carparkslh`, `gpstracelh`, or `airportslh`. Car parks and PMTiles use
   `connectToFiles()`; Airports uses `connectToSql()`.
4. For Eventstream, edit `CLUSTER_URI`, `DATABASE`, and `TABLE` at the top of
   `eventstream_function_app.py` to match the Eventhouse destination. It does
   not use a managed connection.
5. Publish the item, switch to **Run only**, open the function's
   **... > Properties**, set **Public access = On**, and copy the Public URL
   into `config/constants.js` under the matching `udf.<source>` value.

Connection aliases must be alphanumeric, function parameters cannot have
default values, and another publish may require waiting approximately two
minutes. Public URLs still require a Microsoft Entra invocation token.

## Permissions

There are three separate identities to consider:

1. **UDF creator:** a signed-in user needs permission to create or update the
   UDF item and, for Lakehouse-backed functions, add the target Lakehouse
   connection.
2. **UDF runtime:** needs access to the underlying source.
3. **Proxy runner:** needs permission to invoke the published UDF. Direct mode
   separately requires source access for the runner's Azure CLI identity.

### Lakehouse Files and SQL

For Car parks, PMTiles, and Airports, use **Manage connections** to add
Lakehouse `TejitLH` (`b97fcfa2-6e58-4898-ab81-00ed5d1396cb`) in workspace
`61077f32-d21a-4791-b383-cacbddf222f5`. Set the connection alias to match the
`@udf.connection` decorator exactly.

### Kusto and Eventhouse

Kusto/Eventhouse is not a supported UDF managed connection. The Eventstream
function uses `azure-kusto-data` with the UDF runtime's managed identity
through `DefaultAzureCredential` or the SDK managed-identity builder fallback.

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

1. Open the UDF item in **Develop** mode.
2. Select **Publish**.
3. Wait for publishing to finish. Publishing has an approximately two-minute
   cooldown before another publish.
4. Switch to **Run only**.
5. Select the function, open **... > Properties**, set
   **Public access = On**, and copy the Public URL.

The URL follows this pattern:

```text
https://<workspaceIdNoDashes>.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/{workspaceId}/userDataFunctions/{udfId}/functions/{functionName}/invoke
```

Put the URL in `config/constants.js` as the source's `udf.<source>` value.

## Invocation contract

- Method: `POST`
- Body: `{}` for these parameterless functions
- Authorization audience: `https://analysis.windows.net/powerbi/api`
- Response:
  `{ "status": "Succeeded", "output": <return-value>, "errors": [] }`

The proxy helper in [`server/lib/fabric.js`](../server/lib/fabric.js) obtains
the token, invokes the endpoint, checks the status, and unwraps `output`.
