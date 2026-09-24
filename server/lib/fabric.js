"use strict";

const { DefaultAzureCredential } = require("@azure/identity");

const RESOURCES = {
  powerbi: "https://analysis.windows.net/powerbi/api",
  atlas: "https://atlas.microsoft.com",
};

const credential = new DefaultAzureCredential(
  process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID
    ? { managedIdentityClientId: process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID }
    : undefined
);
const tokenCache = new Map();

async function getAzToken(resource) {
  const cached = tokenCache.get(resource);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const scope = resource.replace(/\/+$/, "") + "/.default";
  let result;
  try {
    result = await credential.getToken(scope);
  } catch (err) {
    throw new Error(`Failed to acquire a token for ${resource}: ${err.message}. Set AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET (service principal), run in Azure with a managed identity, or \`az login\`.`);
  }
  if (!result || !result.token) throw new Error(`Empty token for ${resource}.`);
  tokenCache.set(resource, { token: result.token, expiresAt: result.expiresOnTimestamp || Date.now() + 30 * 60_000 });
  return result.token;
}

async function invokeUdf(endpoint, body = {}, resource = RESOURCES.powerbi) {
  if (!endpoint) throw new Error("UDF endpoint is not configured (see .env).");
  const token = await getAzToken(resource);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`UDF invocation failed (${response.status}): ${text.slice(0, 800)}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error("UDF returned non-JSON: " + text.slice(0, 300));
  }
  if (payload && payload.status && payload.status !== "Succeeded") throw new Error(`UDF status ${payload.status}: ${JSON.stringify(payload.errors || payload)}`);
  const output = payload.output ?? payload.functionResult ?? payload.result ?? payload;
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch (_) {
      return output;
    }
  }
  return output;
}

function rowsToPointFeatures(rows, { lat, lon } = {}) {
  const latitudeNames = ["latitude", "lat", "y", "lat_deg", "ycoord"];
  const longitudeNames = ["longitude", "lon", "lng", "long", "x", "lon_deg", "xcoord"];
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const findKey = (candidates, override) => override
    ? keys.find((key) => key.toLowerCase() === override.toLowerCase()) || override
    : keys.find((key) => candidates.includes(key.toLowerCase()));
  const latitudeKey = findKey(latitudeNames, lat);
  const longitudeKey = findKey(longitudeNames, lon);
  const features = [];
  for (const row of rows) {
    const latitude = parseFloat(row[latitudeKey]);
    const longitude = parseFloat(row[longitudeKey]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    features.push({ type: "Feature", properties: row, geometry: { type: "Point", coordinates: [longitude, latitude] } });
  }
  return { type: "FeatureCollection", features };
}

module.exports = { RESOURCES, getAzToken, invokeUdf, rowsToPointFeatures };
