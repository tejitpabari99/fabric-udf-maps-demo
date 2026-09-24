# Fabric User Data Functions

> **Journey:** [README](../README.md) → [Data setup](data_setup.md) + **UDF guide** → [UDF setup](setup.md) → [App deployment](app-guide.md) → [Authorization](auth.md)

This guide explains the Fabric User Data Function concepts used by the solution before you create the UDF items. Source-specific creation and configuration steps belong in [Set up the UDFs](./setup.md), and permission-grant procedures belong in [Authorization and identity](./auth.md).

## 1. What a Fabric User Data Function is

A Fabric User Data Function (UDF) is serverless Python hosted in Microsoft Fabric and published as a Microsoft Entra-protected REST endpoint. A published endpoint is internet-reachable but never anonymous. In this solution, each UDF is a controlled data boundary that reads its source inside Fabric and returns only the payload required by the map.

For the broader programming model and supported scenarios, see [Fabric user data functions overview](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-overview).

## 2. How this solution uses UDFs

The Node Backend-for-Frontend (BFF) invokes four UDFs and prepares their results for rendering on Azure Maps. The browser calls the BFF rather than invoking the Fabric endpoints itself.

| Function | Return contract |
|---|---|
| `get_car_parks` | A GeoJSON dictionary. |
| `get_gpstrace_pmtiles` | The PMTiles archive as a base64 string. |
| `get_airports` | Up to 100 row dictionaries. |
| `get_bikes` | The newest approximately 100 coordinate-bearing row dictionaries. |

The BFF invokes every function with the empty JSON body `{}` and unwraps the Fabric response envelope before processing the returned value.

## 3. Fabric-managed Lakehouse connections

The car parks, PMTiles, and airports functions use Fabric-managed Lakehouse connections. The `@udf.connection` decorator declares a connection argument and an alphanumeric alias, while Fabric brokers authentication and injects a `FabricLakehouseClient` when the function runs. The alias configured in **Manage connections** must exactly match the alias in the decorator.

`FabricLakehouseClient.connectToFiles()` provides access to Lakehouse Files, while `FabricLakehouseClient.connectToSql()` provides access to the Lakehouse SQL analytics endpoint.

| Source | Connection alias | Client operation |
|---|---|---|
| Car parks | `carparkslh` | `FabricLakehouseClient.connectToFiles()` |
| PMTiles | `gpstracelh` | `FabricLakehouseClient.connectToFiles()` |
| Airports | `airportslh` | `FabricLakehouseClient.connectToSql()` |

For connection concepts and currently supported source types, see [Connect to data sources from Fabric User Data Functions](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/connect-to-data-sources).

## 4. Eventhouse/Kusto runtime-identity connection model

The `get_bikes` Eventstream UDF uses a different connection model: it has no Fabric-managed connection and no `@udf.connection` decorator. Its checked-in Python uses `azure-kusto-data` with `DefaultAzureCredential`, so the UDF runtime authenticates to Eventhouse/Kusto with its own managed identity.

This pattern describes the Eventstream function in this repository; it is not a rule that every service without a managed connection must always use the same libraries or identity flow, because Fabric connection capabilities can evolve. Granting the runtime identity Kusto Database Viewer is covered only in [Grant the Eventstream UDF Kusto access](./auth.md#grant-the-eventstream-udf-kusto-access).

## 5. Develop, test, publish, and invoke lifecycle

Create the UDF item in the Fabric portal, then use **Develop** mode and the portal editor to author and test its Python. **Library management** adds packages required by a function, such as `azure-kusto-data`, and **Manage connections** binds supported Fabric data sources to the aliases declared by `@udf.connection`.

After the function is ready, select **Publish**, switch to **Run only**, open the function's **Properties**, set **Public access = On**, and copy the **Public URL** for the application configuration. Public access makes the endpoint reachable from the internet, but every invocation still requires Microsoft Entra authentication.

See [Create a UDF item in the portal](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/create-user-data-functions-portal), [Using the portal editor](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-portal-editor), and [Invoke UDFs from an application](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/tutorial-invoke-from-python-app) for the portal and application invocation lifecycle.

## 6. Contracts and limits that matter to this demo

Each UDF is invoked with `POST` and the empty JSON body `{}`. The caller obtains a Microsoft Entra token for the audience `https://analysis.windows.net/powerbi/api` and sends it to the published endpoint. A successful Fabric response has the envelope fields `status`, `output`, and `errors`, represented as `{ "status": "Succeeded", "output": <return-value>, "errors": [] }`; the BFF validates the response and unwraps `output`.

Public endpoint execution has an approximately 100-second timeout, a response is limited to 30 MB, and publishing has an approximately two-minute cooldown before another publish. Keep function work and returned map payloads within those limits, and see [Service details and limitations](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-service-limits) for the current service limits.

## 7. Next step

Continue to [Set up the UDFs](./setup.md) to create the four UDF items, configure their source-specific connections or libraries, publish them, and record their Public URLs.
