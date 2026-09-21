"use strict";

// Renders a PMTiles archive using the Azure Maps native `pmtiles://` protocol.
// The pmtiles.js library issues HTTP Range requests to the archive URL and decodes
// vector tiles in the browser — the server only relays byte ranges (no tile decode).
// Docs: https://learn.microsoft.com/en-us/azure/azure-maps/add-custom-protocol-pmtiles

(function registerPmtilesRenderer() {
  // Register the pmtiles protocol with Azure Maps once.
  if (!window.__pmtilesProtocol && window.pmtiles && window.atlas) {
    const protocol = new window.pmtiles.Protocol();
    atlas.addProtocol("pmtiles", protocol.tile);
    window.__pmtilesProtocol = protocol;
  }

  window.renderers.pmtiles = function renderPmtiles(payload) {
    if (window.__pmtilesLayerCleanup) window.__pmtilesLayerCleanup();

    const map = window.__map;
    if (!map) throw new Error("Azure Maps is not ready.");

    const archiveUrl = location.origin + payload.archiveUrl;
    const source = new atlas.source.VectorTileSource(null, {
      type: "vector",
      url: `pmtiles://${archiveUrl}`, // protocol auto-derives min/max zoom
    });

    const layers = [
      new atlas.layer.LineLayer(source, null, {
        sourceLayer: payload.sourceLayer,
        strokeColor: "#0067b8",
        strokeWidth: 3,
      }),
      new atlas.layer.PolygonLayer(source, null, {
        sourceLayer: payload.sourceLayer,
        fillColor: "#1a6fa3",
        fillOpacity: 0.45,
      }),
      new atlas.layer.SymbolLayer(source, null, {
        sourceLayer: payload.sourceLayer,
      }),
    ];

    let sourceAdded = false;
    let layersAdded = false;
    window.__pmtilesLayerCleanup = function cleanupPmtilesLayer() {
      if (layersAdded) map.layers.remove(layers);
      if (sourceAdded) map.sources.remove(source);
      layersAdded = false;
      sourceAdded = false;
      window.__pmtilesLayerCleanup = null;
    };

    map.sources.add(source);
    sourceAdded = true;
    map.layers.add(layers);
    layersAdded = true;
    if (payload.bounds) map.setCamera({ bounds: payload.bounds });

    return payload.featureCount ?? null;
  };
})();
