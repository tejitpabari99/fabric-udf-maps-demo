"use strict";

// Central configuration, loaded from .env (see .env.example). Every id/endpoint
// the sources need lives here so source modules stay tiny.

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv();

const cfg = {
  port: parseInt(process.env.PORT || "3000", 10),
  mapsKey: process.env.AZURE_MAPS_KEY || "",

  workspaceId: process.env.WORKSPACE_ID || "61077f32-d21a-4791-b383-cacbddf222f5",
  lakehouseId: process.env.LAKEHOUSE_ID || "b97fcfa2-6e58-4898-ab81-00ed5d1396cb",

  // Fabric SQL analytics endpoint for the lakehouse (airports table).
  sql: {
    server: process.env.SQL_ENDPOINT || "x6eps4xrq2xudenlfv6naeo3i4-gj7qoyi22kiupm4dzlf534rc6u.msit-datawarehouse.fabric.microsoft.com",
    database: process.env.SQL_DATABASE || "TejitLH",
  },

  // Fabric Eventhouse (Kusto) for tejit-kusto.
  kusto: {
    uri: process.env.KUSTO_URI || "https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com",
    db: process.env.KUSTO_DB || "TejitEH",
  },

  // Eventstream (Bicycle-eventstream / SampleES).
  eventstream: {
    id: process.env.EVENTSTREAM_ID || "a08bed4d-242a-4676-be4e-a1d62ae4cd6d",
    name: process.env.EVENTSTREAM_NAME || "SampleES",
    // Where the stream lands and is read from (filled in by the eventstream source).
    kustoUri: process.env.EVENTSTREAM_KUSTO_URI || process.env.KUSTO_URI || "https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com",
    kustoDb: process.env.EVENTSTREAM_KUSTO_DB || process.env.KUSTO_DB || "TejitEH",
    table: process.env.EVENTSTREAM_TABLE || "",
  },

  udfResource: process.env.UDF_RESOURCE || "https://analysis.windows.net/powerbi/api",

  // Per-source published UDF invocation URLs (empty until deployed).
  udf: {
    carpark: process.env.UDF_CARPARK_ENDPOINT || process.env.UDF_ENDPOINT || "",
    pmtiles: process.env.UDF_PMTILES_ENDPOINT || "",
    airports: process.env.UDF_AIRPORTS_ENDPOINT || "",
    kusto: process.env.UDF_KUSTO_ENDPOINT || "",
    eventstream: process.env.UDF_EVENTSTREAM_ENDPOINT || "",
  },
};

module.exports = cfg;
