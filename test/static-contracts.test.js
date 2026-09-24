"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { startHttpTestServer } = require("./helpers/http-test-server");
const { credentialStub, loadWithStubs } = require("./helpers/module-stubs");

const ROOT = path.resolve(__dirname, "..");
const SERVER_ROOT = path.join(ROOT, "server");
const FABRIC_PATH = path.join(SERVER_ROOT, "lib", "fabric.js");
const SERVER_PATH = path.join(SERVER_ROOT, "server.js");
const CONFIG_PATH = path.join(SERVER_ROOT, "lib", "config.js");
const PMTILES_PATH = path.join(SERVER_ROOT, "lib", "pmtiles.js");
const PMTILES_SOURCE_PATH = path.join(SERVER_ROOT, "sources", "pmtiles.js");
const REGISTRY_PATH = path.join(SERVER_ROOT, "sources", "index.js");
const CONSTANTS_PATH = path.join(ROOT, "config", "constants.js");
const PRESERVED_REF = "c95e25a193b4c01e857c9a096cf03ae2aa6e0cfb";
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".py"]);

function assembled(...parts) {
  return parts.join("");
}

function walkTextFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkTextFiles(entryPath));
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) files.push(entryPath);
  }
  return files;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function matches(files, pattern) {
  return files.flatMap((file) => read(file).split(/\r?\n/).flatMap((line, index) => pattern.test(line) ? [`${relative(file)}:${index + 1}: ${line.trim()}`] : []));
}

const applicationFiles = ["server", "public", "config", "test", "fabric-udf"].flatMap((directory) => walkTextFiles(path.join(ROOT, directory)));
const packageFiles = [path.join(ROOT, "package.json"), path.join(ROOT, "package-lock.json")];
const terminologyFiles = [...applicationFiles, path.join(ROOT, ".env.example"), ...packageFiles];
const runtimeFiles = ["server", "public", "config"].flatMap((directory) => walkTextFiles(path.join(ROOT, directory)));

test("removed access-mode terminology is absent from the SP1 scan boundary", () => {
  const forbidden = String.fromCharCode(100, 105, 114, 101, 99, 116);
  const findings = matches(terminologyFiles, new RegExp(`\\b${forbidden}\\b`, "i"));
  assert.deepEqual(findings, []);
});

test("retired readers, resource audiences, and SQL module are absent", () => {
  const identifiers = [
    assembled("read", "OneLake", "File"),
    assembled("sql", "Query"),
    assembled("kusto", "Query"),
  ];
  const findings = identifiers.flatMap((identifier) => matches(runtimeFiles, new RegExp(`\\b${identifier}\\b`, "i")));
  const importPattern = new RegExp(`require\\s*\\(\\s*["'][^"']*(?:/|\\\\)${assembled("s", "ql")}["']\\s*\\)`, "i");
  findings.push(...matches(runtimeFiles, importPattern));
  assert.deepEqual(findings, []);
  assert.equal(fs.existsSync(path.join(SERVER_ROOT, "lib", assembled("s", "ql.js"))), false);

  const fabric = loadWithStubs(FABRIC_PATH, { "@azure/identity": credentialStub() }, [FABRIC_PATH]);
  assert.deepEqual(Object.keys(fabric.RESOURCES).sort(), ["atlas", "powerbi"]);
});

test("server and browser code contain no retrieval-selection plumbing", () => {
  const selectionFiles = ["server", "public"].flatMap((directory) => walkTextFiles(path.join(ROOT, directory)));
  const identifiers = [
    assembled("method", "Id"),
    assembled("method", "-select"),
    assembled("build", "Methods"),
    assembled("on", "Method", "Change"),
    assembled("x-data-", "method"),
  ];
  const findings = identifiers.flatMap((identifier) => matches(selectionFiles, new RegExp(identifier, "i")));
  const mapName = assembled("meth", "ods");
  findings.push(...matches(selectionFiles, new RegExp(`(?:\\.${mapName}\\b|\\b${mapName}\\s*:)`, "i")));
  const queryName = assembled("meth", "od");
  findings.push(...matches(selectionFiles, new RegExp(`(?:[?&]${queryName}=|(?:q|searchParams)\\.get\\s*\\(\\s*["']${queryName}["'])`, "i")));
  assert.deepEqual(findings, []);

  const pmtilesSelection = new RegExp(`\\b${queryName}\\b`, "i");
  assert.deepEqual(matches([PMTILES_PATH, PMTILES_SOURCE_PATH], pmtilesSelection), []);
});

test("package metadata excludes the SQL client and retains runtime dependencies", () => {
  const sqlClient = assembled("ms", "sql");
  const manifest = JSON.parse(read(path.join(ROOT, "package.json")));
  const lockfile = JSON.parse(read(path.join(ROOT, "package-lock.json")));
  assert.equal(Object.hasOwn(manifest.dependencies || {}, sqlClient), false);
  assert.equal(Object.hasOwn(lockfile.packages || {}, `node_modules/${sqlClient}`), false);
  assert.doesNotThrow(() => require.resolve("@azure/identity", { paths: [ROOT] }));
  assert.doesNotThrow(() => require.resolve("pmtiles", { paths: [ROOT] }));
});

test("Unchanged Fabric UDF files stay byte-identical to the preserved implementation", () => {
  const files = [
    "fabric-udf/airports_function_app.py",
    "fabric-udf/eventstream_function_app.py",
  ];
  for (const file of files) {
    const expected = childProcess.execFileSync("git", ["cat-file", "--filters", `${PRESERVED_REF}:${file}`], { cwd: ROOT, encoding: null });
    const actual = fs.readFileSync(path.join(ROOT, ...file.split("/")));
    assert.deepEqual(actual, expected, `${file} differs from ${PRESERVED_REF}`);
  }
});

