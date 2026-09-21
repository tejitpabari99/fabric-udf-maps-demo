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
  workspaceId: "61077f32-d21a-4791-b383-cacbddf222f5",
  lakehouseId: "b97fcfa2-6e58-4898-ab81-00ed5d1396cb",

  // Lakehouse file paths (relative to the lakehouse) used by the file sources.
  files: {
    carpark: "Files/GeoJson/Car_Parks.geojson",
    pmtiles: "Files/GeoJson/GpsTrace.pmtiles",
  },

  // --- Lakehouse SQL analytics endpoint (airports table) ---
  sql: {
    server: "x6eps4xrq2xudenlfv6naeo3i4-gj7qoyi22kiupm4dzlf534rc6u.msit-datawarehouse.fabric.microsoft.com",
    database: "TejitLH",
    table: "dbo.airports",
  },

  // --- Fabric Eventhouse / Kusto weather source: REMOVED (redundant with the
  //     eventstream source, which is also Kusto-backed). ---

  // --- Eventstream landing table (bikes source, real-time) ---
  eventstream: {
    kustoUri: "https://trd-tne4bs58upcvrph9ak.z1.kusto.fabric.microsoft.com",
    kustoDb: "BicycleES",
    table: "BicycleES",
  },

  // --- Azure Maps account CLIENT (unique) id for Entra auth (no key exposed).
  //     Leave empty to fall back to a subscription key for LOCAL dev only.
  mapsClientId: "e3c7516b-b6be-4ef3-be4b-1820312b2b13",

  // --- Published Fabric User Data Function invocation URLs ---
  //     Fill each in AFTER you publish the UDF and copy its Public URL.
  udf: {
    resource: "https://analysis.windows.net/powerbi/api",
    carpark: "https://61077f32d21a4791b383cacbddf222f5.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/61077f32-d21a-4791-b383-cacbddf222f5/userDataFunctions/695fb9b2-483c-4921-8569-fbc2b18ae128/functions/get_car_parks/invoke",
    pmtiles: "https://61077f32d21a4791b383cacbddf222f5.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/61077f32-d21a-4791-b383-cacbddf222f5/userDataFunctions/f7bc2a9e-79cb-4b8b-8556-e48e70d4f572/functions/get_gpstrace_pmtiles/invoke",
    airports: "https://61077f32d21a4791b383cacbddf222f5.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/61077f32-d21a-4791-b383-cacbddf222f5/userDataFunctions/1fc5eb6d-f4d5-46b8-b650-2758fc856421/functions/get_airports/invoke",
    eventstream: "https://61077f32d21a4791b383cacbddf222f5.z61.msituserdatafunctions.fabric.microsoft.com/v1/workspaces/61077f32-d21a-4791-b383-cacbddf222f5/userDataFunctions/18f66db4-b5d9-4455-8f24-fa9f1b36d033/functions/get_bikes/invoke",
  },
};
