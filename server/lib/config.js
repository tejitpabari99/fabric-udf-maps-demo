"use strict";

// Central runtime configuration. All tenant/workspace values come from the single
// file config/constants.js; each can be overridden with an environment variable
// (App Service app setting / .env) if you don't want to edit the file. Source
// modules read from this object so they stay tiny. See docs/port-and-setup-runbook.md.

const fs = require("fs");
const path = require("path");
const K = require("../../config/constants");

// Optional .env loader for local overrides (secrets/keys should only ever live here).
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

const env = (name, fallback) => (process.env[name] !== undefined && process.env[name] !== "" ? process.env[name] : fallback);

const cfg = {
  port: parseInt(env("PORT", "3000"), 10),

  // Azure Maps: Entra auth via mapsClientId (no key exposed); key is a LOCAL-only fallback.
  mapsClientId: env("AZURE_MAPS_CLIENT_ID", K.mapsClientId),
  mapsKey: env("AZURE_MAPS_KEY", ""),

  workspaceId: env("WORKSPACE_ID", K.workspaceId),
  lakehouseId: env("LAKEHOUSE_ID", K.lakehouseId),
  files: K.files,

  sql: {
    server: env("SQL_ENDPOINT", K.sql.server),
    database: env("SQL_DATABASE", K.sql.database),
    table: K.sql.table,
  },

  kusto: {
    uri: env("KUSTO_URI", K.kusto.uri),
    db: env("KUSTO_DB", K.kusto.db),
    table: K.kusto.table,
  },

  eventstream: {
    kustoUri: env("EVENTSTREAM_KUSTO_URI", K.eventstream.kustoUri),
    kustoDb: env("EVENTSTREAM_KUSTO_DB", K.eventstream.kustoDb),
    table: env("EVENTSTREAM_TABLE", K.eventstream.table),
  },

  udfResource: env("UDF_RESOURCE", K.udf.resource),
  udf: {
    carpark: env("UDF_CARPARK_ENDPOINT", K.udf.carpark),
    pmtiles: env("UDF_PMTILES_ENDPOINT", K.udf.pmtiles),
    airports: env("UDF_AIRPORTS_ENDPOINT", K.udf.airports),
    kusto: env("UDF_KUSTO_ENDPOINT", K.udf.kusto),
    eventstream: env("UDF_EVENTSTREAM_ENDPOINT", K.udf.eventstream),
  },
};

module.exports = cfg;
