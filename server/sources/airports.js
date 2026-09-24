"use strict";

const { invokeUdf, rowsToPointFeatures } = require("../lib/fabric");

const POINT_COLUMNS = { lat: "_c6", lon: "_c7" };

function isRowList(data) {
  return Array.isArray(data) && data.every((row) => row && typeof row === "object" && !Array.isArray(row));
}

module.exports = {
  id: "airports",
  label: "airports-lakehouse",
  order: 3,
  realtime: false,
  view: { center: [15, 20], zoom: 1.5 },
  async run(cfg) {
    const output = await invokeUdf(cfg.udf.airports, {}, cfg.udfResource);
    const data = isRowList(output) ? rowsToPointFeatures(output, POINT_COLUMNS) : output;
    return { format: "geojson", data };
  },
};