test("Lakehouse-file UDFs read from the Files root and keep their contracts", () => {
  const carpark = read(path.join(ROOT, "fabric-udf", "carpark_function_app.py"));
  const pmtiles = read(path.join(ROOT, "fabric-udf", "pmtiles_function_app.py"));
  assert.match(carpark, /FILE_PATH = "Car_Parks\.geojson"/);
  assert.match(pmtiles, /FILE_PATH = "GpsTrace\.pmtiles"/);
  assert.doesNotMatch(carpark, /GeoJson\//);
  assert.doesNotMatch(pmtiles, /GeoJson\//);
  assert.match(carpark, /alias="carparkslh"[\s\S]*connectToFiles\(\)/);
  assert.match(pmtiles, /alias="gpstracelh"[\s\S]*connectToFiles\(\)/);
});

test("PMTiles payload and HTTP route retain full and ranged archive serving", () => {
  const source = read(PMTILES_SOURCE_PATH);
  const server = read(SERVER_PATH);
  assert.match(source, /archiveUrl:\s*["']\/api\/pmtiles-archive["']/);
  assert.match(server, /url\s*===\s*["']\/api\/pmtiles-archive["']/);
  assert.match(server, /req\.headers\[['"]range['"]\]/);
  for (const status of [200, 206, 416]) assert.match(server, new RegExp(`writeHead\\(${status}\\b`));
});

test("Fabric token resources remain limited to UDF invocation and Azure Maps", () => {
  const fabric = loadWithStubs(FABRIC_PATH, { "@azure/identity": credentialStub() }, [FABRIC_PATH]);
  assert.deepEqual(fabric.RESOURCES, {
    powerbi: "https://analysis.windows.net/powerbi/api",
    atlas: "https://atlas.microsoft.com",
  });
});

test("public configuration excludes server-only values", async (t) => {
  const cfg = {
    mapsClientId: "browser-client-id",
    mapsKey: "",
    udfResource: "private-resource",
    udf: { carpark: "private-carpark", pmtiles: "private-pmtiles", airports: "private-airports", eventstream: "private-eventstream" },
    identityCredential: "private-identity",
    fabricToken: "private-token",
  };
  const registry = { describe: () => [{ id: "carpark", label: "Car parks", realtime: false, view: null }] };
  const { createRequestHandler } = loadWithStubs(SERVER_PATH, {
    [CONFIG_PATH]: {},
    [FABRIC_PATH]: { getAzToken: async () => "unused", RESOURCES: { atlas: "atlas" } },
    [PMTILES_PATH]: { getPmtilesArchive: async () => Buffer.alloc(0) },
    [REGISTRY_PATH]: registry,
  }, [SERVER_PATH]);
  const app = await startHttpTestServer(createRequestHandler({
    cfg,
    registry,
    serveStatic(req, res) {
      res.writeHead(404);
      res.end("Not found");
    },
  }));
  t.after(() => app.close());
  const response = await app.request("/api/config");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    maps: { authType: "aad", clientId: "browser-client-id" },
    sources: registry.describe(),
  });
});

test("retained Node configuration and UDF layout match the documentation seam", () => {
  delete require.cache[require.resolve(CONSTANTS_PATH)];
  const constants = require(CONSTANTS_PATH);
  assert.deepEqual(Object.keys(constants).sort(), ["mapsClientId", "udf"]);
  assert.deepEqual(Object.keys(constants.udf).sort(), ["airports", "carpark", "eventstream", "pmtiles", "resource"]);

  const configSource = read(CONFIG_PATH);
  const expectedConfigReferences = [
    ["AZURE_MAPS_CLIENT_ID", "constants.mapsClientId"],
    ["UDF_RESOURCE", "constants.udf.resource"],
    ["UDF_CARPARK_ENDPOINT", "constants.udf.carpark"],
    ["UDF_PMTILES_ENDPOINT", "constants.udf.pmtiles"],
    ["UDF_AIRPORTS_ENDPOINT", "constants.udf.airports"],
    ["UDF_EVENTSTREAM_ENDPOINT", "constants.udf.eventstream"],
  ];
  for (const [environmentKey, fallback] of expectedConfigReferences) {
    assert.match(configSource, new RegExp(`env\\("${environmentKey}",\\s*${fallback.replaceAll(".", "\\.")}\\)`));
  }

  const environmentKeys = read(path.join(ROOT, ".env.example")).split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    return match ? [match[1]] : [];
  });
  assert.deepEqual(environmentKeys.sort(), [
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_MANAGED_IDENTITY_CLIENT_ID",
    "AZURE_MAPS_CLIENT_ID",
    "AZURE_MAPS_KEY",
    "AZURE_TENANT_ID",
    "PORT",
    "UDF_AIRPORTS_ENDPOINT",
    "UDF_CARPARK_ENDPOINT",
    "UDF_EVENTSTREAM_ENDPOINT",
    "UDF_PMTILES_ENDPOINT",
    "UDF_RESOURCE",
  ]);

  const functions = new Map([
    ["airports_function_app.py", "get_airports"],
    ["carpark_function_app.py", "get_car_parks"],
    ["eventstream_function_app.py", "get_bikes"],
    ["pmtiles_function_app.py", "get_gpstrace_pmtiles"],
  ]);
  const udfDirectory = path.join(ROOT, "fabric-udf");
  assert.deepEqual(fs.readdirSync(udfDirectory).filter((file) => file.endsWith(".py")).sort(), [...functions.keys()].sort());
  for (const [file, functionName] of functions) {
    assert.match(read(path.join(udfDirectory, file)), new RegExp(`\\bdef\\s+${functionName}\\s*\\(`));
  }
});
