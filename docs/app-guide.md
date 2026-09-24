# Deploy and configure the application

> **Journey:** [README](../README.md) → prerequisite: [UDF setup](setup.md) → **App deployment** → [Authorization](auth.md)

## 1 Before you begin

Complete [Set up the Fabric User Data Functions](setup.md) before starting this guide. You need an Azure subscription, permission to create an Azure Maps account, an App Service plan, and a Web App, plus write access to this GitHub repository or to a customer-controlled fork.

This guide uses only the Azure portal and GitHub web interface. You will create the Maps account and Web App, update non-secret repository configuration, connect App Service to the `main` branch, complete authorization through the linked guide, and verify the hosted application in a browser.

Keep the Azure resources and Fabric workspace in the same Microsoft Entra tenant because the documented production design uses the Web App's system-assigned managed identity.

## 2 Create the Azure Maps account and copy its Client ID

1. In the Azure portal, search for **Azure Maps accounts**, select **Create**, and choose the target subscription and resource group.
2. Enter a unique account name, select a region and an available pricing tier that meet your organization's requirements, then select **Review + create** and **Create**.
3. After deployment finishes, open the Azure Maps account and select **Settings** → **Authentication**.
4. Copy the **Client ID**, which can also be described as the unique account ID. This identifier is not a secret and will become `mapsClientId` in `config/constants.js`.

Production authentication uses Microsoft Entra, the App Service system-assigned managed identity, and **Azure Maps Data Reader** on this Maps account. It never uses an Azure Maps subscription key. See [Manage authentication in Azure Maps](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-manage-authentication).

## 3 Obtain and configure the application source

1. Sign in to GitHub and either fork the repository into a customer-controlled account or organization, or confirm that you have write access to the repository that App Service will deploy.
2. Open `config/constants.js` in GitHub and select the web editor.
3. Replace `mapsClientId` with the Azure Maps Client ID copied in section 2.
4. Replace the four Public URL values `udf.carpark`, `udf.pmtiles`, `udf.airports`, and `udf.eventstream` with the URLs copied while completing [UDF setup](setup.md). Leave the fixed `udf.resource` value unchanged.
5. Review the changes and commit them to the `main` branch through the GitHub web interface, using your organization's normal review process if the branch is protected.

Do not add passwords, tokens, subscription keys, connection strings, or other secrets to `config/constants.js` or any repository file. Azure Maps Client IDs and Fabric UDF Public URLs are non-secret identifiers, but your organization's policy may still require a private fork or another private customer-controlled repository.

## 4 Create a Linux Node Web App

1. In the Azure portal, select **Create a resource**, search for **Web App**, and select **Create**.
2. On **Basics**, choose the subscription and resource group, enter a globally unique Web App name, set **Publish** to **Code**, and set **Operating System** to **Linux**.
3. Choose a current supported Node LTS runtime compatible with the repository's `engines` requirement of Node `>=18`.
4. Choose the region and App Service plan that meet your organization's availability, scale, and cost requirements. Review optional monitoring settings according to organizational policy.
5. Select **Review + create**, verify the selections, select **Create**, and open the Web App after deployment completes.

The application already serves the browser files and API routes, reads `process.env.PORT`, and declares a valid start script in `package.json`. Do not add a custom server scaffold or a custom startup command for the normal deployment path. See [Quickstart: Create a Node.js Web App](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs) and [Configure Node.js apps in App Service](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs).

## 5 Deploy main through App Service Deployment Center with GitHub

1. In the Azure portal, open the Web App and select **Deployment** → **Deployment Center**.
2. On **Settings**, select **GitHub** as the source and authorize Azure App Service to access GitHub if prompted.
3. Select the GitHub organization or account, the customer-controlled repository configured in section 3, and the `main` branch.
4. Use the portal-recommended identity-based authentication selection and build provider for this GitHub deployment. When GitHub Actions is offered as the build provider, keep that selection.
5. Preview the generated workflow when the portal offers a preview, confirm that it targets this Web App and the `main` branch, then select **Save**.
6. Monitor the deployment from **Deployment Center** → **Logs** and, when linked there, the workflow run in the GitHub web interface.

