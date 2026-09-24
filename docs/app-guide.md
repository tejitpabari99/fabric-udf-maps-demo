# Deploy and configure the application

> **Journey:** [Data setup](data_setup.md) → [UDF setup](udf-setup.md) → **App deployment** → [Authorization](auth.md)

## 1 Prerequisites

Complete [UDF setup](udf-setup.md). You need:

- An Azure subscription with permission to create an Azure Maps account and a Linux Web App.
- Write access to this repository or your fork.
- The four Fabric UDF Public URLs.

Use the Azure portal and GitHub web interface for this deployment. Keep the Azure resources and Fabric workspace in the same Microsoft Entra tenant.

## 2 Create an Azure Maps account

1. In the Azure portal, create an **Azure Maps account** in your subscription and resource group.
2. Open the account, then select **Settings** → **Authentication**.
3. Copy the **Client ID**.

Do not use an Azure Maps subscription key in production. For reference, see [Manage authentication in Azure Maps](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-manage-authentication).

## 3 Configure the repository

1. Fork the repository or use a repository where you have write access.
2. In the GitHub web editor, open `config/constants.js`.
3. Set `mapsClientId` to the Azure Maps Client ID.
4. Set these values to the Public URLs from [UDF setup](udf-setup.md):
   - `udf.carpark`
   - `udf.pmtiles`
   - `udf.airports`
   - `udf.eventstream`
5. Leave `udf.resource` unchanged.
6. Commit the changes to `main`.

These values are non-secret. Do not add passwords, tokens, connection strings, or Azure Maps subscription keys to the repository.

## 4 Create the Web App

1. In the Azure portal, create a **Web App**.
2. Set **Publish** to **Code** and **Operating System** to **Linux**.
3. Select a supported Node.js runtime version `>=18`.
4. Select your region and App Service plan, then create the Web App.

The App Service startup value is `node server/server.js`. App Service supplies the port. For reference, see [Create a Node.js Web App](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs) and [Configure Node.js apps in App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs).

## 5 Deploy from GitHub

1. Open the Web App in the Azure portal.
2. Select **Deployment** → **Deployment Center**.
3. Select **GitHub** and authorize access if prompted.
4. Select your GitHub account or organization, repository, and `main` branch.
5. Keep the portal-recommended GitHub deployment settings, then select **Save**.
6. Check **Deployment Center** → **Logs** until the deployment succeeds.

Deployment Center deploys the `main` branch directly. For reference, see [Configure continuous deployment in App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-continuous-deployment).

If you have a ready-built package, you can upload it through the Kudu browser experience. For reference, see [ZIP deployment for App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip).

## 6 Configure the Web App

Open **Settings** → **Environment variables**. Add only the overrides your deployment needs:

| Setting | Purpose |
| --- | --- |
| `AZURE_MAPS_CLIENT_ID` | Overrides `mapsClientId`. |
| `UDF_RESOURCE` | Overrides `udf.resource`. |
| `UDF_CARPARK_ENDPOINT` | Overrides `udf.carpark`. |
| `UDF_PMTILES_ENDPOINT` | Overrides `udf.pmtiles`. |
| `UDF_AIRPORTS_ENDPOINT` | Overrides `udf.airports`. |
| `UDF_EVENTSTREAM_ENDPOINT` | Overrides `udf.eventstream`. |

A non-empty environment variable takes precedence over `config/constants.js`. Remove stale overrides before retesting.

Open **Settings** → **Configuration** → **General settings**, enable **HTTPS Only**, and save.

## 7 Complete authorization

Complete authorization in [Authorization and identity](auth.md):

- [Enable the App Service managed identity](auth.md#enable-the-app-service-managed-identity)
- [Enable Fabric tenant access](auth.md#enable-fabric-tenant-access)
- [Grant Execute on each UDF](auth.md#grant-execute-on-each-udf)
- [Grant the Eventstream UDF Kusto access](auth.md#grant-the-eventstream-udf-kusto-access)
- [Grant Azure Maps Data Reader](auth.md#grant-azure-maps-data-reader)

## 8 Verify the deployment

1. Open the Web App's default domain and confirm it loads over HTTPS.
2. Open `/api/config` and confirm:
   - `maps.authType` is `aad`.
   - `maps.clientId` matches the Azure Maps Client ID.
   - `sources` contains `carpark`, `pmtiles`, `airports`, and `eventstream`.
3. Open `/api/maps-token` and confirm the request succeeds. Do not copy the returned token.
4. Confirm car parks, airports, Eventstream bicycles, and PMTiles render.
5. In browser developer tools, confirm `/api/pmtiles-archive` byte-range requests return `206 Partial Content`.

## 9 Troubleshooting

| Symptom | Check |
| --- | --- |
| Deployment fails | Open **Deployment Center** → **Logs**, confirm GitHub access, and confirm the repository and `main` branch. |
| The app does not start or `/api/config` returns 404 | Confirm deployment succeeded and remove any custom startup command. |
| A configuration change has no effect | Remove or update the environment variable overriding `config/constants.js`, then restart the Web App. |
| `/api/config` has the wrong Maps Client ID | Check the Azure Maps Client ID, `mapsClientId`, and `AZURE_MAPS_CLIENT_ID`. |
| A UDF returns 401 or 403 | Complete [Fabric tenant access](auth.md#enable-fabric-tenant-access) and [Execute permission](auth.md#grant-execute-on-each-udf). |
| `/api/maps-token` returns 401 or 403 | Complete the [managed identity](auth.md#enable-the-app-service-managed-identity) and [Azure Maps Data Reader](auth.md#grant-azure-maps-data-reader) steps. |
| Eventstream cannot read Kusto data | Complete the [Eventstream UDF Kusto access](auth.md#grant-the-eventstream-udf-kusto-access) step. |
| PMTiles does not render | Confirm the PMTiles endpoint is correct and `/api/pmtiles-archive` returns `206 Partial Content`. |

Continue to [Authorization and identity](auth.md), then return to the [README](../README.md).
