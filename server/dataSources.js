"use strict";

// Data-source adapters. Each returns a GeoJSON FeatureCollection (as a JS object).
//
// Two sources are supported, selected by env DATA_SOURCE:
//   - "onelake" : read the file directly from OneLake DFS (proven, no UDF needed).
//   - "udf"     : call the published Fabric User Data Function HTTP endpoint.
//
// Both acquire a Microsoft Entra token via the Azure CLI (`az account get-access-token`),
// so whoever runs the server just needs to be `az login`'d with access to the workspace.

const { execFile } = require("child_process");

function getAzToken(resource) {
  return new Promise((resolve, reject) => {
    execFile(
      "az",
      ["account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
      { shell: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error("az token failed for " + resource + ": " + (stderr || err.message)));
        const tok = stdout.trim();
        if (!tok) return reject(new Error("az returned an empty token for " + resource + ". Run `az login`."));
        resolve(tok);
      }
    );
  });
}

// ---- OneLake (direct file read) -------------------------------------------

const ONELAKE_RESOURCE = "https://storage.azure.com";

async function fromOneLake(cfg) {
  const { workspaceId, lakehouseId, filePath } = cfg;
  const token = await getAzToken(ONELAKE_RESOURCE);
  const url = `https://onelake.dfs.fabric.microsoft.com/${workspaceId}/${lakehouseId}/${filePath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneLake read failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

// ---- Fabric User Data Function (published HTTP endpoint) -------------------
//
// The UDF resource/audience and endpoint are set from .env (UDF_ENDPOINT, UDF_RESOURCE).
// The function is expected to return the GeoJSON FeatureCollection as its output.

async function fromUdf(cfg) {
  const { udfEndpoint, udfResource, udfBody } = cfg;
  if (!udfEndpoint) throw new Error("UDF_ENDPOINT is not set in .env");
  const token = await getAzToken(udfResource);
  const res = await fetch(udfEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(udfBody || {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`UDF invocation failed (${res.status}): ${text.slice(0, 800)}`);
  }
  // A UDF wraps the return value; unwrap common shapes so the browser always gets
  // a plain FeatureCollection.
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error("UDF returned non-JSON: " + text.slice(0, 300));
  }
  return unwrapUdfOutput(payload);
}

// Fabric UDF invocation responses commonly look like { output: <value>, ... } or
// { functionResult: <value> }. Accept a bare FeatureCollection too.
function unwrapUdfOutput(payload) {
  if (payload && payload.type === "FeatureCollection") return payload;
  const candidate = payload.output ?? payload.functionResult ?? payload.result ?? payload.value ?? payload.body;
  if (candidate === undefined) return payload;
  if (typeof candidate === "string") {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      return payload;
    }
  }
  return candidate;
}

// Which POC sources exist and how to run them.
const SOURCES = {
  onelake: { label: "OneLake direct file read (authenticated)", run: fromOneLake },
  udf: { label: "Fabric User Data Function (authenticated API wrapper)", run: fromUdf },
};

async function getCarParks(cfg, sourceOverride) {
  const source = (sourceOverride || cfg.dataSource || "onelake").toLowerCase();
  const entry = SOURCES[source];
  if (!entry) throw new Error(`Unknown source '${source}'. Valid: ${Object.keys(SOURCES).join(", ")}`);
  return { data: await entry.run(cfg), source };
}

// Report which POCs are runnable given current .env config.
function listSources(cfg) {
  return Object.entries(SOURCES).map(([id, s]) => ({
    id,
    label: s.label,
    configured: id === "onelake" ? true : id === "udf" ? Boolean(cfg.udfEndpoint) : false,
  }));
}

module.exports = { getCarParks, getAzToken, listSources };
