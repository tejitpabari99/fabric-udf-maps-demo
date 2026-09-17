"use strict";

// Source registry. Each file in this directory (except index.js) is a source
// module with the shape:
//
//   module.exports = {
//     id: "carpark",                       // stable id used in the API
//     label: "Car_Parks.geojson",          // shown in the source dropdown
//     order: 1,                            // dropdown ordering (lower = earlier)
//     realtime: false,                     // true => show real-time toggle + interval
//     view: { center: [lon, lat], zoom },  // optional default camera
//     methods: {                           // insertion order = dropdown order
//       function: { label, async run(cfg) { return payload } },
//       direct:   { label, async run(cfg) { return payload } },
//     },
//   };
//
// A method's run() returns a JSON-serializable payload:
//   { format: "geojson", data: <FeatureCollection> }
//   { format: "pmtiles", base64: "<...>" }
//
// Adding a source = drop a new file here. No other server file needs editing.

const fs = require("fs");
const path = require("path");

const sources = {};
for (const file of fs.readdirSync(__dirname)) {
  if (file === "index.js" || !file.endsWith(".js")) continue;
  const mod = require(path.join(__dirname, file));
  if (mod && mod.id) sources[mod.id] = mod;
}

function ordered() {
  return Object.values(sources).sort((a, b) => (a.order || 99) - (b.order || 99));
}

// Public descriptor for the browser (no run functions).
function describe() {
  return ordered().map((s) => ({
    id: s.id,
    label: s.label,
    realtime: Boolean(s.realtime),
    view: s.view || null,
    methods: Object.entries(s.methods).map(([id, m]) => ({ id, label: m.label })),
  }));
}

async function run(cfg, sourceId, methodId) {
  const src = sources[sourceId] || ordered()[0];
  const method = src.methods[methodId] || Object.values(src.methods)[0];
  if (!method) throw new Error(`No method '${methodId}' for source '${sourceId}'.`);
  const payload = await method.run(cfg);
  return { sourceId: src.id, methodId: Object.keys(src.methods).find((k) => src.methods[k] === method), payload };
}

module.exports = { sources, ordered, describe, run };
