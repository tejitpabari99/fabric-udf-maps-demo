"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createBrowserHarness } = require("./helpers/browser-harness");

const ROOT = path.resolve(__dirname, "..");
const SOURCES = [
  { id: "carpark", label: "Car parks", realtime: false, view: { center: [-1.08, 53.96], zoom: 12 } },
  { id: "pmtiles", label: "GPS trace", realtime: false, view: { center: [12.96, 43.18], zoom: 10 } },
  { id: "airports", label: "Airports", realtime: false, view: { center: [15, 20], zoom: 1.5 } },
  { id: "eventstream", label: "Bicycle feed", realtime: true, view: { center: [-0.12, 51.5], zoom: 10 } },
];
const COMPATIBLE_SOURCES = SOURCES.map((source) => ({ ...source, methods: [{ id: "udf", label: "UDF" }] }));
const CARPARK = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { DESCRIPTIO: "City centre" }, geometry: { type: "Polygon", coordinates: [[[-1.09, 53.95], [-1.07, 53.95], [-1.07, 53.97], [-1.09, 53.95]]] } }],
};
const AIRPORTS = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name: "Test Airport" }, geometry: { type: "Point", coordinates: [12, 34] } }],
};
const EVENTSTREAM = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { Name: "Bike 1" }, geometry: { type: "Point", coordinates: [-0.12, 51.5] } }],
};
const PMTILES = { archiveUrl: "/api/pmtiles-archive", sourceLayer: "gpstrace", bounds: [-1.08, 53.9, -1.06, 54.1], featureCount: 7 };

function responses() {
  return {
    carpark: { body: { format: "geojson", data: CARPARK }, format: "geojson" },
    pmtiles: { body: PMTILES, format: "pmtiles" },
    airports: { body: { format: "geojson", data: AIRPORTS }, format: "geojson" },
    eventstream: { body: { format: "geojson", data: EVENTSTREAM }, format: "geojson" },
  };
}

