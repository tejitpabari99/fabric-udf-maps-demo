# Port and setup runbook

## 1. Overview & architecture

This runbook recreates the complete demo in another Microsoft Fabric tenant or
workspace and deploys the web application to Azure App Service.

The application is a Node.js Backend-for-Frontend (BFF) plus a static browser
frontend:

```text
browser -> Azure App Service (static frontend + Node BFF)
        -> OneLake / Lakehouse SQL / Eventhouse / published Fabric UDFs
        -> Azure Maps
```

The browser calls fixed BFF routes and never receives Fabric, OneLake, SQL,
Kusto, or UDF credentials. The BFF uses
`@azure/identity` `DefaultAzureCredential`:

- In Azure, it authenticates as the App Service system-assigned managed
  identity.
- Locally, after `az login`, it authenticates as the signed-in developer.

The demo exposes five sources through two methods each:

| Source | Function method | Direct method |
|---|---|---|
| Car parks | UDF reads a Lakehouse GeoJSON file | BFF reads the file through OneLake DFS |
| PMTiles | UDF reads and returns a Lakehouse PMTiles archive | BFF reads the archive through OneLake DFS |
| Airports | UDF queries the Lakehouse SQL analytics endpoint | BFF connects to the SQL analytics endpoint |
| Weather | UDF queries a KQL database with the UDF identity | BFF queries Kusto REST with the app identity |
| Bicycles | UDF queries the Eventstream destination with the UDF identity | BFF queries Kusto REST with the app identity |

All tenant-, workspace-, data-, Maps-, and UDF-specific values used by the app
are centralized in [`config/constants.js`](../config/constants.js). It is the
single application file to update when porting the deployment. Its values are
non-secret identifiers and endpoints. Azure Maps uses Microsoft Entra token
authentication; do not put a Maps subscription key in the application or
deployment settings.

The current reference deployment is:

| Resource | Example value |
|---|---|
| Azure subscription | `d9eef650-a87c-433b-a236-0eaf3140d921` |
| Resource group | `maps-tejitpabari` |
| App Service | `fabric-maps-tejitpabari` |
| Azure Maps account | `maps-tejit` |
| Azure Maps client/unique ID | `e3c7516b-b6be-4ef3-be4b-1820312b2b13` |

These are examples only. Substitute resources in the target tenant and
subscription.

## 2. Prerequisites

Before starting, obtain:

- A Fabric workspace in the target tenant.
- Fabric workspace **Admin** permission.
- Eventhouse database **Admin** permission for the Weather and bicycle KQL
  databases.
- An Azure subscription and resource group.
- Permission to create Azure resources and assign Azure RBAC roles. Assigning
  roles normally requires **Owner** or **User Access Administrator** at the
  applicable scope.
- Azure CLI and Node.js 22 LTS installed locally.
- A signed-in Azure CLI session:

  ```powershell
  az login
  az account set --subscription <subscriptionId>
  ```

A Fabric administrator must enable both of these tenant settings in
**Fabric Admin portal -> Tenant settings**:

1. **Developer settings -> Service principals can use Fabric APIs**
2. **OneLake settings -> Users can access data stored in OneLake with apps
   external to Fabric**

If either setting is scoped to security groups, ensure the App Service managed
identity's service principal is included in an allowed group. The first setting
is required for the app identity to invoke published UDFs. The second is
required for direct OneLake access from Azure App Service.

## 3. Port the data

Create the destination Fabric items and copy or recreate all five data sources.
Record every value called out below; those values are used in later steps.

### Find Fabric IDs and endpoints

In the Fabric portal, open the workspace or item and use **Settings** or
**Properties** to copy its ID. The browser URL also contains the workspace and
item IDs. For a Lakehouse, open its SQL analytics endpoint and copy the
**SQL connection string** and **database name** from the endpoint properties.
For an Eventhouse/KQL database, copy the **Query URI** from its details or
connection information.

OneLake DFS paths follow this convention:

```text
https://onelake.dfs.fabric.microsoft.com/<workspaceId>/<lakehouseId>/Files/<path>
```

