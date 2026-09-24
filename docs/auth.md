# Authorization and identity

> **Journey:** [README](../README.md) → prerequisites: [Data setup](data_setup.md) + [UDF guide](udf-guide.md) → [UDF setup](setup.md) → [App deployment](app-guide.md) → **Authorization**

Configure each identity with only the permissions below, then verify every grant. Return to the [README](../README.md) after completing these steps.

| Identity | Role/permission | Where | Grantor |
|---|---|---|---|
| App Service system-assigned managed identity | **Execute** on the four UDF items (audience `https://analysis.windows.net/powerbi/api`) and **Azure Maps Data Reader** (audience `https://atlas.microsoft.com/`) | Four UDF items and the Azure Maps account | UDF item owner; Role Based Access Control Administrator or User Access Administrator |
| `carparkslh`, `gpstracelh`, and `airportslh` managed connections | Read the configured Lakehouse data | Each UDF item's managed connection | UDF author or connection owner with access to the selected Lakehouse |
| Eventstream UDF runtime identity | **Kusto Database Viewer** | Eventhouse/KQL database used by `get_bikes` | Eventhouse Database Admin |

The App Service identity gets only UDF Execute and Azure Maps Data Reader. Do not grant it Lakehouse, OneLake, SQL, or Kusto data roles.

## Enable the App Service managed identity

1. In the Azure portal, open the Web App.
2. Select **Settings** → **Identity** → **System assigned**.
3. Set **Status** to **On**, then select **Save**.
4. Record the **Object (principal) ID** and **Tenant ID**.

For reference, see [Managed identities in App Service](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).

## Enable Fabric tenant access

1. In the Fabric portal, select the gear icon → **Admin portal** → **Tenant settings**.
2. Search for **Service principals can call Fabric public APIs**.
3. Enable the setting for the organization or for a security group containing the App Service managed identity.
4. Select **Apply**.

The setting label may vary. Requires: Fabric admin.

For reference, see [Fabric tenant settings](https://learn.microsoft.com/en-us/fabric/admin/tenant-settings-index).

## Grant Execute on each UDF

Repeat these steps for the UDF items that publish `get_car_parks`, `get_gpstrace_pmtiles`, `get_airports`, and `get_bikes`:

1. Open the UDF item in the Fabric portal.
2. Select **Share**.
3. Add the Web App managed identity.
4. Grant **Execute** only.

## Grant the Eventstream UDF Kusto access

1. Invoke `get_bikes` once.
2. Copy the principal `aadapp=<clientId>;<tenantId>` from the authorization error.
3. Open the Eventhouse/KQL query editor for the database used by `get_bikes`.
4. Run this KQL management command:

```kusto
.add database <db> viewers ('aadapp=<clientId>;<tenantId>') 'Allow the Fabric UDF to read this database'
```

Enter the command in the Fabric portal. Requires: Database Admin. Do not grant this role to the Web App identity.

For reference, see [Kusto database security roles](https://learn.microsoft.com/en-us/kusto/management/manage-database-security-roles?view=microsoft-fabric).

## Grant Azure Maps Data Reader

1. In the Azure portal, open the Azure Maps account.
2. Select **Access control (IAM)** → **Add role assignment**.
3. Select **Azure Maps Data Reader**.
4. Select **Managed identity**, then select the Web App.
5. Select **Review + assign**.

Requires: Role Based Access Control Administrator or User Access Administrator.

For reference, see [Azure Maps authentication](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-manage-authentication) and [Azure role assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal).

## Verify authorization

- [ ] The Web App system-assigned managed identity is **On**, and you recorded its Object ID and Tenant ID.
- [ ] The Fabric tenant setting includes the App Service managed identity or its security group.
- [ ] Each of the four UDF items grants the App Service managed identity **Execute** only.
- [ ] The three managed Lakehouse connections can read their configured data without granting data access to the App Service identity.
- [ ] The Eventstream UDF runtime identity has **Kusto Database Viewer** on the database used by `get_bikes`.
- [ ] The Azure Maps account grants the App Service managed identity **Azure Maps Data Reader**.
