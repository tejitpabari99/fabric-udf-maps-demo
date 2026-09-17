"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const cfg = require("./lib/config");
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
    return sendJson(res, 200, { mapsKey: cfg.mapsKey, sources: registry.describe() });
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