function dataUrlsFor(harness, source) {
  return harness.state.dataUrls.filter((url) => new URL(url, "https://example.test").searchParams.get("source") === source);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function selectSource(harness, source) {
  harness.elements.get("source-select").value = source;
  harness.elements.get("source-select").dispatch("change");
  await harness.settle();
}

test("source-only frontend builds four options without method state and loads the first source on map ready", async () => {
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  let finishCarpark;
  const sourceResponses = responses();
  sourceResponses.carpark = () => new Promise((resolve) => {
    finishCarpark = () => resolve(responses().carpark);
  });
  const harness = createBrowserHarness({ sources: SOURCES, responses: sourceResponses });
  const map = await harness.boot();
  assert.doesNotMatch(html, /method-select|Retrieval method|>\s*Method\s*</i);
  assert.ok(map, "The map should initialize from source-only descriptors.");
  assert.deepEqual(harness.elements.get("source-select").children.map((option) => [option.value, option.textContent]), SOURCES.map((source) => [source.id, source.label]));
  assert.equal(harness.state.accesses.includes("method-select"), false);
  assert.equal(harness.elements.get("method-select").listeners.size, 0);
  assert.deepEqual(harness.state.dataUrls, ["./api/data?source=carpark"]);
  assert.equal(harness.elements.get("status-pill").textContent, "Car parks");
  assert.equal(harness.elements.get("status").textContent, "Loading Car parks…");
  finishCarpark();
  await harness.settle();
  assert.equal(harness.elements.get("status-pill").textContent, "Car parks · 1");
});

test("Eventstream polling uses the selected interval and repeats source-only requests", async () => {
  const harness = createBrowserHarness({ sources: COMPATIBLE_SOURCES, responses: responses() });
  await harness.boot();
  await selectSource(harness, "eventstream");
  const interval = harness.elements.get("rt-interval");
  interval.value = "10000";
  interval.dispatch("change");
  const toggle = harness.elements.get("rt-toggle");
  toggle.checked = true;
  toggle.dispatch("change");
  await harness.timers.advance(30000);
  await harness.settle();
  assert.deepEqual(harness.timers.created, [10000]);
  assert.equal(dataUrlsFor(harness, "eventstream").length, 4);
  assert.ok(harness.state.dataUrls.every((url) => /^\.\x2fapi\x2fdata\?source=[a-z]+$/.test(url)));
  assert.equal(interval.disabled, false);
  assert.equal(harness.elements.get("status-pill").textContent, "Bicycle feed · 1");
});

test("PMTiles browser renderer wires the method-free archive, source layer, bounds, and feature count", () => {
  const harness = createBrowserHarness({ origin: "https://maps.example.test" });
  harness.window.renderers = {};
  const map = new harness.atlas.Map("map", {});
  harness.window.__map = map;
  harness.runScript(path.join("public", "render-pmtiles.js"));
  const count = harness.window.renderers.pmtiles(PMTILES);
  assert.equal(count, 7);
  assert.equal(harness.state.vectorSources[0].options.url, "pmtiles://https://maps.example.test/api/pmtiles-archive");
  assert.deepEqual(harness.state.layers.map((layer) => [layer.kind, layer.options.sourceLayer]), [
    ["LineLayer", "gpstrace"],
    ["PolygonLayer", "gpstrace"],
    ["SymbolLayer", "gpstrace"],
  ]);
  assert.deepEqual(plain(map.cameraCalls.at(-1)), { bounds: PMTILES.bounds });
});

test("switching away from Eventstream stops and resets realtime then loads the new source exactly once", async () => {
  const harness = createBrowserHarness({ sources: COMPATIBLE_SOURCES, responses: responses() });
  await harness.boot();
  await selectSource(harness, "eventstream");
  const toggle = harness.elements.get("rt-toggle");
  toggle.checked = true;
  toggle.dispatch("change");
  await harness.timers.advance(5000);
  await harness.settle();
  const airportRequestsBefore = dataUrlsFor(harness, "airports").length;
  await selectSource(harness, "airports");
  assert.equal(harness.timers.intervals.size, 0);
  assert.equal(toggle.checked, false);
  assert.equal(harness.elements.get("rt-interval").disabled, true);
  assert.equal(harness.elements.get("rt-group").classList.contains("hidden"), true);
  assert.equal(dataUrlsFor(harness, "airports").length, airportRequestsBefore + 1);
  assert.equal(harness.state.dataUrls.at(-1), "./api/data?source=airports");
});

test("four-source UI preserves camera, popup, renderer dispatch, Load, errors, and realtime controls", async () => {
  const harness = createBrowserHarness({ sources: COMPATIBLE_SOURCES, responses: responses() });
  const map = await harness.boot();
  const datasource = harness.state.dataSources[0];
  assert.ok(map.cameraCalls.some((camera) => JSON.stringify(camera.center) === JSON.stringify(SOURCES[0].view.center) && camera.zoom === SOURCES[0].view.zoom));
  assert.deepEqual(plain(datasource.added.at(-1)), CARPARK);
  map.events.emit("click", {
    shapes: [{ getProperties: () => CARPARK.features[0].properties }],
    getCoordinates: () => [-1.08, 53.96],
  });
  assert.equal(harness.state.popups[0].opened, true);
  assert.match(harness.state.popups[0].options.content, /City centre/);

  await selectSource(harness, "pmtiles");
  assert.ok(map.cameraCalls.some((camera) => JSON.stringify(camera.center) === JSON.stringify(SOURCES[1].view.center) && camera.zoom === SOURCES[1].view.zoom));
  assert.equal(harness.state.vectorSources.at(-1).options.url, "pmtiles://https://example.test/api/pmtiles-archive");
  assert.equal(harness.elements.get("status-pill").textContent, "GPS trace · 7");

  await selectSource(harness, "airports");
  assert.ok(map.cameraCalls.some((camera) => JSON.stringify(camera.center) === JSON.stringify(SOURCES[2].view.center) && camera.zoom === SOURCES[2].view.zoom));
  assert.deepEqual(plain(datasource.added.at(-1)), AIRPORTS);
  assert.equal(harness.elements.get("rt-group").classList.contains("hidden"), true);

  await selectSource(harness, "eventstream");
  assert.ok(map.cameraCalls.some((camera) => JSON.stringify(camera.center) === JSON.stringify(SOURCES[3].view.center) && camera.zoom === SOURCES[3].view.zoom));
  assert.deepEqual(plain(datasource.added.at(-1)), EVENTSTREAM);
  assert.equal(harness.elements.get("rt-group").classList.contains("hidden"), false);
  const requestsBeforeLoad = harness.state.dataUrls.length;
  harness.elements.get("reload").dispatch("click");
  await harness.settle();
  assert.equal(harness.state.dataUrls.length, requestsBeforeLoad + 1);
  assert.equal(harness.state.dataUrls.at(-1), "./api/data?source=eventstream");

  harness.enqueueResponse("eventstream", { status: 502, body: { error: "UDF unavailable" }, format: "geojson" });
  harness.elements.get("reload").dispatch("click");
  await harness.settle();
  assert.equal(harness.elements.get("status-pill").textContent, "Bicycle feed · error");
  assert.equal(harness.elements.get("status").textContent, "UDF unavailable");
  assert.match(harness.elements.get("status").className, /\berror\b/);
});
