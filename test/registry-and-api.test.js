"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { startHttpTestServer, startJsonTestServer } = require("./helpers/http-test-server");
const { clearModulesUnder, credentialStub, installGlobals, loadWithStubs } = require("./helpers/module-stubs");

const ROOT = path.resolve(__dirname, "..");
const SERVER_ROOT = path.join(ROOT, "server");
const FABRIC_PATH = path.join(SERVER_ROOT, "lib", "fabric.js");
const CONFIG_PATH = path.join(SERVER_ROOT, "lib", "config.js");
const PMTILES_PATH = path.join(SERVER_ROOT, "lib", "pmtiles.js");
const REGISTRY_PATH = path.join(SERVER_ROOT, "sources", "index.js");
const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "gpstrace-mvt.pmtiles"));
const UDF_RESOURCE = "https://analysis.windows.net/powerbi/api";
const ATLAS_RESOURCE = "https://atlas.microsoft.com";
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

function configuration(baseUrl, overrides = {}) {
  const udf = Object.assign({
    carpark: `${baseUrl}/carpark`,
    pmtiles: `${baseUrl}/pmtiles`,
    airports: `${baseUrl}/airports`,
    eventstream: `${baseUrl}/eventstream`,
  }, overrides.udf);
  return Object.assign({
    port: 0,
    mapsClientId: "maps-client-id",
    mapsKey: "",
    udfResource: UDF_RESOURCE,
    udf,
  }, overrides, { udf });
}

function buildRuntime(credentialOptions = {}) {
  clearModulesUnder(SERVER_ROOT);
  const tokenCalls = credentialOptions.calls || [];
  const identity = credentialStub(Object.assign({}, credentialOptions, { calls: tokenCalls }));
  const fabric = loadWithStubs(FABRIC_PATH, { "@azure/identity": identity });
  const pmtiles = loadWithStubs(PMTILES_PATH, { [FABRIC_PATH]: fabric });
  const registry = loadWithStubs(REGISTRY_PATH, { [FABRIC_PATH]: fabric, [PMTILES_PATH]: pmtiles }, [path.join(SERVER_ROOT, "sources")]);
  const { createRequestHandler } = loadWithStubs(path.join(SERVER_ROOT, "server.js"), {
    [CONFIG_PATH]: {},
    [FABRIC_PATH]: fabric,
    [PMTILES_PATH]: pmtiles,
    [REGISTRY_PATH]: registry,
  });
  return { createRequestHandler, fabric, pmtiles, registry, tokenCalls };
}

async function startApplication(t, runtime, cfg) {
  const app = await startHttpTestServer(runtime.createRequestHandler({
    cfg,
    registry: runtime.registry,
    getAzToken: runtime.fabric.getAzToken,
    resources: runtime.fabric.RESOURCES,
    getPmtilesArchive: runtime.pmtiles.getPmtilesArchive,
    serveStatic(req, res) {
      res.writeHead(404);
      res.end("Not found");
    },
  }));
  t.after(() => app.close());
  return app;
}

async function jsonResponse(response) {
  const body = await response.json();
  return { response, body };
}

function succeeded(output) {
  return { status: "Succeeded", output };
}

test("browser globals can be installed and restored without external packages", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const restore = installGlobals({ window: { marker: "window" }, document: { marker: "document" } });
  assert.equal(window.marker, "window");
  assert.equal(document.marker, "document");
  restore();
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "window"), previousWindow);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "document"), previousDocument);
});

test("config exposes four ordered browser-safe source descriptors", async (t) => {
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration("http://unused"));
  const { response, body } = await jsonResponse(await app.request("/api/config"));
  assert.equal(response.status, 200);
  assert.deepEqual(body.sources, [
    { id: "carpark", label: "Car_Parks.geojson", realtime: false, view: { center: [-1.08, 53.96], zoom: 12 } },
    { id: "pmtiles", label: "GpsTrace.pmtiles", realtime: false, view: { center: [12.9664245, 43.183583], zoom: 10 } },
    { id: "airports", label: "airports-lakehouse", realtime: false, view: { center: [15, 20], zoom: 1.5 } },
    { id: "eventstream", label: "Bicycle-eventstream", realtime: true, view: { center: [-0.12, 51.5], zoom: 10 } },
  ]);
  for (const descriptor of body.sources) assert.equal(Object.hasOwn(descriptor, "methods"), false);
});

test("carpark returns the UDF GeoJSON once with source-only headers", async (t) => {
  const calls = [];
  const data = { type: "FeatureCollection", features: [{ type: "Feature", properties: { id: 1 }, geometry: null }] };
  const udf = await startJsonTestServer((req) => {
    calls.push(req.url);
    return { body: succeeded(data) };
  });
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  const { response, body } = await jsonResponse(await app.request("/api/data?source=carpark&method=ignored"));
  assert.equal(response.status, 200);
  assert.deepEqual(body, { format: "geojson", data });
  assert.equal(response.headers.get("x-data-source"), "carpark");
  assert.equal(response.headers.get("x-data-format"), "geojson");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has(["x", "data", "method"].join("-")), false);
  assert.deepEqual(calls, ["/carpark"]);
});