The UDF Lakehouse client treats paths as relative to `Files`, so
`Files/GeoJson/Car_Parks.geojson` in OneLake is
`GeoJson/Car_Parks.geojson` in `connectToFiles()`.

### Car parks

1. Create or select a Lakehouse in the new workspace.
2. Create the `Files/GeoJson` folder if it does not exist.
3. Upload `Car_Parks.geojson` to:

   ```text
   Files/GeoJson/Car_Parks.geojson
   ```

4. Record:
   - `<workspaceId>`
   - `<lakehouseId>`

### PMTiles

Upload `GpsTrace.pmtiles` to the same Lakehouse:

```text
Files/GeoJson/GpsTrace.pmtiles
```

The archive must contain MVT vector tiles and declare the `GpsTrace` source
layer.

### Airports

1. In the Lakehouse, create or load table `dbo.airports`, for example by
   importing the airports CSV/data.
2. Preserve the shape expected by this demo: latitude in `_c6` and longitude
   in `_c7`.
3. Open the Lakehouse SQL analytics endpoint and confirm this succeeds:

   ```sql
   SELECT TOP 100 * FROM dbo.airports;
   ```

4. Record:
   - `<sqlServer>`: the server from the SQL analytics endpoint connection
     string, ending in `.msit-datawarehouse.fabric.microsoft.com`
   - `<sqlDatabase>`: the Lakehouse SQL endpoint database name

### Kusto weather

1. Create an Eventhouse and a KQL database.
2. Ingest the Fabric **Weather** sample dataset into a table named `Weather`.
3. Confirm `Weather` includes `BeginLat` and `BeginLon`, then run:

   ```kusto
   Weather
   | where isnotnull(BeginLat) and BeginLat != 0
     and isnotnull(BeginLon) and BeginLon != 0
   | take 100
   ```

4. Record:
   - `<weatherQueryUri>`: the cluster query URI
   - `<weatherDatabase>`
   - `<weatherTable>`, normally `Weather`

### Eventstream bicycles

1. Create an Eventstream.
2. Add the built-in sample source **sample-bicycles**.
3. Add a **KQL database** destination.
4. Select or create a destination KQL database and table, for example
   database `BicycleES` and table `BicycleES`.
5. Map the incoming fields, including `Latitude` and `Longitude`.
6. Publish/start the Eventstream.
7. Confirm rows are arriving and that the count continues to grow:

   ```kusto
   table("<bikesTable>")
   | count
   ```

8. Record:
   - `<bikesQueryUri>`: the destination cluster query URI
   - `<bikesDatabase>`
   - `<bikesTable>`

## 4. Create & publish the 5 UDFs

Create one Fabric User Data Functions item per source. Every UDF is published
as a Microsoft Entra-authenticated public endpoint; **Public access** makes the
endpoint internet-reachable, not anonymous.

### Path A: Fabric portal

Repeat these steps for Car Parks, PMTiles, Airports, Weather, and Eventstream:

1. In the target workspace, create a **User Data Functions** item.
2. Paste the source's Python:

   | Source | Python file | Function |
   |---|---|---|
   | Car parks | `fabric-udf/function_app.py` | `get_car_parks` |
   | PMTiles | `fabric-udf/pmtiles/function_app.py` | `get_gpstrace_pmtiles` |
   | Airports | `fabric-udf/airports/function_app.py` | `get_airports` |
   | Weather | `fabric-udf/kusto/function_app.py` | `get_weather` |
   | Eventstream | `fabric-udf/eventstream/function_app.py` | `get_bikes` |

3. For Car Parks, PMTiles, and Airports, open **Manage connections**, add the
   target Lakehouse, and set the alias to exactly match the Python:

   | Source | Alias |
   |---|---|
   | Car parks | `carparkslh` |
   | PMTiles | `gpstracelh` |
   | Airports | `airportslh` |

   Aliases must be alphanumeric only; do not use `_` or `-`.
4. For Weather, edit `CLUSTER_URI` and `DATABASE` near the top of
   `fabric-udf/kusto/function_app.py`. The table is referenced by the `QUERY`
   constant; change `Weather` there if `<weatherTable>` is different.
