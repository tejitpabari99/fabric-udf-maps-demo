"use strict";

const { getPmtilesMetadata } = require("../lib/pmtiles");

async function payload(cfg, method) {
  const metadata = await getPmtilesMetadata(cfg, method);
  return {
    format: "pmtiles",
    archiveUrl: `/api/pmtiles-archive?method=${method}`,
    sourceLayer: metadata.sourceLayer,
    minZoom: metadata.minZoom,
    maxZoom: metadata.maxZoom,
    bounds: metadata.bounds,
    center: metadata.center,
    featureCount: metadata.featureCount,
  };
}

module.exports = {
  id: "pmtiles",
  label: "GpsTrace.pmtiles",
  order: 2,
  realtime: false,
  view: { center: [12.9664245, 43.183583], zoom: 10 },
  methods: {
    function: {
      label: "Function (UDF)",
      run(cfg) {
        return payload(cfg, "function");
      },
    },
    direct: {
      label: "Direct (OneLake file)",
      run(cfg) {
        return payload(cfg, "direct");
      },
    },
  },
};
