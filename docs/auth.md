# Authorization and identity

> **Journey:** [README](../README.md) → prerequisites: [Data setup](data_setup.md) + [UDF guide](udf-guide.md) → [UDF setup](setup.md) → [App deployment](app-guide.md) → **Authorization**
>
> **Guide ownership:** This file is the single source of truth for identities, tenant settings, permissions, roles, scopes, token audiences, grant procedures, and authorization troubleshooting. Use the related setup guides for resource creation, then return to the [README](../README.md) for the completed solution overview.

## Identity and authorization model

This solution has four identity surfaces, and each surface has a separate job. Keeping those jobs separate prevents the hosted application from receiving source-data permissions that it does not need.

| Identity or surface | Purpose | Authorization boundary |
|---|---|---|
| Signed-in human administrator or author | Creates and configures Fabric items, managed connections, the Web App identity, tenant settings, Kusto database roles, and Azure role assignments according to the person's assigned administrative capabilities. | Human access is limited to the Fabric workspace and items, Web App, Eventhouse database, and Azure Maps account needed for this solution. |
| Fabric-managed Lakehouse connections | The `carparkslh`, `gpstracelh`, and `airportslh` connections let the car-park, PMTiles, and airports UDFs read their selected Lakehouse data. | Fabric brokers access from each UDF connection based on the connection owner and selected Lakehouse permissions; the App Service identity receives no Lakehouse, OneLake, or SQL data role. |
| Eventstream UDF runtime managed identity | The runtime identity for `get_bikes` reads bicycle events from the selected Eventhouse/KQL database. | It receives Kusto Database Viewer only on the exact database used by the UDF. |
| App Service system-assigned managed identity | Invokes the four published UDFs and requests short-lived Azure Maps tokens for the hosted application. | Its Fabric job is only UDF invocation with audience `https://analysis.windows.net/powerbi/api`; its Maps job uses audience `https://atlas.microsoft.com/` and Azure Maps Data Reader on one Maps account. |

The base design requires the App Service and Fabric workspace to belong to the same Microsoft Entra tenant. Cross-tenant hosting and secret-based application identities are outside this guide. For background, see [Managed identities for Azure resources](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview).

## Authoritative role, scope, audience, grantor, and verification matrix

| Identity | Action | Exact role or permission | Scope or location | Token audience | Granted by | Verification |
|---|---|---|---|---|---|---|
| Signed-in UDF owner or author | Create, edit, test, publish, and share each UDF; create its managed Lakehouse connection where applicable. | A workspace role that permits item creation; Write on each UDF item; Read or higher on each selected Lakehouse. | Target Fabric workspace, each of the four UDF items, and the selected Lakehouse. | Not applicable to the portal authoring action. | Fabric workspace administrator, item owner, or Lakehouse owner as applicable. | The author can open Develop mode, use Manage connections, publish, switch to Run only, and open Share for each UDF. |
| Fabric-managed Lakehouse connections | Read the two Lakehouse files and the airports SQL table for their owning UDFs. | Fabric-managed connection authorized by an author with Write on the UDF item and Read or higher on the selected Lakehouse. | `carparkslh`, `gpstracelh`, or `airportslh` on its UDF item and the selected Lakehouse. | Managed by Fabric; no audience is configured in the Web App. | UDF author or connection owner with the required UDF and Lakehouse permissions. | `get_car_parks`, `get_gpstrace_pmtiles`, and `get_airports` succeed in Run only mode. |
| Eventstream UDF runtime managed identity | Read bicycle rows used by `get_bikes`. | Kusto Database Viewer, represented by the Kusto database role `viewers`. | Exact Eventhouse/KQL database named in `eventstream_function_app.py`. | Managed by the UDF runtime for Kusto access; no audience is configured in the Web App. | Eventhouse Database Admin. | `get_bikes` succeeds in Run only mode after the database role grant. |
| App Service system-assigned managed identity | Be eligible to call Fabric public APIs. | Inclusion in the enabled **Service principals can call Fabric public APIs** tenant-setting scope, either organization-wide or through an allowed security group. | Fabric tenant setting. | `https://analysis.windows.net/powerbi/api` | Fabric administrator. | The tenant setting is enabled and its scope includes the identity or its security group. |
| App Service system-assigned managed identity | Invoke `get_car_parks`, `get_gpstrace_pmtiles`, `get_airports`, and `get_bikes`. | **Execute** only on each UDF item; do not grant Edit or Share. | Each of the four published UDF items. | `https://analysis.windows.net/powerbi/api` | UDF item owner or another authorized Fabric item sharer. | Each Share dialog lists the Web App identity with Execute, and hosted calls reach the corresponding function. |
| App Service system-assigned managed identity | Request Azure Maps tokens and use Azure Maps rendering services. | **Azure Maps Data Reader**. | The individual Azure Maps account used by this application. | `https://atlas.microsoft.com/` | Role Based Access Control Administrator or User Access Administrator at the Maps account scope or an inherited parent scope. | The Maps account IAM role assignments list the Web App identity, `/api/maps-token` succeeds, and the map loads. |

