"use strict";

const { invokeUdf, rowsToPointFeatures } = require("../lib/fabric");
const { sqlQuery } = require("../lib/sql");

const POINT_COLUMNS = { lat: "_c6", lon: "_c7" };
const QUERY = "SELECT TOP 100 * FROM dbo.airports";

function isRowList(data) {
  return Array.isArray(data) &&
    data.every((row) => row && typeof row === "object" && !Array.isArray(row));
}

module.exports = {
  id: "airports",
  label: "airports-lakehouse",
  order: 3,
  realtime: false,
  view: { center: [15, 20], zoom: 1.5 },
  methods: {
    function: {
      label: "Function (UDF)",
      async run(cfg) {
        const output = await invokeUdf(cfg.udf.airports, {}, cfg.udfResource);
        const data = isRowList(output)
          ? rowsToPointFeatures(output, POINT_COLUMNS)
          : output;
        return { format: "geojson", data };
      },
    },
    direct: {
      label: "Direct (SQL endpoint)",
      async run(cfg) {
        const rows = await sqlQuery(cfg, QUERY);
        return {
          format: "geojson",
          data: rowsToPointFeatures(rows, POINT_COLUMNS),
        };
      },
    },
  },
};
