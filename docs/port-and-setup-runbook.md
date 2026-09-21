# Port and setup runbook

This runbook recreates the Fabric-to-Azure-Maps demo in another tenant or
workspace without requiring the Azure CLI. Azure work is performed in the
Azure portal, Fabric work in the Fabric portal, and deployment through VS Code,
Deployment Center, or Kudu.

## 1. Overview & architecture

The solution has a static browser frontend and a Node.js
Backend-for-Frontend (BFF) hosted by Azure App Service:

```text
browser
  |-- Azure Maps Web SDK
  |-- pmtiles.js + atlas.addProtocol("pmtiles", ...)
  |
  v
Azure App Service (Node BFF, system-assigned managed identity)
  |-- OneLake files
  |-- Lakehouse SQL analytics endpoint
  |-- Eventhouse/Kusto
  `-- published Fabric User Data Functions
```

The browser calls fixed application routes. It never receives a Fabric,
OneLake, SQL, Kusto, or UDF access token. In Azure, the BFF uses
`DefaultAzureCredential` to authenticate as the Web App's system-assigned
managed identity.

The app has exactly four sources, each available through **Function** and
**Direct** methods:

| Source | Function method | Direct method |
|---|---|---|
| `carpark` | A UDF reads `Car_Parks.geojson` through a managed Lakehouse connection | The BFF reads the file from OneLake |
| `pmtiles` | A UDF returns the complete `GpsTrace.pmtiles` archive as base64 | The BFF reads the complete archive from OneLake |
| `airports` | A UDF queries `dbo.airports` through a managed Lakehouse connection | The BFF queries the Lakehouse SQL analytics endpoint |
| `eventstream` | A UDF queries the Eventstream destination table in Kusto using the UDF's own identity | The BFF queries Kusto REST using the Web App identity |

### PMTiles request flow

The server does **not** extract or serve individual MVT tiles. For either
method, it obtains the complete PMTiles archive and exposes it through:

```text
GET /api/pmtiles-archive?method=function
GET /api/pmtiles-archive?method=direct
```

The endpoint supports HTTP Range requests and normally returns `206 Partial
Content` for the byte ranges requested by the browser. In the browser,
`pmtiles.js` is registered with Azure Maps through
`atlas.addProtocol("pmtiles", protocol.tile)`. Azure Maps uses a
`pmtiles://` URL, and `pmtiles.js` range-reads and decodes the vector tiles
client-side.

A fully backend-free PMTiles alternative is to copy the `.pmtiles` archive to
a publicly readable blob or static host that supports byte ranges and CORS,
then point the browser's `pmtiles://` URL directly at that HTTPS URL. That
alternative bypasses both the BFF and the UDF for PMTiles, but makes the archive
public.

All app-specific identifiers and endpoints are centralized in
[`config/constants.js`](../config/constants.js). It is the only application
file that must change when moving the already-created Fabric resources to a
new tenant.

Reference deployment values, included only as examples:

| Resource | Example |
|---|---|
| Azure subscription | `d9eef650-a87c-433b-a236-0eaf3140d921` |
| Resource group | `maps-tejitpabari` |
| Web App | `fabric-maps-tejitpabari` |
| Azure Maps account | `maps-tejit` |
| Azure Maps account client ID | `e3c7516b-b6be-4ef3-be4b-1820312b2b13` |
| Web App managed identity object ID | `4d0ee87a-990f-4ee6-abd0-f3af3701bb12` |
| Web App managed identity application/client ID | `2ab31ef8-a98c-4d65-aee3-000f7a90ae4b` |

Do not copy these identities into another deployment. Use the values created
in the target tenant.

## 2. Prerequisites

You need:

- A target Fabric workspace and permission to create Lakehouse, Eventstream,
  Eventhouse/KQL database, and User Data Functions items.
- **Admin** access to the target Fabric workspace.
- **Database Admin** access to the Eventhouse/KQL database, so you can grant
  Database Viewer.
- An Azure subscription and resource group.
- Permission to create an App Service plan and Web App.
- Permission to assign Azure RBAC roles, normally **Owner** or **User Access
  Administrator** at the applicable scope.