5. For Eventstream, edit `CLUSTER_URI`, `DATABASE`, and `TABLE` near the top of
   `fabric-udf/eventstream/function_app.py`.
6. For Weather and Eventstream, add the public PyPI library
   `azure-kusto-data` version `6.0.4` to the UDF environment. The checked-in
   specs do this automatically on the scripted path.
7. Ensure every function parameter has a type annotation and no default value.
8. Select **Publish** and wait for publishing to complete. Fabric enforces an
   approximately two-minute cooldown between publishes.
9. Switch from **Develop** to **Run only**.
10. For the data function, select **... -> Properties**, set **Public access**
   to **On**, and copy the **Public URL**.

Record:

```text
<carparkUdfUrl>
<pmtilesUdfUrl>
<airportsUdfUrl>
<weatherUdfUrl>
<eventstreamUdfUrl>
```

### Path B: scripted definition upload

The generic deployment command is:

```powershell
cd <repoRoot>\fabric-udf
python deploy_udf.py --spec <source>/spec.json --script <source>/function_app.py --workspace <newWs>
```

Run it for the generic-spec sources:

```powershell
python deploy_udf.py --spec pmtiles/spec.json --script pmtiles/function_app.py --workspace <newWs>
python deploy_udf.py --spec airports/spec.json --script airports/function_app.py --workspace <newWs>
python deploy_udf.py --spec kusto/spec.json --script kusto/function_app.py --workspace <newWs>
python deploy_udf.py --spec eventstream/spec.json --script eventstream/function_app.py --workspace <newWs>
```

Before running the Lakehouse commands, edit each applicable `spec.json`
`connectedDataSources` entry so:

- `workspaceId` is `<newWs>`.
- `artifactId` is `<lakehouseId>`.
- The alias remains identical to the `@udf.connection` alias in Python.

Before deploying Weather or Eventstream, update the Python Kusto constants as
described in Path A.

Car Parks predates the generic `spec.json` format in this repository. Deploy it
with the equivalent source-specific script:

```powershell
cd <repoRoot>\fabric-udf
python deploy.py --workspace <newWs> --lakehouse <lakehouseId> --create CarParksApi
```

To update an existing UDF rather than create a new item, pass `--udf <udfId>`
to the appropriate deployer.

The scripts create/update the definition headlessly, but publishing is still a
portal operation. For each item, complete **Publish -> Run only -> function
... -> Properties -> Public access On**, then record the Public URL. The same
alias, no-default-parameter, and approximately two-minute publish-cooldown
constraints apply to both paths.

## 5. Grant permissions

There are two separate runtime identities:

- Each Weather/Eventstream UDF has its own Fabric-managed runtime identity.
- The Azure App Service created in step 6 has its own system-assigned managed
  identity.

### Grant each Kusto-backed UDF

For **each** of the Weather and Eventstream UDFs:

1. Invoke the published function once.
2. Expect HTTP 403 with an error like:

   ```text
   Principal 'aadapp=<clientId>;<tenantId>' is not authorized to read database '<db>'
   ```

3. Copy the complete principal, including the tenant ID.
4. As an Eventhouse database admin, run this in the KQL query editor:

   ```kusto
   .add database <db> viewers ('aadapp=<clientId>;<tenantId>') 'Allow the Fabric UDF to read this database'
   ```

5. Invoke the function again and confirm it succeeds.

Each UDF has a different managed identity, so do not reuse one UDF's
`aadapp=...` principal for the other.

### Grant the App Service managed identity

After creating the App Service identity in step 6, grant it:

| Target | Required permission |
|---|---|
| Fabric workspace | **Viewer**, which covers OneLake file reads and the Lakehouse SQL analytics endpoint in user-identity mode |
| Weather KQL database | **Database Viewer** |
| Bicycle KQL database | **Database Viewer** |
| Each of the five UDF items | **Execute** |
| Azure Maps account | Azure RBAC role **Azure Maps Data Reader** |

For each KQL database, use the App Service managed identity's client ID and the
target tenant ID:

```kusto
.add database <db> viewers ('aadapp=<miClientId>;<tenantId>') 'Allow the map app to query this database'
```