test("unknown and missing source ids fall back to carpark", async (t) => {
  const calls = [];
  const udf = await startJsonTestServer((req) => {
    calls.push(req.url);
    return { body: succeeded(EMPTY_COLLECTION) };
  });
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  for (const requestPath of ["/api/data?source=unknown", "/api/data"]) {
    const { response, body } = await jsonResponse(await app.request(requestPath));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-data-source"), "carpark");
    assert.deepEqual(body, { format: "geojson", data: EMPTY_COLLECTION });
  }
  assert.deepEqual(calls, ["/carpark", "/carpark"]);
});

test("airports normalizes valid rows and preserves their properties", async (t) => {
  const rows = [
    { name: "valid", _c6: "53.9", _c7: "-1.1" },
    { name: "missing-latitude", _c7: "2" },
    { name: "null-longitude", _c6: 4, _c7: null },
    { name: "nonnumeric", _c6: "north", _c7: "east" },
  ];
  const udf = await startJsonTestServer(() => ({ body: succeeded(rows) }));
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  const { body } = await jsonResponse(await app.request("/api/data?source=airports"));
  assert.deepEqual(body, {
    format: "geojson",
    data: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: rows[0], geometry: { type: "Point", coordinates: [-1.1, 53.9] } }],
    },
  });
});

test("eventstream normalizes valid rows and preserves realtime metadata", async (t) => {
  const rows = [
    { BikePoint: "A", Latitude: 51.5, Longitude: -0.12 },
    { BikePoint: "B", Latitude: undefined, Longitude: -0.11 },
  ];
  const udf = await startJsonTestServer(() => ({ body: succeeded(rows) }));
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  const { body } = await jsonResponse(await app.request("/api/data?source=eventstream"));
  assert.deepEqual(body.data.features, [
    { type: "Feature", properties: rows[0], geometry: { type: "Point", coordinates: [-0.12, 51.5] } },
  ]);
  assert.equal(runtime.registry.sources.eventstream.realtime, true);
});

test("airports and eventstream return empty feature collections for empty row lists", async (t) => {
  const udf = await startJsonTestServer(() => ({ body: succeeded([]) }));
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  for (const source of ["airports", "eventstream"]) {
    const { response, body } = await jsonResponse(await app.request(`/api/data?source=${source}`));
    assert.equal(response.status, 200);
    assert.deepEqual(body, { format: "geojson", data: EMPTY_COLLECTION });
  }
});

test("airports and eventstream pass through ready GeoJSON", async (t) => {
  const ready = { type: "FeatureCollection", features: [{ type: "Feature", properties: { ready: true }, geometry: null }] };
  const udf = await startJsonTestServer(() => ({ body: succeeded(ready) }));
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  for (const source of ["airports", "eventstream"]) {
    const { body } = await jsonResponse(await app.request(`/api/data?source=${source}`));
    assert.deepEqual(body, { format: "geojson", data: ready });
  }
});

test("each source reports a missing UDF endpoint without another data path", async (t) => {
  for (const source of ["carpark", "pmtiles", "airports", "eventstream"]) {
    const runtime = buildRuntime();
    const cfg = configuration("http://unused", { udf: { [source]: "" } });
    const app = await startApplication(t, runtime, cfg);
    const { response, body } = await jsonResponse(await app.request(`/api/data?source=${source}`));
    assert.equal(response.status, 502);
    assert.match(body.error, /UDF endpoint is not configured/);
  }
});

test("identity acquisition failure returns 502 and requests only the UDF audience", async (t) => {
  const tokenCalls = [];
  const runtime = buildRuntime({ calls: tokenCalls, error: new Error("identity unavailable") });
  const app = await startApplication(t, runtime, configuration("http://unused"));
  const { response, body } = await jsonResponse(await app.request("/api/data?source=carpark"));
  assert.equal(response.status, 502);
  assert.match(body.error, /identity unavailable/);
  assert.deepEqual(tokenCalls, [`${UDF_RESOURCE}/.default`]);
});

for (const status of [401, 403, 429, 500]) {
  test(`UDF HTTP ${status} returns bounded explicit failure`, async (t) => {
    const detail = `failure-${status}-` + "x".repeat(1500);
    const udf = await startJsonTestServer(() => ({ status, body: detail, headers: { "Content-Type": "text/plain" } }));
    t.after(() => udf.close());
    const runtime = buildRuntime();
    const app = await startApplication(t, runtime, configuration(udf.baseUrl));
    const { response, body } = await jsonResponse(await app.request("/api/data?source=carpark"));
    assert.equal(response.status, 502);
    assert.match(body.error, new RegExp(`UDF invocation failed \\(${status}\\)`));
    assert.ok(body.error.length < 900);
    assert.equal(Object.hasOwn(body, "data"), false);
  });
}

