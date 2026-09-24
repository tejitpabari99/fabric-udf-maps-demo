"use strict";

const { invokeUdf } = require("../lib/fabric");

module.exports = {
  id: "carpark",
  label: "Car_Parks.geojson",
  order: 1,
  realtime: false,
  view: { center: [-1.08, 53.96], zoom: 12 },
  async run(cfg) {
    const data = await invokeUdf(cfg.udf.carpark, {}, cfg.udfResource);
    return { format: "geojson", data };
  },
};
