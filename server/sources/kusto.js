"use strict";

const { invokeUdf, kustoQuery, rowsToPointFeatures } = require("../lib/fabric");

const POINT_COLUMNS = { lat: "BeginLat", lon: "BeginLon" };
const QUERY = "Weather | where isnotnull(BeginLat) and BeginLat != 0 and isnotnull(BeginLon) and BeginLon != 0 | take 100";

function isRowList(data) {
  return Array.isArray(data) &&
    data.every((row) => row && typeof row === "object" && !Array.isArray(row));
}

module.exports = {
  id: "kusto",
  label: "tejit-kusto",
  order: 4,
  realtime: false,
  view: { center: [0, 20], zoom: 1.5 },
  methods: {
    function: {
      label: "Function (UDF)",
      async run(cfg) {
        const output = await invokeUdf(cfg.udf.kusto, {}, cfg.udfResource);
        const data = isRowList(output)
          ? rowsToPointFeatures(output, POINT_COLUMNS)
          : output;
        return { format: "geojson", data };
      },
    },
    direct: {
      label: "Direct (Kusto REST)",
      async run(cfg) {
        const rows = await kustoQuery(cfg.kusto.uri, cfg.kusto.db, QUERY);
        return {
          format: "geojson",
          data: rowsToPointFeatures(rows, POINT_COLUMNS),
        };
      },
    },
  },
};
