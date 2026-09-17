"""
Fabric User Data Function (UDF) — Car Parks GeoJSON API wrapper.

This is the "API wrapper" pattern: the web app calls this function, and the
function pulls the GeoJSON file out of the Lakehouse and returns it. All data
access is server-side inside Fabric, so the function is the single, controlled
point of exposure for the data.

Data source: Lakehouse Files (OneLake) — the file lives at
    Files/GeoJson/Car_Parks.geojson

Prerequisites (see fabric-udf/README.md for full steps):
  1. A User Data Functions item in the workspace.
  2. A Lakehouse connection added via "Manage connections" whose alias you paste
     into the @udf.connection decorator below (replace CARPARKS_LH_ALIAS).

Programming model reference:
  https://learn.microsoft.com/fabric/data-engineering/user-data-functions/python-programming-model
  https://learn.microsoft.com/fabric/data-engineering/user-data-functions/connect-to-data-sources
"""

import json

import fabric.functions as fn

udf = fn.UserDataFunctions()

# Path of the GeoJSON file relative to the Lakehouse "Files" root.
DEFAULT_FILE_PATH = "GeoJson/Car_Parks.geojson"


@udf.connection(argName="lakehouse", alias="carparkslh")
@udf.function()
def get_car_parks(lakehouse: fn.FabricLakehouseClient) -> dict:
    """Read the entire GeoJSON file from the Lakehouse and return it as an object.

    Args:
        lakehouse: Injected Lakehouse connection (bound via the alias above).

    Returns:
        The parsed GeoJSON FeatureCollection as a dict (serialized to JSON in the
        invocation envelope's ``output`` property).
    """
    # Connect to the Lakehouse "Files" area (OneLake) and download the file.
    connection = lakehouse.connectToFiles()
    file_client = connection.get_file_client(DEFAULT_FILE_PATH)
    try:
        downloaded = file_client.download_file()
        content = downloaded.readall().decode("utf-8")
    finally:
        file_client.close()
        connection.close()

    # Return the parsed object so callers get application/json directly.
    return json.loads(content)


@udf.function()
def ping() -> str:
    """Health check — verify the function app is reachable without touching data."""
    return "ok"
