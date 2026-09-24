"use strict";

const { invokeUdf, rowsToPointFeatures } = require("../lib/fabric");

const POINT_COLUMNS = { lat: "Latitude", lon: "Longitude" };

function isRowList(data) {
  return Array.isArray(data) && data.every((row) => row && typeof row === "object" && !Array.isArray(row));
}

module.exports = {
  id: "eventstream",
  label: "Bicycle-eventstream",
  order: 5,
  realtime: true,
  view: { center: [-0.12, 51.5], zoom: 10 },
  async run(cfg) {
    const output = await invokeUdf(cfg.udf.eventstream, {}, cfg.udfResource);
    const data = isRowList(output) ? rowsToPointFeatures(output, POINT_COLUMNS) : output;
    return { format: "geojson", data };
  },
};
