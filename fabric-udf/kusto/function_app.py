"""Fabric User Data Function for Weather rows in a Fabric Eventhouse."""

from datetime import date, datetime

import fabric.functions as fn
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

udf = fn.UserDataFunctions()

CLUSTER_URI = "https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com"
DATABASE = "TejitEH"
QUERY = (
    "Weather | where isnotnull(BeginLat) and BeginLat != 0 and isnotnull(BeginLon) and BeginLon != 0 "
    "| take 100 "
    "| project BeginLat, BeginLon, State, EventType, StartTime"
)


def _kusto_client(cluster: str) -> KustoClient:
    """Build a KustoClient using whatever auth the UDF runtime supports.

    Kusto/Eventhouse is not a supported UDF *managed connection*, so we
    authenticate outbound using the runtime's ambient identity. Different
    azure-kusto-data versions expose different builders, so try them in order.
    """
    # 1) Modern token-credential path (azure.identity).
    try:
        from azure.identity import DefaultAzureCredential

        if hasattr(KustoConnectionStringBuilder, "with_azure_token_credential"):
            cred = DefaultAzureCredential(exclude_interactive_browser_credential=True)
            return KustoClient(
                KustoConnectionStringBuilder.with_azure_token_credential(cluster, cred)
            )
    except Exception:
        pass
    # 2) Managed-identity builder name variants across versions.
    for name in (
        "with_aad_managed_identity_authentication",
        "with_aad_managed_service_identity_authentication",
    ):
        builder = getattr(KustoConnectionStringBuilder, name, None)
        if builder:
            try:
                return KustoClient(builder(cluster))
            except Exception:
                continue
    raise RuntimeError("No usable Kusto authentication method in the UDF runtime.")


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


@udf.function()
def get_weather() -> list[dict]:
    client = _kusto_client(CLUSTER_URI)
    try:
        table = client.execute(DATABASE, QUERY).primary_results[0]
        columns = [column.column_name for column in table.columns]
        return [
            {name: json_value(row[name]) for name in columns}
            for row in table
        ]
    finally:
        client.close()