- An Azure Maps account. In the Azure portal, open the account's
  **Authentication** page and record its **Client ID** (also called the unique
  account ID).
- Node.js 20 or 22 LTS on the deployment workstation.
- Visual Studio Code with the **Azure App Service** extension if you choose the
  VS Code deployment option.

No Azure CLI installation or sign-in is required by this runbook.

## 3. Port the data

Create or select the target Fabric items, copy the four sources, and record the
identifiers and endpoints called out below.

### Find Fabric IDs and endpoints

- **Workspace ID:** open the workspace and copy the ID from the browser URL or
  workspace properties.
- **Lakehouse ID:** open the Lakehouse and copy its item ID from the browser URL
  or item properties.
- **SQL server and database:** open the Lakehouse's SQL analytics endpoint and
  copy its SQL connection string/server and database name.
- **Kusto query URI:** open the Eventhouse/KQL database and copy its **Query
  URI** from the item details or connection information.

OneLake file URLs follow this shape:

```text
https://onelake.dfs.fabric.microsoft.com/<workspaceId>/<lakehouseId>/Files/<path>
```

The app configuration uses paths beginning with `Files/`. A UDF
`FabricLakehouseClient.connectToFiles()` path is relative to the `Files` root
and therefore omits that prefix.

### 3.1 Car parks

1. In the Fabric portal, create or select a Lakehouse.
2. Under **Files**, create the folder `GeoJson` if it does not exist.
3. Upload `Car_Parks.geojson` as:

   ```text
   Files/GeoJson/Car_Parks.geojson
   ```

4. Record the workspace ID and Lakehouse ID.

### 3.2 PMTiles

1. Upload `GpsTrace.pmtiles` to the same Lakehouse:

   ```text
   Files/GeoJson/GpsTrace.pmtiles
   ```

2. Confirm that the archive contains MVT vector tiles and declares a vector
   source layer. The current sample archive declares `GpsTrace`.

The Function method returns the full archive as base64; the Direct method reads
the full archive from OneLake. Both methods then expose the archive through the
same HTTP Range endpoint described in section 1.

### 3.3 Airports

1. Create or load the Lakehouse table `dbo.airports` using the Fabric portal,
   a Fabric data pipeline, or a Fabric notebook.
2. Preserve the schema expected by the sample: latitude is in `_c6` and
   longitude is in `_c7`.
3. In the Lakehouse SQL analytics endpoint, open a query and confirm:

   ```sql
   SELECT TOP 100 * FROM dbo.airports;
   ```

4. Record:
   - The SQL server name ending in
     `.msit-datawarehouse.fabric.microsoft.com`.
   - The SQL endpoint database name.
   - The table name, normally `dbo.airports`.

### 3.4 Eventstream bicycles

1. In the Fabric portal, create an Eventstream.
2. Add the built-in **sample-bicycles** source.
3. Add a **KQL database** destination.
4. Select or create a destination database and table, for example database
   `BicycleES` and table `BicycleES`.
5. Map the incoming fields, including `Latitude` and `Longitude`.
6. Publish and start the Eventstream.
7. Open the destination KQL database or queryset and confirm that rows arrive:

   ```kusto
   table("<bikesTable>")
   | count
   ```

8. Record the Eventhouse query URI, database name, and table name.

## 4. Create & publish the 4 UDFs

Create one User Data Functions item for each source in the Fabric portal.
These steps use no Azure CLI.

| Source | Code to copy | Function to publish | Data access |
|---|---|---|---|
| Car parks | `fabric-udf/function_app.py` | `get_car_parks` | Managed Lakehouse connection, alias `carparkslh` |
| PMTiles | `fabric-udf/pmtiles/function_app.py` | `get_gpstrace_pmtiles` | Managed Lakehouse connection, alias `gpstracelh` |
| Airports | `fabric-udf/airports/function_app.py` | `get_airports` | Managed Lakehouse connection, alias `airportslh` |
| Eventstream | `fabric-udf/eventstream/function_app.py` | `get_bikes` | Kusto SDK using the UDF runtime's own managed identity |

Repeat the following for each source:

1. In the target workspace, select **New item** and create a **User Data
   Functions** item.
2. Open the item in **Develop** mode and replace its Python with the source file
   listed above.
3. For Car parks, PMTiles, and Airports:
   1. Open **Manage connections**.
   2. Add the target Lakehouse.
   3. Use the exact alias shown in the table. Connection aliases must be
      alphanumeric; do not use `_` or `-`.
4. For Eventstream:
   1. Before copying the code, update `CLUSTER_URI`, `DATABASE`, and `TABLE` in
      `fabric-udf/eventstream/function_app.py` to the destination created in
      section 3.
   2. In the UDF environment/library management experience, add the public
      PyPI package `azure-kusto-data` version `6.0.4`.
5. Publish the item. Fabric imposes an approximately two-minute cooldown before
   the same item can be published again.

### Turn on the Public URL and copy it

Perform these exact steps after publishing each UDF:

1. In the UDF item, change the mode dropdown from **Develop** to **Run only**.
2. In **Functions Explorer**, select the function named in the table above.
3. Open **⋯ (More options) -> Properties** for that function.
4. In the **Properties** pane, set **Public access = On**.
5. Copy the **Public URL** field.

Record all four URLs:

```text
<carparkUdfUrl>
<pmtilesUdfUrl>
<airportsUdfUrl>
<eventstreamUdfUrl>
```

**Public access does not mean anonymous access.** The URL is internet-reachable,
but every invocation still requires a Microsoft Entra token for
`https://analysis.windows.net/powerbi/api`.

> **Optional CLI alternative:** the scripts under `fabric-udf/` can upload UDF
> definitions, but they require an Azure CLI user sign-in. They are not needed
> for this portal-only flow, and publishing plus Public URL configuration still
> happen in the Fabric portal.

## 5. Grant the UDF identities

### 5.1 Smoke-test every UDF to surface auth errors

After all four UDFs are created and published, proactively invoke every
function once:

1. Open each UDF item and switch it to **Run only** mode.
2. In **Functions Explorer**, select the function.
3. Use the portal's **Test** or **Run** action to invoke it. Alternatively, POST
   to its Public URL with a Microsoft Entra token for
   `https://analysis.windows.net/powerbi/api`.
4. Confirm or record the result before moving to the next UDF.

Expected first-run results:

| UDF | Function | Expected result |
|---|---|---|
| Car parks | `get_car_parks` | Succeeds because its managed Lakehouse connection is already wired |
| PMTiles | `get_gpstrace_pmtiles` | Succeeds because its managed Lakehouse connection is already wired |
| Airports | `get_airports` | Succeeds because its managed Lakehouse connection is already wired |
| Eventstream | `get_bikes` | Initially fails with HTTP 403 because its own managed identity has not yet been granted Kusto Database Viewer |

The Eventstream failure should name the exact identity that Kusto rejected:

```text
Principal 'aadapp=<clientId>;<tenantId>' is not authorized to read database '<db>'
```

Do not guess or construct this principal in advance. Run the UDF, read the 403,
and grant exactly the complete `aadapp=<clientId>;<tenantId>` principal named
in the error. Use the same discovery process for any UDF that queries
Kusto/Eventhouse through its own managed identity.

### 5.2 Grant the Kusto-backed UDF identity

Only the Kusto-backed **Eventstream Function method** needs this manual grant
for its UDF runtime identity.

Why this grant exists:

- The Eventstream UDF calls Kusto through `azure-kusto-data`.
- Kusto/Eventhouse is not being supplied to this UDF as a Fabric managed
  connection.
- The UDF therefore authenticates to Kusto with the UDF runtime's **own managed
  identity**.
- Kusto must explicitly authorize that identity as a database Viewer.

This UDF identity grant is **not** needed:

- For any Direct method.
- For a UDF that reads data through a Fabric managed connection.
- If the Eventstream Function method is never invoked.

To grant the principal surfaced by the smoke test:

1. Copy the complete principal value from the 403, including both IDs.
2. In the Fabric portal, open the destination KQL database or its KQL queryset
   editor.
