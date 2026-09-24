"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const cfg = require("./lib/config");
const { getAzToken, RESOURCES } = require("./lib/fabric");
const { getPmtilesArchive } = require("./lib/pmtiles");
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

function createRequestHandler(overrides = {}) {
  const appCfg = overrides.cfg || cfg;
  const sourceRegistry = overrides.registry || registry;
  const acquireToken = overrides.getAzToken || getAzToken;
  const resources = overrides.resources || RESOURCES;
  const loadPmtilesArchive = overrides.getPmtilesArchive || getPmtilesArchive;
  const staticHandler = overrides.serveStatic || serveStatic;

  return async function requestHandler(req, res) {
    const url = req.url.split("?")[0];
    const q = new URLSearchParams(req.url.split("?")[1] || "");

    if (url === "/api/config") {
      const maps = appCfg.mapsKey
        ? { authType: "key", key: appCfg.mapsKey }
        : { authType: "aad", clientId: appCfg.mapsClientId };
      return sendJson(res, 200, { maps, sources: sourceRegistry.describe() });
    }

    if (url === "/api/maps-token") {
      try {
        const token = await acquireToken(resources.atlas);
        res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        return res.end(token);
      } catch (err) {
        console.error("[/api/maps-token]", err.message);
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (url === "/api/pmtiles-archive") {
      try {
        const archive = await loadPmtilesArchive(appCfg);
        const total = archive.length;
        const base = {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=3600",
        };
        const range = req.headers["range"];
        const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          let start = m[1] === "" ? undefined : parseInt(m[1], 10);
          let end = m[2] === "" ? undefined : parseInt(m[2], 10);
          if (start === undefined) { start = Math.max(0, total - end); end = total - 1; }
          else if (end === undefined || end >= total) { end = total - 1; }
          if (start > end || start >= total) {
            res.writeHead(416, { "Content-Range": `bytes */${total}` });
            return res.end();
          }
          const chunk = archive.subarray(start, end + 1);
          res.writeHead(206, Object.assign({}, base, {
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Content-Length": chunk.length,
          }));
          return res.end(chunk);
        }
        res.writeHead(200, Object.assign({}, base, { "Content-Length": total }));
        return res.end(archive);
      } catch (err) {
        console.error("[/api/pmtiles-archive]", err.message);
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (url === "/api/data") {
      const source = q.get("source");
      try {
        const { sourceId, payload } = await sourceRegistry.run(appCfg, source);
        return sendJson(res, 200, payload, {
          "x-data-source": sourceId,
          "x-data-format": payload.format || "geojson",
          "Cache-Control": "no-store",
        });
      } catch (err) {
        console.error(`[/api/data source=${source}]`, err.message);
        return sendJson(res, 502, { error: err.message });
      }
    }

    return staticHandler(req, res);
  };
}

function createServer(overrides = {}) {
  return http.createServer(createRequestHandler(overrides));
}

function startServer(overrides = {}) {
  const appCfg = overrides.cfg || cfg;
  const sourceRegistry = overrides.registry || registry;
  const server = createServer(overrides);
  server.listen(appCfg.port, () => {
    console.log(`\n  Fabric → Azure Maps demo:  http://localhost:${appCfg.port}`);
    console.log("  Sources: " + sourceRegistry.ordered().map((s) => s.id).join(", "));
    console.log("");
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { createRequestHandler, createServer, startServer };
