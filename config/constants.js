"use strict";

// ============================================================================
//  SINGLE PLACE TO CONFIGURE THE APP FOR A TENANT / WORKSPACE.
//  Edit the values below to point the app at a different Fabric workspace.
//  Everything here is a NON-SECRET identifier or endpoint — there are no keys or
//  secrets, because the app authenticates with a managed identity (in Azure) or
//  `az login` (locally). See docs/port-and-setup-runbook.md.
//
//  Any value can also be overridden at runtime with the matching environment
//  variable (App Service app setting / .env) — see server/lib/config.js — but you
//  normally only need to edit THIS file and redeploy.
// ============================================================================

module.exports = {
  // --- Fabric workspace + lakehouse ---
  workspaceId: "7c918cd4-9e94-46d8-89dd-15d9226aaed3",
  lakehouseId: "51546df7-31e4-4f61-91be-070377130ebe",

  // Lakehouse file paths (relative to the lakehouse) used by the file sources.
  files: {
    carpark: "Files/GeoJson/Car_Parks.geojson",
    pmtiles: "Files/GeoJson/GpsTrace.pmtiles",
  },

  // --- Lakehouse SQL analytics endpoint (airports table) ---
  sql: {
    server: "pbziljroiu2ehb7n65aulfkxku-2sgjc7eut3menco5cxmse2vo2m.msit-datawarehouse.fabric.microsoft.com",
    database: "TejitLH",
    table: "dbo.airports",
  },

  // --- Fabric Eventhouse / Kusto weather source: REMOVED (redundant with the
  //     eventstream source, which is also Kusto-backed). ---

  // --- Eventstream landing table (bikes source, real-time) ---
  eventstream: {
    kustoUri: "https://trd-6hz9ctdyycuvn8vsds.z9.kusto.fabric.microsoft.com",
    kustoDb: "TejitEH",
    table: "BicycleES",
  },

  // --- Azure Maps account CLIENT (unique) id for Entra auth (no key exposed).
  //     Leave empty to fall back to a subscription key for LOCAL dev only.
  mapsClientId: "4283ee1e-1f15-4ad3-858c-75b4bd8065df",

  // --- Published Fabric User Data Function invocation URLs ---
  //     Fill each in AFTER you publish the UDF and copy its Public URL.
  udf: {
    resource: "https://analysis.windows.net/powerbi/api",
    carpark: "https://7c918cd49e9446d889dd15d9226aaed3.z7c.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/7c918cd4-9e94-46d8-89dd-15d9226aaed3/userDataFunctions/49a8ed67-6893-420b-ae2c-96b6d621b173/functions/get_car_parks/invoke",
    pmtiles: "https://7c918cd49e9446d889dd15d9226aaed3.z7c.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/7c918cd4-9e94-46d8-89dd-15d9226aaed3/userDataFunctions/a6a43524-3e9b-447b-a62a-fc2da509ba15/functions/get_gpstrace_pmtiles/invoke",
    airports: "https://7c918cd49e9446d889dd15d9226aaed3.z7c.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/7c918cd4-9e94-46d8-89dd-15d9226aaed3/userDataFunctions/db48bcdb-f69a-45c6-8cde-30874eec46db/functions/get_airports/invoke",
    eventstream: "https://7c918cd49e9446d889dd15d9226aaed3.z7c.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/7c918cd4-9e94-46d8-89dd-15d9226aaed3/userDataFunctions/64d326e2-8d53-4878-b778-0e393fed7cb4/functions/get_bikes/invoke",
  },
};
