"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { getCarParks, listSources } = require("./dataSources");

// ---- Minimal .env loader (no dependencies) --------------------------------
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || "3000", 10);

const cfg = {
  dataSource: (process.env.DATA_SOURCE || "onelake").toLowerCase(),
  workspaceId: process.env.WORKSPACE_ID || "61077f32-d21a-4791-b383-cacbddf222f5",
  lakehouseId: process.env.LAKEHOUSE_ID || "b97fcfa2-6e58-4898-ab81-00ed5d1396cb",
  filePath: process.env.FILE_PATH || "Files/GeoJson/Car_Parks.geojson",
  udfEndpoint: process.env.UDF_ENDPOINT || "",
  udfResource: process.env.UDF_RESOURCE || "https://analysis.windows.net/powerbi/api",
  udfBody: safeJson(process.env.UDF_BODY) || {},
};

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { return null; }
}

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
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {}));
  res.end(body);
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api/config") {
    return sendJson(res, 200, {
      mapsKey: process.env.AZURE_MAPS_KEY || "",
      dataSource: cfg.dataSource,
      sources: listSources(cfg),
    });
  }

  if (url === "/api/carparks") {
    const q = new URLSearchParams(req.url.split("?")[1] || "");
    const sourceOverride = q.get("source");
    try {
      const { data, source } = await getCarParks(cfg, sourceOverride);
      return sendJson(res, 200, data, { "x-data-source": source, "Cache-Control": "no-store" });
    } catch (err) {
      console.error("[/api/carparks]", err.message);
      return sendJson(res, 502, { error: err.message });
    }
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  Fabric → Azure Maps demo running:  http://localhost:${PORT}`);
  console.log(`  Data source: ${cfg.dataSource}`);
  if (cfg.dataSource === "udf") console.log(`  UDF endpoint: ${cfg.udfEndpoint || "(not set!)"}`);
  else console.log(`  OneLake: ${cfg.workspaceId}/${cfg.lakehouseId}/${cfg.filePath}`);
  console.log("");
});
