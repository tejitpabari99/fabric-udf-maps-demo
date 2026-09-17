"use strict";

// ----- DOM -----
const el = (id) => document.getElementById(id);
const statusEl = el("status");
const statusPill = el("status-pill");
const sourceSelect = el("source-select");
const methodSelect = el("method-select");
const rtGroup = el("rt-group");
const rtToggle = el("rt-toggle");
const rtInterval = el("rt-interval");
const reloadBtn = el("reload");

let map, datasource, popup;
let SOURCES = [];
let rtTimer = null;

// ----- helpers -----
function setStatus(msg, isError) {
  if (!msg) { statusEl.className = "status"; statusEl.textContent = ""; return; }
  statusEl.textContent = msg;
  statusEl.className = "status show" + (isError ? " error" : "");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function currentSource() { return SOURCES.find((s) => s.id === sourceSelect.value) || SOURCES[0]; }

async function getConfig() {
  const res = await fetch("./api/config");
  if (!res.ok) throw new Error("Failed to load config: " + res.status);
  return res.json();
}

// ----- map -----
function initMap(subscriptionKey) {
  map = new atlas.Map("map", {
    center: [-1.08, 53.96],
    zoom: 11,
    style: "grayscale_light",
    showLogo: true,
    authOptions: { authType: "subscriptionKey", subscriptionKey },
  });

  map.events.add("ready", () => {
    // Standard map controls + a style picker (all supported Azure Maps styles).
    map.controls.add(
      [
        new atlas.control.ZoomControl(),
        new atlas.control.CompassControl(),
        new atlas.control.PitchControl(),
        new atlas.control.StyleControl({ mapStyles: "all", layout: "list" }),
        new atlas.control.ScaleControl({ units: "metric" }),
      ],
      { position: "top-right" }
    );

    datasource = new atlas.source.DataSource();
    map.sources.add(datasource);

    const polygonLayer = new atlas.layer.PolygonLayer(datasource, null, {
      fillColor: "#1a6fa3", fillOpacity: 0.45,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
    });
    const lineLayer = new atlas.layer.LineLayer(datasource, null, { strokeColor: "#0b3d5c", strokeWidth: 2 });
    const symbolLayer = new atlas.layer.SymbolLayer(datasource, null, {
      filter: ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]],
    });
    map.layers.add([polygonLayer, lineLayer, symbolLayer]);

    popup = new atlas.Popup({ pixelOffset: [0, -10] });
    map.events.add("click", [polygonLayer, symbolLayer], (e) => {
      if (!e.shapes || !e.shapes.length) return;
      const shape = e.shapes[0];
      const props = shape.getProperties ? shape.getProperties() : shape.properties;
      const title = props.DESCRIPTIO || props.name || props.Name || props.airport || "Feature";
      popup.setOptions({ content: popupHtml(title, props), position: e.getCoordinates ? e.getCoordinates() : e.position });
      popup.open(map);
    });

    // First load.
    onSourceChange();
  });
}

function popupHtml(title, props) {
  const rows = Object.keys(props || {})
    .filter((k) => props[k] !== null && props[k] !== "" && typeof props[k] !== "object")
    .slice(0, 20)
    .map((k) => `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(props[k])}</td></tr>`).join("");
  return `<div class="atlas-popup-content"><h3>${escapeHtml(title)}</h3><table>${rows}</table></div>`;
}

// ----- renderers (by payload.format) -----
const renderers = {
  geojson(payload) {
    const geojson = payload.data;
    datasource.add(geojson);
    const n = (geojson.features || []).length;
    fitTo(geojson);
    return n;
  },
  // pmtiles renderer is registered by pmtiles.render.js if that source is present.
};

function fitTo(geojson) {
  try {
    const bbox = atlas.data.BoundingBox.fromData(geojson);
    if (bbox && bbox[0] !== bbox[2]) map.setCamera({ bounds: bbox, padding: 60 });
    else if (bbox) map.setCamera({ center: [bbox[0], bbox[1]], zoom: 14 });
  } catch (_) { /* no geometry */ }
}

function clearMap() {
  if (datasource) datasource.clear();
  if (window.__pmtilesLayerCleanup) { window.__pmtilesLayerCleanup(); }
  if (popup) popup.close();
}

// ----- data loading -----
async function loadData() {
  clearMap();
  const src = currentSource();
  const method = methodSelect.value;
  statusPill.textContent = `${src.label} · ${method}`;
  setStatus(`Loading ${src.label} via ${method}…`, false);
  try {
    const res = await fetch(`./api/data?source=${encodeURIComponent(src.id)}&method=${encodeURIComponent(method)}`);
    const bodyText = await res.text();
    if (!res.ok) {
      let detail = bodyText; try { detail = JSON.parse(bodyText).error || bodyText; } catch (_) {}
      throw new Error(detail);
    }
    const format = res.headers.get("x-data-format") || "geojson";
    const payload = JSON.parse(bodyText);
    const renderer = renderers[format];
    if (!renderer) throw new Error(`No renderer for format '${format}'.`);
    const count = await renderer(payload);
    statusPill.textContent = `${src.label} · ${method}${count != null ? ` · ${count}` : ""}`;
    setStatus(null);
  } catch (err) {
    console.error(err);
    statusPill.textContent = `${src.label} · ${method} · error`;
    setStatus(err.message, true);
  }
}

// ----- realtime -----
function stopRealtime() { if (rtTimer) { clearInterval(rtTimer); rtTimer = null; } }
function syncRealtime() {
  const src = currentSource();
  const on = src.realtime && rtToggle.checked;
  rtInterval.disabled = !(src.realtime && rtToggle.checked);
  stopRealtime();
  if (on) rtTimer = setInterval(loadData, parseInt(rtInterval.value, 10));
}

// ----- dropdown wiring -----
function buildMethods(src) {
  methodSelect.innerHTML = "";
  for (const m of src.methods) {
    const opt = document.createElement("option");
    opt.value = m.id; opt.textContent = m.label;
    methodSelect.appendChild(opt);
  }
}

function onSourceChange() {
  const src = currentSource();
  buildMethods(src);
  rtGroup.classList.toggle("hidden", !src.realtime);
  rtToggle.checked = false;
  rtInterval.disabled = true;
  stopRealtime();
  if (src.view && map) map.setCamera({ center: src.view.center, zoom: src.view.zoom });
  loadData();
}

function onMethodChange() {
  // Update the source pill instantly, then load.
  const src = currentSource();
  statusPill.textContent = `${src.label} · ${methodSelect.value}`;
  loadData();
}

reloadBtn.addEventListener("click", loadData);
sourceSelect.addEventListener("change", onSourceChange);
methodSelect.addEventListener("change", onMethodChange);
rtToggle.addEventListener("change", syncRealtime);
rtInterval.addEventListener("change", syncRealtime);

// ----- boot -----
(async function start() {
  try {
    const cfg = await getConfig();
    SOURCES = cfg.sources || [];
    sourceSelect.innerHTML = "";
    for (const s of SOURCES) {
      const opt = document.createElement("option");
      opt.value = s.id; opt.textContent = s.label;
      sourceSelect.appendChild(opt);
    }
    if (SOURCES[0]) buildMethods(SOURCES[0]);
    if (!cfg.mapsKey) { setStatus("No Azure Maps key configured on the server (.env AZURE_MAPS_KEY).", true); return; }
    initMap(cfg.mapsKey);
  } catch (err) {
    setStatus(err.message, true);
  }
})();
