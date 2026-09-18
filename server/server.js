"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const cfg = require("./lib/config");
const { getPmtilesTile } = require("./lib/pmtiles");
const { getAzToken, RESOURCES } = require("./lib/fabric");
const registry = require("./sources");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".ico": "image/x-icon",
};

function sendJson(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {}));
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  const q = new URLSearchParams(req.url.split("?")[1] || "");

  if (url === "/api/config") {
    // Prefer a subscription key when one is present (LOCAL dev convenience);
    // otherwise use Entra token auth (hosted app — no key exposed).
    const maps = cfg.mapsKey
      ? { authType: "key", key: cfg.mapsKey }
      : { authType: "aad", clientId: cfg.mapsClientId };
    return sendJson(res, 200, { maps, sources: registry.describe() });
  }

  // Mints a short-lived Azure Maps token using the server identity (managed
  // identity in Azure). The browser never sees a durable key.
  if (url === "/api/maps-token") {
    try {
      const token = await getAzToken(RESOURCES.atlas);
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      return res.end(token);
    } catch (err) {
      console.error("[/api/maps-token]", err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  const pmtilesMatch = url.match(/^\/api\/pmtiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/);
  if (pmtilesMatch) {
    const method = q.get("method");
    if (method !== "function" && method !== "direct") {
      return sendJson(res, 400, { error: "PMTiles method must be 'function' or 'direct'." });
    }

    const [, z, x, y] = pmtilesMatch.map(Number);
    try {
      const tile = await getPmtilesTile(cfg, method, z, x, y);
      if (!tile) {
        res.writeHead(204, { "Cache-Control": "public, max-age=3600" });
        return res.end();
      }
      res.writeHead(200, {
        "Content-Type": "application/x-protobuf",
        "Content-Length": tile.length,
        "Cache-Control": "public, max-age=3600",
      });
      return res.end(tile);
    } catch (err) {
      console.error(`[/api/pmtiles/${z}/${x}/${y}.mvt method=${method}]`, err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  if (url === "/api/data") {
    const source = q.get("source");
    const method = q.get("method");
    try {
      const { sourceId, methodId, payload } = await registry.run(cfg, source, method);
      return sendJson(res, 200, payload, {
        "x-data-source": sourceId,
        "x-data-method": methodId,
        "x-data-format": payload.format || "geojson",
        "Cache-Control": "no-store",
      });
    } catch (err) {
      console.error(`[/api/data source=${source} method=${method}]`, err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  return serveStatic(req, res);
});

server.listen(cfg.port, () => {
  console.log(`\n  Fabric → Azure Maps demo:  http://localhost:${cfg.port}`);
  console.log("  Sources: " + registry.ordered().map((s) => s.id).join(", "));
  console.log("");
});
