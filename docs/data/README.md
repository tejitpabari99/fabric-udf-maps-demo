# Sample data

These are the sample files used by the demo. Upload them to the Lakehouse `Files/` root as described in [the data setup guide](../data_setup.md).

| File | Uploaded to | Used by |
|---|---|---|
| `Car_Parks.geojson` | `Files/Car_Parks.geojson` | `get_car_parks` |
| `GpsTrace.pmtiles` | `Files/GpsTrace.pmtiles` | `get_gpstrace_pmtiles` |
| `airports.csv` | Load to table `dbo.airports` | `get_airports` |

The bicycles data is the built-in Fabric Eventstream **Bicycles** sample, so no file is committed for it.
