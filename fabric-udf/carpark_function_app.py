"""Fabric User Data Function for the Lakehouse Car_Parks.geojson file."""

import json

import fabric.functions as fn

udf = fn.UserDataFunctions()

FILE_PATH = "GeoJson/Car_Parks.geojson"


@udf.connection(argName="lakehouse", alias="carparkslh")
@udf.function()
def get_car_parks(lakehouse: fn.FabricLakehouseClient) -> dict:
    connection = lakehouse.connectToFiles()
    file_client = connection.get_file_client(FILE_PATH)
    try:
        content = file_client.download_file().readall().decode("utf-8")
    finally:
        file_client.close()
        connection.close()
    return json.loads(content)
