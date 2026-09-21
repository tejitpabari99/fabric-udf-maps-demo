"""Fabric User Data Function for the SampleES bicycle Eventstream."""

from datetime import date, datetime

import fabric.functions as fn
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

udf = fn.UserDataFunctions()

# Edit CLUSTER_URI / DATABASE / TABLE for your Eventhouse. Kusto is NOT a Fabric
# managed connection, so this UDF authenticates with its OWN managed identity —
# that identity must be granted Kusto Database Viewer (see the runbook).
CLUSTER_URI = "https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com"
DATABASE = "BicycleES"
TABLE = "BicycleES"


def _kusto_client(cluster: str) -> KustoClient:
    """Build a KustoClient across azure-kusto-data versions (token-credential, then MI)."""
    try:
        from azure.identity import DefaultAzureCredential

        if hasattr(KustoConnectionStringBuilder, "with_azure_token_credential"):
            cred = DefaultAzureCredential(exclude_interactive_browser_credential=True)
            return KustoClient(
                KustoConnectionStringBuilder.with_azure_token_credential(cluster, cred)
            )
    except Exception:
        pass
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
def get_bikes() -> list[dict]:
    escaped_table = TABLE.replace('"', '""')
    query = (
        f'table("{escaped_table}") '
        "| where isnotnull(Latitude) and isnotnull(Longitude) "
        "| extend __ingestion_time = ingestion_time() "
        "| order by __ingestion_time desc nulls last "
        "| take 100 "
        "| project-away __ingestion_time"
    )
    client = _kusto_client(CLUSTER_URI)
    try:
        table = client.execute(DATABASE, query).primary_results[0]
        columns = [column.column_name for column in table.columns]
        return [
            {name: json_value(row[name]) for name in columns}
            for row in table
        ]
    finally:
        client.close()