The Deployment Center workflow installs the declared dependencies, builds as required by the platform, and deploys the repository automatically. Do not create a deployment archive or perform a separate dependency installation. See [Configure continuous deployment in App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-continuous-deployment) and [Deploy to App Service by using GitHub Actions](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions).

As an optional recovery path only, a project owner may supply a ready-to-upload release package. If the owner explicitly provides that package, an authorized operator may upload it through the Kudu browser experience by following [ZIP deployment for App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip). The customer must not build or repackage the release.

## 6 Configure only verified App Service settings and precedence

Open the Web App in the Azure portal and select **Settings** → **Environment variables** or **Settings** → **Configuration**, depending on the current portal label. The values committed to `config/constants.js` are sufficient when every deployment uses the same non-secret identifiers; add an App Service setting only when the hosted deployment needs an override.

| App Service setting | When to use it | Verified behavior |
| --- | --- | --- |
| `AZURE_MAPS_CLIENT_ID` | Optional override for `mapsClientId`. | Sets the Azure Maps account Client ID used for Entra authentication. |
| `PORT` | Normally omit because App Service supplies the listening port. | Overrides the application's default listening port; the server reads `process.env.PORT`. |
| `UDF_RESOURCE` | Optional override for the fixed `udf.resource`. | Sets the Fabric UDF token audience. |
| `UDF_CARPARK_ENDPOINT` | Optional override for `udf.carpark`. | Sets the car-parks UDF Public URL. |
| `UDF_PMTILES_ENDPOINT` | Optional override for `udf.pmtiles`. | Sets the PMTiles UDF Public URL. |
| `UDF_AIRPORTS_ENDPOINT` | Optional override for `udf.airports`. | Sets the airports UDF Public URL. |
| `UDF_EVENTSTREAM_ENDPOINT` | Optional override for `udf.eventstream`. | Sets the Eventstream UDF Public URL. |

A non-empty App Service environment value takes precedence over the corresponding value in `config/constants.js`; an absent or empty value leaves the committed constant in effect. A stale override can therefore hide a newer GitHub commit, so remove obsolete overrides and save the configuration before retesting.

`NODE_ENV` is not required by this application. Never add `AZURE_MAPS_KEY` to a production Web App; that setting is supported only as a local-development fallback and is not part of this deployment.

## 7 HTTPS and optional inbound App Service Authentication

In the Web App, open **Settings** → **Configuration** → **General settings**, ensure **HTTPS Only** is enabled, and save if you changed the setting.

The base sample may allow browser visitors to reach the Web App without signing in because the backend managed identity performs the Fabric and Azure Maps authorization. If your organization requires users to sign in before reaching the application, configure the Web App's **Settings** → **Authentication** experience after reviewing [App Service authentication and authorization](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization). Inbound App Service Authentication is optional and does not replace the backend grants in section 8.

## 8 Complete authorization by linking only

Complete all three mandatory authorization surfaces in [Authorization and identity](auth.md). For App Service managed identity background, see [Managed identities in App Service](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).

