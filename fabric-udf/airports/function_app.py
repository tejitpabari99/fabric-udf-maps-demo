"""Fabric User Data Function for the Lakehouse dbo.airports table."""

from datetime import date, datetime

import fabric.functions as fn

udf = fn.UserDataFunctions()


def json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


@udf.connection(argName="lakehouse", alias="airportslh")
@udf.function()
def get_airports(lakehouse: fn.FabricLakehouseClient) -> list[dict]:
    connection = lakehouse.connectToSql()
    cursor = connection.cursor()
    try:
        cursor.execute("SELECT TOP 100 * FROM dbo.airports")
        columns = [column[0] for column in cursor.description]
        return [
            {name: json_value(value) for name, value in zip(columns, row)}
            for row in cursor.fetchall()
        ]
    finally:
        cursor.close()
        connection.close()
