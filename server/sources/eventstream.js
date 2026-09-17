"use strict";

const { invokeUdf, kustoQuery, rowsToPointFeatures } = require("../lib/fabric");

const DEFAULT_DESTINATION = {
  kustoUri: "",
  kustoDb: "",
  table: "",
};
const POINT_COLUMNS = { lat: "Latitude", lon: "Longitude" };

function isRowList(data) {
  return Array.isArray(data) &&
    data.every((row) => row && typeof row === "object" && !Array.isArray(row));
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function destination(cfg) {
  const configured = cfg.eventstream || {};
  return {
    kustoUri: configured.kustoUri || DEFAULT_DESTINATION.kustoUri,
    kustoDb: configured.kustoDb || DEFAULT_DESTINATION.kustoDb,
    table: configured.table || DEFAULT_DESTINATION.table,
  };
}

function tableQuery(table) {
  const escapedTable = table.replace(/"/g, '""');
  return (
    `table("${escapedTable}") ` +
    "| where isnotnull(Latitude) and isnotnull(Longitude) " +
    "| extend __ingestion_time = ingestion_time() " +
    "| order by __ingestion_time desc nulls last " +
    "| take 100 " +
    "| project-away __ingestion_time"
  );
}

module.exports = {
  id: "eventstream",
  label: "Bicycle-eventstream",
  order: 5,
  realtime: true,
  view: { center: [-0.12, 51.5], zoom: 10 },
  methods: {
    function: {
      label: "Function (UDF)",
      async run(cfg) {
        const output = await invokeUdf(cfg.udf.eventstream, {}, cfg.udfResource);
        const data = isRowList(output)
          ? rowsToPointFeatures(output, POINT_COLUMNS)
          : output;
        return { format: "geojson", data };
      },
    },
    direct: {
      label: "Direct (Kusto REST)",
      async run(cfg) {
        const target = destination(cfg);
        if (!target.kustoUri || !target.kustoDb || !target.table) {
          console.warn(
            "Bicycle-eventstream has no queryable destination. Configure a KQL database destination for SampleES and set EVENTSTREAM_KUSTO_URI, EVENTSTREAM_KUSTO_DB, and EVENTSTREAM_TABLE."
          );
          return { format: "geojson", data: emptyFeatureCollection() };
        }
        const rows = await kustoQuery(
          target.kustoUri,
          target.kustoDb,
          tableQuery(target.table)
        );
        return {
          format: "geojson",
          data: rowsToPointFeatures(rows, POINT_COLUMNS),
        };
      },
    },
  },
};