## Required administrator capabilities

Complete each procedure while signed in as a person who has the applicable capability. One person may hold several capabilities, or separate administrators may complete their assigned sections.

| Capability | Why it is required | Required scope |
|---|---|---|
| Fabric administrator | Enables and scopes the Fabric tenant setting that permits application identities to call Fabric public APIs. | Fabric tenant. |
| Fabric workspace author and UDF item owner | Creates and publishes UDFs, manages connections, and grants item-level Execute. The author needs Write on each UDF item and Read or higher on each selected Lakehouse; the workspace role must also permit creation of the required items. | Target Fabric workspace, four UDF items, and selected Lakehouse. |
| Eventhouse Database Admin | Adds the Eventstream UDF runtime principal to the Kusto `viewers` database role. | Exact Eventhouse/KQL database used by `get_bikes`. |
| Website Contributor or equivalent | Enables the App Service system-assigned managed identity and reads its identifiers. | Exact Web App. |
| Role Based Access Control Administrator or User Access Administrator | Assigns Azure Maps Data Reader to the Web App identity. | Exact Azure Maps account, or an inherited parent scope that permits role assignment while the grant itself remains scoped to the Maps account. |

## Enable the App Service managed identity

The production Web App uses a system-assigned managed identity, so Azure creates and manages the service principal lifecycle with the Web App. See [Managed identities in App Service](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity) and [Managed identities for Azure resources](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview).

1. In the Azure portal, open the Web App created for this solution.
2. In the Web App menu, select **Settings** → **Identity**.
3. On the **System assigned** tab, set **Status** to **On**, then select **Save** and accept the ordinary confirmation.
4. After Azure creates the identity, record the displayed **Object (principal) ID** and **Tenant ID** with the deployment records. These values identify the service principal and tenant; they are identifiers, not secrets.
5. If a Fabric identity picker or another portal asks for the application/client ID, open Azure portal → **Microsoft Entra ID** → **Enterprise applications** → **All applications**, find the enterprise application by the Web App name or recorded Object ID, open **Properties**, and record its **Application ID**.

Confirm that the Web App tenant ID matches the Microsoft Entra tenant that contains the Fabric workspace. The documented managed-identity invocation path is same-tenant only.

## Enable Fabric tenant access

