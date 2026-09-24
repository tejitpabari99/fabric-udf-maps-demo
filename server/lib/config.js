"use strict";

const fs = require("fs");
const path = require("path");
const constants = require("../../config/constants");

function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnv();

const env = (name, fallback) => process.env[name] !== undefined && process.env[name] !== "" ? process.env[name] : fallback;

module.exports = {
  port: parseInt(env("PORT", "3000"), 10),
  mapsClientId: env("AZURE_MAPS_CLIENT_ID", constants.mapsClientId),
  mapsKey: env("AZURE_MAPS_KEY", ""),
  udfResource: env("UDF_RESOURCE", constants.udf.resource),
  udf: {
    carpark: env("UDF_CARPARK_ENDPOINT", constants.udf.carpark),
    pmtiles: env("UDF_PMTILES_ENDPOINT", constants.udf.pmtiles),
    airports: env("UDF_AIRPORTS_ENDPOINT", constants.udf.airports),
    eventstream: env("UDF_EVENTSTREAM_ENDPOINT", constants.udf.eventstream),
  },
};