3. Run:

   ```kusto
   .add database <db> viewers ('aadapp=<clientId>;<tenantId>') 'Eventstream UDF managed identity'
   ```

4. Return to the Eventstream UDF in **Run only** mode and invoke `get_bikes`
   again.
5. Confirm that it now succeeds.

This is a KQL control command run in the Fabric portal query editor. It is not
an Azure CLI command.

## 6. Provision the Azure App Service + enable its managed identity

Use the Azure portal instructions in
[Quickstart: Create a Node.js web app](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs?tabs=linux&pivots=development-environment-azure-portal)
to create the Web App.

Use these settings:

- **Publish:** Code
- **Operating system:** Linux
- **Runtime stack:** Node 20 LTS or Node 22 LTS
- **Region and App Service plan:** select values appropriate for the target
  subscription
- **Web App name:** globally unique, for example
  `fabric-maps-tejitpabari`

After creation:

1. Open the Web App in the Azure portal.
2. Under **Settings -> Configuration -> General settings**, set the startup
   command to:

   ```text
   node server/server.js
   ```

3. Enable **HTTPS Only**.
4. Follow
   [Use a managed identity in App Service](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity?tabs=portal):
   - Open **Settings -> Identity**.
   - On **System assigned**, set **Status = On**.
   - Save.
5. Record the identity's **Object (principal) ID** shown on the Identity page.
6. Record the identity's **Application (client) ID**:
   - Open **Microsoft Entra ID -> Enterprise applications**.
   - Search for the enterprise application named like the Web App.
   - Open it and copy its **Application ID**.
7. In Microsoft Entra ID, also record the target **Tenant ID** from the
   **Overview** page.

The object ID is used by portal role-assignment pickers. The application/client
ID and tenant ID are used in Kusto's `aadapp=<clientId>;<tenantId>` principal.

## 7. Grant the app managed identity its access

The Web App's system-assigned managed identity needs four kinds of access.

Which grants you actually need depends on which **methods** you expose:

| Grant | Needed for | Skippable if… |
|---|---|---|
| 7.1 "Service principals can use Fabric APIs" | **Function** methods (invoke UDFs) | you never use Function methods |
| 7.1 "OneLake external apps" | **Direct** methods (OneLake/SQL) | you never use Direct methods |
| 7.2 Workspace Viewer | **Direct** methods (Car parks, PMTiles, Airports) | you only use Function methods |
| 7.3 Kusto DB Viewer (app MI) | **Direct** method (Eventstream) | you only use Function methods |
| 7.4 Azure Maps Data Reader | the **map to render at all** | never (always required) |
| 7.5 UDF Execute | **Function** methods (invoke UDFs) | you never use Function methods |

(The Function methods rely on the **UDF's own** identity/connection — the Lakehouse
auto-wired connection, or the Kusto Viewer grant in 5.2 — not on 7.2/7.3.)

### 7.1 Enable the two Fabric tenant settings

A Fabric tenant administrator must open **Fabric Admin portal -> Tenant
settings** and enable:

1. **Service principals can use Fabric APIs**
2. **Users can access data stored in OneLake with apps external to Fabric**

If either setting is limited to a security group:

1. Open **Microsoft Entra ID -> Groups** in the Azure portal.
2. Open the allowed group.
3. Select **Members -> Add members**.
4. Search for the Web App managed identity by name and add it. Managed
   identities appear in the member picker as enterprise applications/service
   principals.

The first setting allows the Web App identity to call published UDFs. The
second allows Direct OneLake access from App Service.

### 7.2 Fabric workspace Viewer — Direct methods only

> **Skip this if you only use the Function (UDF) methods.** This grant is what
> lets the *app's* identity read data directly; the Function methods never use it
> (the UDF reads the data instead). Needed only for the Direct methods of Car
> parks, PMTiles (OneLake), and Airports (SQL).

In the Fabric portal:

1. Open the target workspace.
2. Select **Manage access**.
3. Select **Add people or groups**.
4. Search for the Web App managed identity name.
5. Select role **Viewer**.
6. Select **Add**.

This covers OneLake file reads for Car parks and PMTiles and the Lakehouse SQL
analytics endpoint in user-identity mode for Airports.