The App Service identity must be included in the Fabric tenant policy that permits application identities to call Fabric public APIs. A Fabric administrator performs this procedure. See the [Fabric tenant settings index](https://learn.microsoft.com/en-us/fabric/admin/tenant-settings-index) and [Fabric developer admin settings](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-developer).

1. In the Fabric portal, select the gear icon in the upper-right corner, then select **Admin portal**.
2. Select **Tenant settings**.
3. Search for **Service principals can call Fabric public APIs**. The label can vary slightly by tenant or date, so search for this phrase and select the current setting that controls whether service principals can call Fabric public APIs.
4. Set the tenant setting to **Enabled**.
5. Choose either the entire organization or, preferably, a specific security group that contains the App Service managed identity.
6. Select **Apply**.

If the tenant setting is scoped to a security group, open Azure portal → **Microsoft Entra ID** → **Groups** → select the target security group → **Members** → **Add members**, find the App Service managed identity by its Web App name or recorded Object ID, add it, and then return to Fabric to confirm that the selected group is included in the tenant-setting scope. Allow time for tenant and group membership changes to propagate before testing.

## Grant Execute on each UDF

Grant the Web App identity item-level **Execute** on every published UDF. Do not grant Edit or Share, and do not use a broad workspace role as a substitute when item-level Execute is available. The Fabric token audience for every invocation is `https://analysis.windows.net/powerbi/api`. See [Using the Fabric UDF portal editor](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-portal-editor) for the UDF permission model.

Repeat this procedure for each of the four UDF items:

1. In the Fabric portal, open the workspace that contains the UDFs.
2. Open the UDF item.
3. Select **Share**.
4. Search for and add the Web App managed identity, using the Web App name or recorded Object ID to distinguish it from similarly named identities.
5. Select **Execute** only. Ensure Edit and Share are not selected.
6. Confirm the share.

| UDF purpose | Published function | Required Web App permission |
|---|---|---|
| Car parks | `get_car_parks` | Execute only on the car-parks UDF item. |
| PMTiles archive | `get_gpstrace_pmtiles` | Execute only on the PMTiles UDF item. |
| Airports | `get_airports` | Execute only on the airports UDF item. |
| Eventstream bicycles | `get_bikes` | Execute only on the Eventstream UDF item. |

Verify each Share dialog after saving. A hosted 401 or 403 that occurs before the function executes usually means the Fabric tenant setting, identity selection, or item-level Execute grant is incomplete.

## Explain the three managed Lakehouse connections

The three Lakehouse-backed UDFs use Fabric-managed connections configured through each UDF item's **Manage connections** experience. Fabric brokers source access based on the connection and its owner; the Web App invokes the published function but does not read Lakehouse data itself. See [Connect Fabric UDFs to data sources](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/connect-to-data-sources).

| Connection alias | UDF | Source access |
|---|---|---|
| `carparkslh` | `get_car_parks` | Reads the car-park GeoJSON file through the selected Lakehouse connection. |
| `gpstracelh` | `get_gpstrace_pmtiles` | Reads the PMTiles archive through the selected Lakehouse connection. |
| `airportslh` | `get_airports` | Reads `dbo.airports` through the selected Lakehouse SQL connection. |

The signed-in author who creates or updates a managed connection needs Write on the UDF item and Read or higher on the selected Lakehouse. The configured alias must exactly match the alias used by the UDF code.

Do not grant the App Service identity a Lakehouse workspace role, OneLake file role, or SQL table permission for this solution. If a Lakehouse-backed function fails in Fabric Run only mode, the UDF owner should inspect its alias, selected Lakehouse, connection owner, and Lakehouse permission rather than adding source access to the Web App.

## Grant the Eventstream UDF Kusto access

The Eventstream UDF does not use a Fabric-managed Lakehouse connection. Its own runtime managed identity must receive Kusto Database Viewer on the exact Eventhouse/KQL database queried by `get_bikes`. An Eventhouse Database Admin performs the grant. See [Manage Kusto database security roles](https://learn.microsoft.com/en-us/kusto/management/manage-database-security-roles?view=microsoft-fabric).

1. In the Fabric portal, open the Eventstream UDF item, publish the current code, and switch to **Run only**.
2. Invoke `get_bikes`. Before authorization is configured, the expected failure identifies the rejected runtime principal.
3. Copy the complete principal from the error in the form `aadapp=<clientId>;<tenantId>`. Preserve both identifiers and verify that this is the UDF runtime principal, not the Web App identity.
4. Open the exact Eventhouse/KQL database used by the UDF, or open a KQL queryset connected to that database, and open the Fabric portal query editor.
5. Replace `<db>` with the exact database name and replace the principal placeholders with the complete values copied from the failure, then enter and run the following KQL database management command in the Fabric portal query editor:

```text
.add database <db> viewers ('aadapp=<clientId>;<tenantId>') 'Allow the Fabric UDF to read this database'
```

This statement is a KQL database management command entered in the Fabric portal, not a shell command. It grants the Kusto `viewers` role, also called Database Viewer, only on the named database.

6. Return to the UDF item and invoke `get_bikes` again. Authorization is complete when the function succeeds and returns bicycle rows containing usable `Latitude` and `Longitude` values.

Never grant this Kusto database role to the App Service identity. The Web App invokes `get_bikes`; it does not query Eventhouse.

## Grant Azure Maps Data Reader

The App Service identity requests Azure Maps tokens with audience `https://atlas.microsoft.com/` and needs **Azure Maps Data Reader** on the individual Maps account used by the application. A Role Based Access Control Administrator or User Access Administrator performs this assignment. See [Assign Azure roles using the Azure portal](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal), [Manage authentication in Azure Maps](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-manage-authentication), and [Secure a non-interactive web application with Azure Maps](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-secure-spa-app).

1. In the Azure portal, open the Azure Maps account used by this application.
2. Select **Access control (IAM)**.
3. Select **Add** → **Add role assignment**.
4. Select **Azure Maps Data Reader**, then select **Next**.
5. For the member type, select **Managed identity**, then select **Select members**.
6. Choose the subscription, select the system-assigned managed identity category for **App Service**, select the Web App, and confirm the member selection.
7. Select **Review + assign**, review the scope and member, then select **Review + assign** again to create the assignment.

Verify the assignment from the Maps account's **Access control (IAM)** → **Role assignments** page. The assignment must name the Web App identity, use Azure Maps Data Reader, and remain scoped to this Maps account.

## Local-development authentication boundary

Production uses the App Service system-assigned managed identity for both UDF invocation and Azure Maps token acquisition. The subscription-key fallback is local-development-only and must not be configured as the hosted application's Maps authentication path.

An Azure Maps subscription key may be used only for local development if the current application still supports that fallback. Do not place a key value in this guide, committed configuration, browser-visible configuration, or production App Service settings. Secret creation, secret-based UDF invocation, and cross-tenant application registration are outside this customer path. Follow [Azure Maps authentication guidance](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-manage-authentication) when evaluating local-only authentication.

## Verify authorization

Complete this checklist after all administrators finish their assigned procedures:

- [ ] Web App → **Settings** → **Identity** shows the system-assigned identity as **On**, and the recorded Object ID and Tenant ID belong to the expected same tenant as Fabric.
- [ ] Fabric → gear icon → **Admin portal** → **Tenant settings** shows the application-access setting enabled, and its organization or security-group scope includes the Web App identity.
- [ ] Each of the four UDF Share dialogs lists the Web App identity with **Execute** only.
- [ ] `get_car_parks`, `get_gpstrace_pmtiles`, and `get_airports` succeed in Fabric Run only mode through `carparkslh`, `gpstracelh`, and `airportslh`.
- [ ] `get_bikes` succeeds in Fabric Run only mode after its runtime principal receives Kusto Database Viewer on the exact Eventhouse/KQL database.
- [ ] Azure Maps account → **Access control (IAM)** → **Role assignments** lists the Web App identity as Azure Maps Data Reader at the Maps account scope.
- [ ] In the hosted application, `/api/maps-token` succeeds and the map authenticates without using the local-development-only subscription-key fallback.
- [ ] The hosted car-park call through `/api/data?source=carpark`, airports call through `/api/data?source=airports`, Eventstream call through `/api/data?source=eventstream`, and PMTiles call through `/api/pmtiles-archive` all succeed.

| Symptom | Most likely authorization owner | What that owner should verify |
|---|---|---|
| The Web App Identity page is off or has no Object ID. | Website Contributor or equivalent for the Web App. | Enable the system-assigned identity and record its Object ID and Tenant ID. |
| A hosted UDF request returns 401 or 403 before the function executes. | Fabric administrator and UDF item owner. | Confirm the tenant setting includes the identity or its group, then confirm Execute on the specific UDF item. |
| One of the three Lakehouse UDFs fails in Fabric Run only mode. | UDF owner or managed-connection owner. | Confirm the exact alias, selected Lakehouse, connection ownership, UDF Write permission, and Lakehouse Read or higher. |
| `get_bikes` reports that an `aadapp=<clientId>;<tenantId>` principal is unauthorized. | Eventhouse Database Admin. | Grant that complete UDF runtime principal Kusto Database Viewer on the exact database and re-run the UDF. |
| `/api/maps-token` returns 401 or 403, or the map reports an Azure Maps authorization failure. | Azure Role Based Access Control Administrator or User Access Administrator. | Confirm Azure Maps Data Reader for the Web App identity at the individual Maps account scope and allow role propagation time. |
| `/api/config` succeeds but only one hosted source fails with 401 or 403. | UDF item owner for the failing source. | Confirm Execute on that specific UDF item and verify that the configured Public URL belongs to the intended item. |

## Least privilege and safety

The Node BFF exposes only the fixed application routes `/api/config`, `/api/data?source=<id>`, `/api/maps-token`, and `/api/pmtiles-archive`; it limits requests to the four known UDF-backed sources and does not offer arbitrary Fabric paths, source queries, or UDF URLs.

The browser receives map payloads and a short-lived Azure Maps token, but it never receives a Fabric invocation token, Lakehouse credential, Eventhouse credential, managed-connection credential, or the local-development-only Azure Maps key fallback.

The App Service identity receives only Execute on each UDF item and Azure Maps Data Reader on the individual Maps account. It receives no Lakehouse workspace role, OneLake role, SQL grant, or Kusto database role.

Source data access remains inside Fabric: managed Lakehouse connections serve the three Lakehouse UDFs, and the Eventstream UDF runtime identity has Database Viewer only on its exact Eventhouse/KQL database.

Prefer item-level and resource-level grants, prefer a scoped security group for the Fabric tenant setting, review role assignments periodically, and remove access when the Web App or UDF items are retired. Managed identities avoid stored application secrets, but their permissions still require the same least-privilege review as any other service principal.