test("UDF logical failure envelope returns an explicit 502", async (t) => {
  const udf = await startJsonTestServer(() => ({ body: { status: "Failed", errors: [{ message: "query rejected" }] } }));
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  const { response, body } = await jsonResponse(await app.request("/api/data?source=carpark"));
  assert.equal(response.status, 502);
  assert.match(body.error, /UDF status Failed/);
  assert.match(body.error, /query rejected/);
});

test("non-JSON UDF output returns an explicit 502", async (t) => {
  const udf = await startJsonTestServer(() => ({ body: "not-json", headers: { "Content-Type": "text/plain" } }));
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  const { response, body } = await jsonResponse(await app.request("/api/data?source=airports"));
  assert.equal(response.status, 502);
  assert.match(body.error, /UDF returned non-JSON/);
});

test("hosted Maps configuration and token use only the Atlas audience", async (t) => {
  const tokenCalls = [];
  const runtime = buildRuntime({ calls: tokenCalls, token: "maps-token" });
  const cfg = configuration("http://unused");
  const app = await startApplication(t, runtime, cfg);
  const configResult = await jsonResponse(await app.request("/api/config"));
  assert.deepEqual(configResult.body.maps, { authType: "aad", clientId: "maps-client-id" });
  const tokenResponse = await app.request("/api/maps-token");
  assert.equal(tokenResponse.status, 200);
  assert.equal(await tokenResponse.text(), "maps-token");
  assert.equal(tokenResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(tokenCalls, [`${ATLAS_RESOURCE}/.default`]);
});

test("local Maps key fallback does not change Fabric source invocation", async (t) => {
  const calls = [];
  const udf = await startJsonTestServer((req) => {
    calls.push(req.url);
    return { body: succeeded(EMPTY_COLLECTION) };
  });
  t.after(() => udf.close());
  const runtime = buildRuntime();
  const cfg = configuration(udf.baseUrl, { mapsKey: "local-key" });
  const app = await startApplication(t, runtime, cfg);
  const configResult = await jsonResponse(await app.request("/api/config"));
  assert.deepEqual(configResult.body.maps, { authType: "key", key: "local-key" });
  const dataResult = await jsonResponse(await app.request("/api/data?source=carpark"));
  assert.equal(dataResult.response.status, 200);
  assert.deepEqual(calls, ["/carpark"]);
});

test("Maps token acquisition failure remains an explicit 502", async (t) => {
  const runtime = buildRuntime({ error: new Error("atlas identity unavailable") });
  const app = await startApplication(t, runtime, configuration("http://unused"));
  const { response, body } = await jsonResponse(await app.request("/api/maps-token"));
  assert.equal(response.status, 502);
  assert.match(body.error, /atlas identity unavailable/);
});

test("all source loads plus Maps request use only UDF and Atlas audiences", async (t) => {
  const paths = [];
  const tokenCalls = [];
  const udf = await startJsonTestServer((req) => {
    paths.push(req.url);
    if (req.url === "/pmtiles") return { body: succeeded(FIXTURE.toString("base64")) };
    return { body: succeeded(req.url === "/carpark" ? EMPTY_COLLECTION : []) };
  });
  t.after(() => udf.close());
  const runtime = buildRuntime({ calls: tokenCalls });
  const app = await startApplication(t, runtime, configuration(udf.baseUrl));
  for (const source of ["carpark", "pmtiles", "airports", "eventstream"]) {
    const response = await app.request(`/api/data?source=${source}`);
    assert.equal(response.status, 200, `${source}: ${await response.text()}`);
  }
  assert.equal((await app.request("/api/maps-token")).status, 200);
  assert.deepEqual(paths.sort(), ["/airports", "/carpark", "/eventstream", "/pmtiles"]);
  assert.deepEqual(Object.keys(runtime.fabric.RESOURCES).sort(), ["atlas", "powerbi"]);
  assert.deepEqual(new Set(tokenCalls), new Set([`${UDF_RESOURCE}/.default`, `${ATLAS_RESOURCE}/.default`]));
});

test("public config does not leak server-only settings", async (t) => {
  const runtime = buildRuntime();
  const cfg = configuration("https://private.example", {
    tenantCredential: "never-public",
    fabricToken: "never-public",
    sourceConnection: "never-public",
  });
  const app = await startApplication(t, runtime, cfg);
  const { body } = await jsonResponse(await app.request("/api/config"));
  assert.deepEqual(Object.keys(body).sort(), ["maps", "sources"]);
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("never-public"), false);
  assert.equal(serialized.includes("UDF_"), false);
});