### 7.3 Kusto Database Viewer for the Web App — Direct method only

> **Skip this if you only use the Function (UDF) method** for the eventstream.
> This grant is for the Eventstream **Direct** method (the app's identity queries
> Kusto). It is separate from — and not a substitute for — the UDF identity grant
> in section 5.2 (which the Function method uses).

1. In the Fabric portal, open the bikes KQL database or its KQL queryset.
2. In the query editor, run:

   ```kusto
   .add database <db> viewers ('aadapp=<appClientId>;<tenantId>') 'app MI'
   ```

Use the Web App managed identity's **application/client ID**, not its object ID.

### 7.4 Azure Maps Data Reader

Follow
[Assign Azure roles using the Azure portal](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal):

1. In the Azure portal, open the Azure Maps account.
2. Open **Access control (IAM)**.
3. Select **Add -> Add role assignment**.
4. Choose **Azure Maps Data Reader**.
5. For **Assign access to**, choose **Managed identity**.
6. Select the subscription and **App Service**, then choose the Web App's
   system-assigned identity.
7. Select **Review + assign**.

This role allows `/api/maps-token` to mint a usable Azure Maps token for the
browser. Do not use or expose an Azure Maps subscription key.

### 7.5 UDF Execute on all four UDF items

For each UDF item in the Fabric portal:

1. Open the UDF item.
2. Select **Share** or **Manage permissions**.
3. Add the Web App managed identity.
4. Grant permission to run/execute the published function.

Workspace Viewer may already allow invocation of published functions in some
tenants. If a Function call returns 403, explicitly share each UDF with the
managed identity and grant **Execute**.

## 8. Configure app settings + deploy the code

Before packaging, update the tenant-specific files listed in the final section
of this runbook. For an already-created set of UDFs, only
`config/constants.js` needs to change.

### 8.1 App settings

In the Azure portal:

1. Open the Web App.
2. Open **Settings -> Configuration -> Application settings**.
3. Add:

   | Name | Value |
   |---|---|
   | `AZURE_MAPS_CLIENT_ID` | The Azure Maps account client/unique ID |
   | `WEBSITE_RUN_FROM_PACKAGE` | `1` |

4. Save and allow the Web App to restart.

Do **not** set `AZURE_MAPS_KEY`. A key would be returned to the browser by
`/api/config`. With no key set, the app uses Microsoft Entra authentication and
the managed identity.

All other runtime configuration comes from `config/constants.js` baked into
the deployment package.

### 8.2 Prepare a deployment package

The App Service platform build can leave `node_modules` incomplete across
redeployments. The observed symptom was:

```text
Cannot find module 'pmtiles'
```

Install production dependencies locally and bundle `node_modules`:

```powershell
Set-Location <repoRoot>
npm install

Compress-Archive `
  -Path server,public,config,node_modules,package.json,package-lock.json `
  -DestinationPath fabric-maps.zip `
  -Force
