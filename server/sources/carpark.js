"use strict";

// Source: Car_Parks.geojson (Lakehouse file). 13 MultiPolygon car-park footprints.
//   - Function: the published UDF get_car_parks reads the file inside Fabric.
//   - Direct:   the proxy reads the file straight from OneLake.

const { readOneLakeFile, invokeUdf } = require("../lib/fabric");

const FILE_PATH = "Files/GeoJson/Car_Parks.geojson";

module.exports = {
  id: "carpark",
  label: "Car_Parks.geojson",
  order: 1,
  realtime: false,
  view: { center: [-1.08, 53.96], zoom: 12 },
  methods: {
    function: {
      label: "Function (UDF)",
      async run(cfg) {
        const data = await invokeUdf(cfg.udf.carpark, {}, cfg.udfResource);
        return { format: "geojson", data };
      },
    },
    direct: {
      label: "Direct (OneLake file)",
      async run(cfg) {
        const text = await readOneLakeFile(cfg, FILE_PATH);
        return { format: "geojson", data: JSON.parse(text) };
      },
    },
  },
};
