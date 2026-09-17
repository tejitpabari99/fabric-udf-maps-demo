"use strict";

// Shared helpers used by all data-source modules.
//
// Auth model: every authenticated call gets a Microsoft Entra token from the
// Azure CLI (`az account get-access-token --resource <audience>`). Whoever runs
// the server just needs to be `az login`'d with access to the workspace. The
// browser never sees these tokens — this server is a Backend-for-Frontend (BFF).

const { execFile } = require("child_process");

const RESOURCES = {
  storage: "https://storage.azure.com",                 // OneLake / ADLS
  fabric: "https://api.fabric.microsoft.com",            // Fabric control plane
  powerbi: "https://analysis.windows.net/powerbi/api",   // UDF invocation + Fabric data plane + GraphQL
  kusto: "https://api.kusto.windows.net",                // Fabric Eventhouse (RTA) query
  sql: "https://database.windows.net",                   // Fabric SQL analytics endpoint (TDS)
};

const _tokenCache = new Map();

function getAzToken(resource) {
  const cached = _tokenCache.get(resource);
  if (cached && cached.exp > Date.now() + 60_000) return Promise.resolve(cached.tok);
  return new Promise((resolve, reject) => {
    execFile(
      "az",
      ["account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
      { shell: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error("az token failed for " + resource + ": " + (stderr || err.message)));
        const tok = stdout.trim();
        if (!tok) return reject(new Error("az returned an empty token for " + resource + ". Run `az login`."));
        _tokenCache.set(resource, { tok, exp: Date.now() + 30 * 60_000 });
        resolve(tok);
      }
    );
  });
}

// Read a whole file from a Lakehouse Files area (OneLake DFS).
async function readOneLakeFile(cfg, filePath, { binary = false } = {}) {
  const token = await getAzToken(RESOURCES.storage);
  const url = `https://onelake.dfs.fabric.microsoft.com/${cfg.workspaceId}/${cfg.lakehouseId}/${filePath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneLake read failed (${res.status}) for ${filePath}: ${text.slice(0, 300)}`);
  }
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// Invoke a published Fabric User Data Function and unwrap its output envelope.
async function invokeUdf(endpoint, body = {}, resource = RESOURCES.powerbi) {
  if (!endpoint) throw new Error("UDF endpoint is not configured (see .env).");
  const token = await getAzToken(resource);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`UDF invocation failed (${res.status}): ${text.slice(0, 800)}`);
  let payload;
  try { payload = JSON.parse(text); } catch (_) { throw new Error("UDF returned non-JSON: " + text.slice(0, 300)); }
  if (payload && payload.status && payload.status !== "Succeeded") {
    throw new Error(`UDF status ${payload.status}: ${JSON.stringify(payload.errors || payload)}`);
  }
  const out = payload.output ?? payload.functionResult ?? payload.result ?? payload;
  if (typeof out === "string") {
    try { return JSON.parse(out); } catch (_) { return out; }
  }
  return out;
}

// Run a Kusto (Fabric Eventhouse) query via the REST API. Returns row objects.
// Control commands (starting with ".") must use the v1 endpoint; queries use v2.
async function kustoQuery(clusterUri, database, csl, resource = RESOURCES.kusto) {
  const token = await getAzToken(resource);
  const isControl = csl.trimStart().startsWith(".");
  const endpoint = clusterUri.replace(/\/$/, "") + (isControl ? "/v1/rest/query" : "/v2/rest/query");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ db: database, csl }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kusto query failed (${res.status}): ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text);
  if (isControl) {
    // v1 shape: { Tables: [{ Columns:[{ColumnName}], Rows:[[...]] }] }
    const t = parsed.Tables && parsed.Tables[0];
    if (!t) return [];
    const cols = t.Columns.map((c) => c.ColumnName);
    return t.Rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  }
  // v2 shape: array of frames; find the primary result DataTable.
  const table = parsed.find((f) => f.TableKind === "PrimaryResult") ||
    parsed.find((f) => f.FrameType === "DataTable" && Array.isArray(f.Rows));
  if (!table) return [];
  const cols = table.Columns.map((c) => c.ColumnName);
  return table.Rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

// Convert an array of row objects into a GeoJSON FeatureCollection of Points.
// Auto-detects common lat/lon column names if not provided.
function rowsToPointFeatures(rows, { lat, lon } = {}) {
  const LAT = ["latitude", "lat", "y", "lat_deg", "ycoord"];
  const LON = ["longitude", "lon", "lng", "long", "x", "lon_deg", "xcoord"];
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const findKey = (cands, override) => override
    ? keys.find((k) => k.toLowerCase() === override.toLowerCase()) || override
    : keys.find((k) => cands.includes(k.toLowerCase()));
  const latK = findKey(LAT, lat);
  const lonK = findKey(LON, lon);
  const features = [];
  for (const row of rows) {
    const la = parseFloat(row[latK]);
    const lo = parseFloat(row[lonK]);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    features.push({ type: "Feature", properties: row, geometry: { type: "Point", coordinates: [lo, la] } });
  }
  return { type: "FeatureCollection", features };
}

module.exports = { RESOURCES, getAzToken, readOneLakeFile, invokeUdf, kustoQuery, rowsToPointFeatures };