```

The zip root must directly contain:

```text
server/
public/
config/
node_modules/
package.json
package-lock.json
```

Do not add an extra parent directory around those entries. Keep
`WEBSITE_RUN_FROM_PACKAGE=1` so App Service runs the immutable package rather
than depending on a partial platform restore.

### 8.3 Deploy without Azure CLI

Choose one option:

#### Option A: VS Code Azure App Service extension

1. Open the repository in VS Code.
2. Open the **Azure** view and sign in.
3. Under **App Service**, find the Web App.
4. Right-click it and select **Deploy to Web App**.
5. Select the prepared app folder/package and confirm the target Web App.

Ensure the deployed content includes the bundled `node_modules`.

#### Option B: Azure portal Deployment Center

Open the Web App's **Deployment Center** and configure GitHub Actions or an
external Git source. Ensure the workflow/package installs and includes all
dependencies and deploys the required root entries listed above.

#### Option C: Kudu ZIP push

1. Build `fabric-maps.zip` as described above.
2. Open:

   ```text
   https://<appName>.scm.azurewebsites.net/ZipDeployUI
   ```

3. Sign in when prompted.
4. Drag and drop `fabric-maps.zip` into the Kudu ZIP Deploy UI.

Deployment can report HTTP 502 or appear to hang during the Web App restart
even when the package was accepted. Wait for the restart, then verify
`/api/config` before uploading again.

The app is public/anonymous by default. To require user sign-in, enable
[App Service Authentication (Easy Auth)](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization).

## 9. Verify

### 9.1 Verify configuration

Open:

```text
https://<appName>.azurewebsites.net/api/config
```

Confirm:

- The response is HTTP 200.
- `maps.authType` is `"aad"`.
- `maps.clientId` is the intended Azure Maps account client ID.
- No Azure Maps key appears.
- Exactly four sources are listed: `carpark`, `pmtiles`, `airports`, and
  `eventstream`.
- Each source lists `function` and `direct`.

### 9.2 Verify all eight source/method combinations

Open:

```text
https://<appName>.azurewebsites.net
```

Load both methods for each source:

| Source | Function | Direct |
|---|---|---|
| `carpark` | Published Car parks UDF | OneLake file |
| `pmtiles` | Published PMTiles UDF | OneLake file |
| `airports` | Published Airports UDF | SQL analytics endpoint |
| `eventstream` | Published Eventstream UDF | Kusto REST |

Confirm that the map renders for all eight combinations.

- Map rendering requires **Azure Maps Data Reader** on the Maps account.
- All Function methods require **Service principals can use Fabric APIs** and
  permission for the Web App identity to execute the applicable UDF.
- The Eventstream Function method additionally requires the Eventstream UDF's
  own identity to have Kusto Database Viewer, as described in section 5.
- Eventstream Direct requires the Web App identity to have Kusto Database
  Viewer.
- Car parks and PMTiles Direct require the OneLake external-apps tenant setting
  and workspace Viewer.

For PMTiles, browser developer tools should show Range requests to:

```text
/api/pmtiles-archive?method=function
/api/pmtiles-archive?method=direct
```

Those Range requests should return `206 Partial Content`. The browser decodes
the vector tiles through the registered `pmtiles://` protocol.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/config` returns 404 or the app does not start | The startup command or package root is wrong | Set `node server/server.js`; ensure `server/`, `public/`, and `config/` are at the package root |
| `/api/config` exposes Maps key auth | `AZURE_MAPS_KEY` is set | Remove `AZURE_MAPS_KEY`, retain `AZURE_MAPS_CLIENT_ID`, and restart |
| Map is blank or `/api/maps-token` returns 401/403 | The Web App identity lacks Maps access or the Maps client ID is wrong | Grant **Azure Maps Data Reader** on the intended Maps account and verify `AZURE_MAPS_CLIENT_ID` |
| Direct Car parks or PMTiles returns 403 | OneLake external-app access is disabled or the app identity lacks workspace access | Enable **Users can access data stored in OneLake with apps external to Fabric** and grant workspace **Viewer** |
| Airports Direct reports `Login failed` | The same tenant setting or workspace access is missing | Enable the OneLake external-app setting and grant workspace **Viewer**; this app uses the SQL endpoint in user-identity mode |
| Any Function method returns 403 before entering the function | Fabric API access is disabled for service principals or the app identity lacks UDF Execute | Enable **Service principals can use Fabric APIs** and share the UDF with the Web App managed identity granting Execute |
| Eventstream Function returns `Principal 'aadapp=...' is not authorized to read database` | The UDF runtime identity lacks Kusto Database Viewer | Copy that exact principal and run the section 5 `.add database ... viewers` command in the Fabric KQL editor |
| Eventstream Direct returns a Kusto authorization error | The Web App managed identity lacks Kusto Database Viewer | Run the section 7 command using the Web App identity's application/client ID and tenant ID |
| PMTiles metadata loads but tile requests fail | The Range endpoint, archive, or source layer is wrong | Confirm requests use `/api/pmtiles-archive?method=function|direct`, return 206, and the archive declares an MVT vector layer |
| Public-blob PMTiles fails in the browser | The blob is private or CORS/Range access is not available | Make the archive publicly readable and configure the host to allow the app origin and byte-range reads |
| Startup logs show `Cannot find module 'pmtiles'` | App Service has an incomplete `node_modules` after redeployment | Run `npm install` locally, bundle `node_modules`, set `WEBSITE_RUN_FROM_PACKAGE=1`, and redeploy |
| ZIP deployment reports 502 or hangs during restart | Kudu accepted the package but the restart/polling response failed | Wait about a minute and open `/api/config`; redeploy only if the running package is still old or unavailable |
| A UDF cannot be republished immediately | Fabric's publish cooldown is active | Wait approximately two minutes, then publish again |

