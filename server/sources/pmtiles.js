"use strict";

const { getPmtilesMetadata } = require("../lib/pmtiles");

module.exports = {
  id: "pmtiles",
  label: "GpsTrace.pmtiles",
  order: 2,
  realtime: false,
  view: { center: [12.9664245, 43.183583], zoom: 10 },
  async run(cfg) {
    const metadata = await getPmtilesMetadata(cfg);
    return {
      format: "pmtiles",
      archiveUrl: "/api/pmtiles-archive",
      sourceLayer: metadata.sourceLayer,
      minZoom: metadata.minZoom,
      maxZoom: metadata.maxZoom,
      bounds: metadata.bounds,
      center: metadata.center,
      featureCount: metadata.featureCount,
    };
  },
};