Share each UDF item with the managed identity and grant **Execute**, or assign a
workspace role that grants UDF execution. Workspace **Viewer** may not grant
UDF **Execute**, so explicitly share each UDF when invocation returns 403.

The Lakehouse SQL analytics endpoint is used in **user identity mode**. Do not
run `GRANT SELECT` for the app identity; its OneLake/workspace role governs
SQL reads.

To grant Azure Maps access with Azure CLI:

```powershell
$mapsId = az maps account show -g <mapsResourceGroup> -n <mapsAccount> --query id -o tsv
az role assignment create --assignee-object-id <principalId> --assignee-principal-type ServicePrincipal --role "Azure Maps Data Reader" --scope $mapsId
```

## 6. Provision + deploy the Azure app

Run these commands from a PowerShell terminal. Replace every angle-bracket
placeholder.

```powershell
az login
az account set --subscription <subscriptionId>

# Create the resource group, or skip this command when it already exists.
az group create -n <rg> -l <region>
```

Create or select an Azure Maps account in the Azure portal. When creating one,
place it in the target subscription/resource group, select an appropriate
pricing tier for the deployment, and then copy its **Client ID** (also shown as
the unique account ID) from the account's **Authentication** page. Record it as
`<mapsClientId>`.

Create the Linux App Service:

```powershell
az appservice plan create -g <rg> -n <plan> --is-linux --sku B1 -l <region>
az webapp create -g <rg> -p <plan> -n <appName> --runtime "NODE:22-lts"

az webapp identity assign -g <rg> -n <appName>
az ad sp show --id <principalId> --query appId -o tsv

az webapp config set -g <rg> -n <appName> --startup-file "node server/server.js"
az webapp update -g <rg> -n <appName> --https-only true

az webapp config appsettings set -g <rg> -n <appName> --settings AZURE_MAPS_CLIENT_ID=<mapsClientId> WEBSITE_RUN_FROM_PACKAGE=1
```

Record both identity values:

- `<principalId>`: object ID returned by `az webapp identity assign`
- `<miClientId>`: application/client ID returned by `az ad sp show`

Use those values for the grants in step 5. Set
`AZURE_MAPS_CLIENT_ID=<maps account client/unique id>`. Do **not** set
`AZURE_MAPS_KEY`; a browser-visible key is not needed. All other application
configuration comes from `config/constants.js` baked into the deployment
package.

### Reliable package deployment

Do not rely on the App Service Oryx build to restore dependencies during every
redeployment. Oryx can leave `node_modules` incomplete; the observed symptom
was:

```text
Cannot find module 'pmtiles'
```

The reliable method is to install dependencies locally, include
`node_modules`, and run the immutable zip through
`WEBSITE_RUN_FROM_PACKAGE=1`:

```powershell
cd <repoRoot>
npm install

Compress-Archive `
  -Path server,public,config,node_modules,package.json,package-lock.json `
  -DestinationPath <zip> `
  -Force

