"use strict";

const statusEl = document.getElementById("status");
const sourcePill = document.getElementById("source-pill");
const countPill = document.getElementById("count-pill");
const reloadBtn = document.getElementById("reload");
const sourceSelect = document.getElementById("source-select");

function setStatus(msg, isError) {
  if (!msg) {
    statusEl.className = "status";
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = msg;
  statusEl.className = "status show" + (isError ? " error" : "");
}

let map;
let datasource;
let popup;

async function getConfig() {
  const res = await fetch("./api/config");
  if (!res.ok) throw new Error("Failed to load config: " + res.status);
  return res.json();
}

async function getData(source) {
  setStatus("Loading car parks from Fabric…", false);
  const qs = source ? "?source=" + encodeURIComponent(source) : "";
  const res = await fetch("./api/carparks" + qs);
  const body = await res.text();
  if (!res.ok) {
    let detail = body;
    try { detail = JSON.parse(body).error || body; } catch (_) {}
    throw new Error("Data request failed (" + res.status + "): " + detail);
  }
  const src = res.headers.get("x-data-source") || "unknown";
  const geojson = JSON.parse(body);
  return { geojson, source: src };
}

function propertiesTable(props) {
  const skip = new Set(["OBJECTID"]);
  const rows = Object.keys(props || {})
    .filter((k) => !skip.has(k) && props[k] !== null && props[k] !== "")
    .map((k) => `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(String(props[k]))}</td></tr>`)
    .join("");
  return `<table>${rows}</table>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderFeatures(geojson) {
  datasource.clear();
  datasource.add(geojson);

  const features = geojson.features || [];
  countPill.textContent = "features: " + features.length;

  // Fit the map to the data.
  const bbox = atlas.data.BoundingBox.fromData(geojson);
  map.setCamera({ bounds: bbox, padding: 60 });
}

function initMap(subscriptionKey) {
  map = new atlas.Map("map", {
    center: [-1.08, 53.96], // York, UK — overwritten once data loads
    zoom: 12,
    style: "grayscale_light",
    authOptions: {
      authType: "subscriptionKey",
      subscriptionKey: subscriptionKey,
    },
  });

  map.events.add("ready", async () => {
    datasource = new atlas.source.DataSource();
    map.sources.add(datasource);

    // Filled polygons for car park footprints.
    const polygonLayer = new atlas.layer.PolygonLayer(datasource, null, {
      fillColor: "#1a6fa3",
      fillOpacity: 0.45,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
    });

    // Outlines for the polygons.
    const lineLayer = new atlas.layer.LineLayer(datasource, null, {
      strokeColor: "#0b3d5c",
      strokeWidth: 2,
    });

    // Points (in case any features are points).
    const symbolLayer = new atlas.layer.SymbolLayer(datasource, null, {
      filter: ["==", ["geometry-type"], "Point"],
    });

    map.layers.add([polygonLayer, lineLayer, symbolLayer]);

    popup = new atlas.Popup({ pixelOffset: [0, -10] });

    map.events.add("click", [polygonLayer, symbolLayer], (e) => {
      if (!e.shapes || !e.shapes.length) return;
      const shape = e.shapes[0];
      const props = shape.getProperties ? shape.getProperties() : shape.properties;
      const title = props.DESCRIPTIO || props.name || "Car park";
      popup.setOptions({
        content: `<div class="atlas-popup-content"><h3>${escapeHtml(String(title))}</h3>${propertiesTable(props)}</div>`,
        position: e.position,
      });
      popup.open(map);
    });

    await loadAndRender();
  });
}

async function loadAndRender() {
  // Clear the canvas immediately so only the base map shows while loading —
  // never leave the previous data on screen during a fetch.
  if (datasource) datasource.clear();
  if (popup) popup.close();
  countPill.textContent = "features: …";
  const selected = sourceSelect ? sourceSelect.value : undefined;
  try {
    const { geojson, source } = await getData(selected);
    sourcePill.textContent = "source: " + source;
    renderFeatures(geojson);
    setStatus(null);
  } catch (err) {
    console.error(err);
    countPill.textContent = "features: 0";
    setStatus(err.message, true);
  }
}

reloadBtn.addEventListener("click", loadAndRender);
if (sourceSelect) sourceSelect.addEventListener("change", loadAndRender);

(async function start() {
  try {
    const cfg = await getConfig();
    if (sourceSelect && Array.isArray(cfg.sources)) {
      sourceSelect.innerHTML = "";
      for (const s of cfg.sources) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.label + (s.configured ? "" : " (not configured)");
        opt.disabled = !s.configured;
        if (s.id === cfg.dataSource) opt.selected = true;
        sourceSelect.appendChild(opt);
      }
    }
    if (!cfg.mapsKey) {
      setStatus("No Azure Maps key configured on the server (.env AZURE_MAPS_KEY).", true);
      return;
    }
    initMap(cfg.mapsKey);
  } catch (err) {
    setStatus(err.message, true);
  }
})();
