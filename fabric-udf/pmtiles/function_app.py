"""Fabric User Data Function for the GpsTrace PMTiles archive."""

import base64

import fabric.functions as fn

udf = fn.UserDataFunctions()

FILE_PATH = "GeoJson/GpsTrace.pmtiles"


@udf.connection(argName="lakehouse", alias="gpstracelh")
@udf.function()
def get_gpstrace_pmtiles(lakehouse: fn.FabricLakehouseClient) -> str:
    connection = lakehouse.connectToFiles()
    file_client = connection.get_file_client(FILE_PATH)
    try:
        content = file_client.download_file().readall()
    finally:
        file_client.close()
        connection.close()
    return base64.b64encode(content).decode("ascii")