## What to edit in code after creating new Fabric resources

### App configuration

[`config/constants.js`](../config/constants.js) is the **only application file
to edit for a new tenant**.

| File and field | Value to enter | Where to get it |
|---|---|---|
| `config/constants.js` -> `workspaceId` | Target workspace GUID | Fabric workspace URL or Properties |
| `config/constants.js` -> `lakehouseId` | Target Lakehouse item GUID | Lakehouse URL or Properties |
| `config/constants.js` -> `files.carpark` | Normally `Files/GeoJson/Car_Parks.geojson` | The path used when uploading the file |
| `config/constants.js` -> `files.pmtiles` | Normally `Files/GeoJson/GpsTrace.pmtiles` | The path used when uploading the archive |
| `config/constants.js` -> `sql.server` | SQL analytics endpoint server | Lakehouse SQL endpoint connection string/Properties |
| `config/constants.js` -> `sql.database` | SQL analytics endpoint database | Lakehouse SQL endpoint connection information |
| `config/constants.js` -> `sql.table` | Normally `dbo.airports` | Target Lakehouse table name |
| `config/constants.js` -> `eventstream.kustoUri` | Eventhouse/Kusto query URI | Eventhouse or KQL database connection details |
| `config/constants.js` -> `eventstream.kustoDb` | Bikes database name | Eventstream KQL destination |
| `config/constants.js` -> `eventstream.table` | Bikes table name | Eventstream KQL destination |
| `config/constants.js` -> `mapsClientId` | Azure Maps account client/unique ID | Azure Maps account -> Authentication |
| `config/constants.js` -> `udf.resource` | Keep `https://analysis.windows.net/powerbi/api` | Fixed Fabric UDF token audience |
| `config/constants.js` -> `udf.carpark` | `get_car_parks` Public URL | Car parks UDF -> Run only -> function Properties |
| `config/constants.js` -> `udf.pmtiles` | `get_gpstrace_pmtiles` Public URL | PMTiles UDF -> Run only -> function Properties |
| `config/constants.js` -> `udf.airports` | `get_airports` Public URL | Airports UDF -> Run only -> function Properties |
| `config/constants.js` -> `udf.eventstream` | `get_bikes` Public URL | Eventstream UDF -> Run only -> function Properties |

After editing `config/constants.js`, rebuild the zip and redeploy it using
section 8. Do not add secrets or keys to this file.

### UDF definitions

These edits are needed only when the UDF items are created or recreated. They
are not needed for a normal Web App redeployment.

| File | What to edit | Value source |
|---|---|---|
| `fabric-udf/eventstream/function_app.py` | `CLUSTER_URI`, `DATABASE`, and `TABLE` | Eventhouse query URI and the Eventstream destination database/table |
| `fabric-udf/*/spec.json` for Lakehouse-backed UDF definitions | `connectedDataSources[].artifactId` and `connectedDataSources[].workspaceId`; preserve the matching alphanumeric alias | Target Lakehouse ID and workspace ID from Fabric item Properties |

The checked-in PMTiles and Airports UDFs have `spec.json` files. The Car parks
UDF currently uses `fabric-udf/function_app.py` and is bound to the same target
workspace/Lakehouse through **Manage connections** in the portal; if it is
represented by a spec, use the same `artifactId`, `workspaceId`, and
alphanumeric alias rules.

For all three Lakehouse-backed UDFs--Car parks, PMTiles, and Airports--the
connection alias in the Python decorator, the function metadata, and any
`connectedDataSources` definition must match exactly.