az webapp config appsettings set -g <rg> -n <appName> --settings WEBSITE_RUN_FROM_PACKAGE=1 AZURE_MAPS_CLIENT_ID=<mapsClientId>
az webapp deploy -g <rg> -n <appName> --src-path <zip> --type zip
```

The archive entries must be at the zip root: `server/`, `public/`, `config/`,
`node_modules/`, `package.json`, and `package-lock.json`. Do not zip a parent
folder around them.

The Azure CLI may print HTTP 502 or appear to hang while polling the restart
even when deployment succeeded. Wait about one minute, then verify the running
app instead of immediately redeploying:

```powershell
curl.exe https://<appName>.azurewebsites.net/api/config
```

The app is public/anonymous by default; App Service Easy Auth is not enabled.
To restrict access to signed-in users, enable **App Service Authentication
(Easy Auth)** with Microsoft Entra ID.

For the reference deployment, the placeholders were:

```text
<subscriptionId> = d9eef650-a87c-433b-a236-0eaf3140d921
<rg>             = maps-tejitpabari
<appName>        = fabric-maps-tejitpabari
<mapsAccount>    = maps-tejit
<mapsClientId>   = e3c7516b-b6be-4ef3-be4b-1820312b2b13
```

## 7. Update `config/constants.js`

[`config/constants.js`](../config/constants.js) is the **only application file
to edit for a new tenant**. Replace its values with those recorded in steps 3
and 4.

| Field | Value source |
|---|---|
| `workspaceId` | Target Fabric workspace item properties or workspace URL |
| `lakehouseId` | Target Lakehouse item properties or item URL |
| `files.carpark` | Lakehouse-relative path; normally `Files/GeoJson/Car_Parks.geojson` |
| `files.pmtiles` | Lakehouse-relative path; normally `Files/GeoJson/GpsTrace.pmtiles` |
| `sql.server` | Lakehouse SQL analytics endpoint connection string/server |
| `sql.database` | Lakehouse SQL analytics endpoint database name |
| `sql.table` | Airports table; normally `dbo.airports` |
| `kusto.uri` | Weather Eventhouse/KQL database query URI |
| `kusto.db` | Weather KQL database name |
| `kusto.table` | Weather table name; normally `Weather` |
| `eventstream.kustoUri` | Eventstream destination KQL database query URI |
| `eventstream.kustoDb` | Eventstream destination KQL database name |
| `eventstream.table` | Eventstream destination table; for example `BicycleES` |
| `mapsClientId` | Azure Maps account client/unique ID from its Authentication properties |
| `udf.resource` | Keep `https://analysis.windows.net/powerbi/api` |
| `udf.carpark` | Published `get_car_parks` Public URL |
| `udf.pmtiles` | Published `get_gpstrace_pmtiles` Public URL |
| `udf.airports` | Published `get_airports` Public URL |
| `udf.kusto` | Published `get_weather` Public URL |
| `udf.eventstream` | Published `get_bikes` Public URL |

After editing the constants, rebuild the zip and redeploy it with the commands
in step 6. Do not add secrets or keys to `constants.js`.

## 8. Verify

First verify the server configuration:

```powershell
curl.exe https://<appName>.azurewebsites.net/api/config
```

Confirm:

- The response is HTTP 200.
- `maps.authType` is `"aad"`.
- The response contains a Maps `clientId`, not a key.
- All five sources and both methods are listed.

Then open:

```text
https://<appName>.azurewebsites.net
```

For each source, select and load both **Function** and **Direct**:

| Source | Function | Direct |
|---|---|---|
| Car parks | UDF | OneLake file |
| PMTiles | UDF | OneLake file |
| Airports | UDF | SQL endpoint |
| Weather | UDF | Kusto REST |
| Bicycles | UDF | Kusto REST |

Confirm the map renders for every combination. Map rendering requires the app
identity to have **Azure Maps Data Reader**. Function methods require both
**Service principals can use Fabric APIs** in the Fabric tenant and **Execute**
permission for the app identity on the applicable UDF item.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Direct OneLake request returns 403 | The OneLake external-apps tenant setting is disabled or the app identity lacks workspace/Lakehouse read access | Enable **Users can access data stored in OneLake with apps external to Fabric** and grant the managed identity Fabric workspace **Viewer** |
| SQL endpoint reports `Login failed` | The same OneLake external-apps setting or workspace identity access is missing | Enable the tenant setting and grant workspace **Viewer**; the endpoint is in user identity mode, so do not use `GRANT SELECT` |
| UDF invocation returns 403 | Service-principal Fabric API access is disabled or the app identity lacks UDF Execute | Enable **Service principals can use Fabric APIs** and grant the App Service managed identity **Execute** on that UDF |
| UDF returns 403 `not authorized to read database` | That UDF's own managed identity lacks Kusto Database Viewer | Copy its complete `aadapp=<clientId>;<tenantId>` principal from the error and run `.add database <db> viewers (...)` as DB admin |
| Map is blank or Maps token request returns 401/403 | App Service managed identity lacks Azure Maps access | Grant **Azure Maps Data Reader** on the Maps account to the App Service identity |
| App startup reports `MODULE_NOT_FOUND`, especially `Cannot find module 'pmtiles'` | Oryx deployment left `node_modules` incomplete | Run `npm install` locally, bundle `node_modules` in the zip, set `WEBSITE_RUN_FROM_PACKAGE=1`, and redeploy the package |
