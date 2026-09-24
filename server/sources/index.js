"use strict";

const fs = require("fs");
const path = require("path");

const sources = {};
for (const file of fs.readdirSync(__dirname)) {
  if (file === "index.js" || !file.endsWith(".js")) continue;
  const source = require(path.join(__dirname, file));
  if (source && source.id) sources[source.id] = source;
}

function ordered() {
  return Object.values(sources).sort((a, b) => (a.order || 99) - (b.order || 99));
}

function describe() {
  return ordered().map((source) => ({
    id: source.id,
    label: source.label,
    realtime: Boolean(source.realtime),
    view: source.view || null,
  }));
}

async function run(cfg, sourceId) {
  const source = sources[sourceId] || ordered()[0];
  const payload = await source.run(cfg);
  return { sourceId: source.id, payload };
}

module.exports = { sources, ordered, describe, run };
