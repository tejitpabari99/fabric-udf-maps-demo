"use strict";

(function registerPmtilesRenderer() {
  window.renderers.pmtiles = function renderPmtiles(payload) {
    if (window.__pmtilesLayerCleanup) window.__pmtilesLayerCleanup();

    const map = window.__map;
    if (!map) throw new Error("Azure Maps is not ready.");

    const source = new atlas.source.VectorTileSource(null, {
      tiles: [location.origin + payload.tilesUrl],
      minZoom: payload.minZoom,
      maxZoom: payload.maxZoom,
      bounds: payload.bounds,
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
    map.setCamera({ bounds: payload.bounds });

    return payload.featureCount ?? null;
  };
})();