- **App identity and Fabric invocation:** [Enable the App Service managed identity](auth.md#enable-the-app-service-managed-identity), [enable Fabric tenant access](auth.md#enable-fabric-tenant-access), and [grant Execute on each UDF](auth.md#grant-execute-on-each-udf).
- **Eventstream UDF runtime Kusto access:** [Grant the Eventstream UDF Kusto access](auth.md#grant-the-eventstream-udf-kusto-access).
- **Azure Maps role:** [Grant Azure Maps Data Reader](auth.md#grant-azure-maps-data-reader).

Do not substitute source-data roles for these grants. The App Service identity invokes the four UDFs and requests Maps tokens, while Fabric-managed connections and the Eventstream UDF runtime identity retain responsibility for source access.

## 9 Verify deployment in browser and developer tools

1. From the Web App **Overview** page, select the **Default domain** link and confirm that the application loads over HTTPS.
2. Append `/api/config` to the default domain in the browser address bar and confirm an HTTP `200` response.
3. Inspect the JSON and confirm that `maps.authType` is `aad`, `maps.clientId` matches the Azure Maps account Client ID, no Maps key is present, and `sources` contains exactly four entries: `carpark`, `pmtiles`, `airports`, and `eventstream`.
4. Confirm that each source presents one UDF-backed behavior, that no method selector is present, and that the response exposes no Fabric token or source credential.
5. Open `/api/maps-token` in the browser and confirm that the request succeeds. Treat the returned short-lived token as sensitive and do not copy it into documentation or configuration.
6. Return to the application and verify that car parks, airports, Eventstream bicycles, and PMTiles all render on the map.
7. Select or refresh the Eventstream source and confirm that its refresh behavior retrieves current map data without requiring a page reload.
8. Open browser developer tools, select **Network**, filter for `/api/pmtiles-archive`, reload or select the PMTiles source, and confirm that byte-range requests return HTTP `206 Partial Content`.

## 10 Portal-focused troubleshooting

| Symptom | Portal or web page to inspect | Correction |
| --- | --- | --- |
| Deployment Center cannot access GitHub | Web App → **Deployment Center** → **Settings** | Reauthorize GitHub, confirm access to the intended organization and repository, then save the source configuration again. |
| The generated workflow fails | Web App → **Deployment Center** → **Logs**, then the linked GitHub workflow run | Open the failed step, correct repository access or workflow settings through the portal and GitHub web interfaces, and rerun the workflow from GitHub. |
| The wrong code is deployed | Web App → **Deployment Center** → **Settings** | Confirm the selected repository and branch are the customer-controlled repository and `main`, save, and start a new deployment from the portal. |
| The Web App does not start or `/api/config` returns 404 | Web App → **Monitoring** → **Log stream**, **Deployment Center** → **Logs**, and **Settings** → **Configuration** → **General settings** | Confirm that deployment completed, the repository root was deployed, and no obsolete custom startup value is configured; the normal deployment uses the start script declared in `package.json`. |
| A committed configuration change has no effect | Web App → **Settings** → **Environment variables** or **Configuration** | Find and remove or update the non-empty App Service override that takes precedence over `config/constants.js`, save, and restart the Web App from **Overview**. |
| One UDF URL is empty, malformed, or points to the wrong item | GitHub → `config/constants.js`, then Web App → **Settings** → **Environment variables** or **Configuration** | Correct the matching `udf.*` Public URL in GitHub or its `UDF_*_ENDPOINT` override, ensure no stale override masks the intended value, and redeploy. |
| Eventstream uses the wrong Eventhouse database or table | Fabric portal → Eventstream UDF item → **Develop** | Correct `DATABASE` and `TABLE` in the UDF code, publish the UDF again, and verify it in **Run only** before retesting the Web App. |
| `/api/config` has a wrong or empty Maps Client ID | Azure Maps account → **Settings** → **Authentication**, GitHub → `config/constants.js`, and Web App → **Settings** → **Environment variables** or **Configuration** | Copy the correct Client ID, update `mapsClientId` or `AZURE_MAPS_CLIENT_ID`, remove stale overrides, save, and redeploy or restart as appropriate. |
| `/api/maps-token` returns 401 or 403, or the map reports a Maps authorization error | Web App → **Settings** → **Identity** and Azure Maps account → **Access control (IAM)** → **Role assignments** | Complete [the managed identity setup](auth.md#enable-the-app-service-managed-identity) and [the Azure Maps role assignment](auth.md#grant-azure-maps-data-reader), then allow time for role propagation. |
| A hosted UDF request returns 401 or 403 before the function runs | Fabric portal → **Admin portal** → **Tenant settings** and each UDF item → **Share** | Complete [Fabric tenant access](auth.md#enable-fabric-tenant-access) and [Execute on each UDF](auth.md#grant-execute-on-each-udf), then retest the failing source. |
| Eventstream reports that its runtime principal cannot read Kusto data | Fabric portal → Eventstream UDF **Run only** and the target Eventhouse/KQL database | Complete [the Eventstream UDF Kusto grant](auth.md#grant-the-eventstream-udf-kusto-access) for the exact runtime principal and database. |
| PMTiles does not render or archive requests do not return 206 | Browser developer tools → **Network**, Web App → **Monitoring** → **Log stream**, and Fabric portal → PMTiles UDF **Run only** | Confirm that `/api/pmtiles-archive` is requested with a Range header, verify that the PMTiles UDF URL is correct and returns a non-empty archive result, then inspect server errors in Log stream. |

## 11 Next step

Continue to [Authorization and identity](auth.md) to finish any outstanding grants, then return to the [README](../README.md) and complete its verification checklist.
