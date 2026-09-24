"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { TileType } = require("pmtiles");
const { startHttpTestServer } = require("./helpers/http-test-server");
const { loadWithStubs } = require("./helpers/module-stubs");

const ROOT = path.resolve(__dirname, "..");
const SERVER_ROOT = path.join(ROOT, "server");
const FABRIC_PATH = path.join(SERVER_ROOT, "lib", "fabric.js");
const CONFIG_PATH = path.join(SERVER_ROOT, "lib", "config.js");
const PMTILES_PATH = path.join(SERVER_ROOT, "lib", "pmtiles.js");
const PMTILES_SOURCE_PATH = path.join(SERVER_ROOT, "sources", "pmtiles.js");
const REGISTRY_PATH = path.join(SERVER_ROOT, "sources", "index.js");
const SERVER_PATH = path.join(SERVER_ROOT, "server.js");
const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "gpstrace-mvt.pmtiles"));
const CFG = { udfResource: "https://analysis.windows.net/powerbi/api", udf: { pmtiles: "https://example.test/pmtiles" } };

function archiveWithMetadata(metadata, tileType = TileType.Mvt) {
  const archive = Buffer.from(FIXTURE);
  const bytes = Buffer.from(JSON.stringify(metadata));
  const offset = Number(archive.readBigUInt64LE(24));
  const available = Number(archive.readBigUInt64LE(32));
  assert.ok(bytes.length <= available, `Test metadata needs ${bytes.length} bytes but only ${available} are available.`);
  archive.fill(0x20, offset, offset + available);
  bytes.copy(archive, offset);
  archive.writeBigUInt64LE(BigInt(bytes.length), 32);
  archive[99] = tileType;
  return archive;
}

function runtimeFor(output) {
  let calls = 0;
  const invokeUdf = async (...args) => {
    calls += 1;
    return typeof output === "function" ? output(calls, args) : output;
  };
  const pmtiles = loadWithStubs(PMTILES_PATH, { [FABRIC_PATH]: { invokeUdf } }, [PMTILES_PATH]);
  const source = loadWithStubs(PMTILES_SOURCE_PATH, { [PMTILES_PATH]: pmtiles }, [PMTILES_SOURCE_PATH]);
  return { pmtiles, source, calls: () => calls };
}

async function application(t, runtime, archiveLoader = runtime.pmtiles.getPmtilesArchive) {
  const registry = {
    describe() {
      return [];
    },
    ordered() {
      return [runtime.source];
    },
    async run(cfg) {
      return { sourceId: "pmtiles", payload: await runtime.source.run(cfg) };
    },
  };
  const { createRequestHandler } = loadWithStubs(SERVER_PATH, {
    [CONFIG_PATH]: {},
    [FABRIC_PATH]: { getAzToken: async () => "token", RESOURCES: { atlas: "atlas" } },
    [PMTILES_PATH]: runtime.pmtiles,
    [REGISTRY_PATH]: registry,
  }, [SERVER_PATH]);
  const app = await startHttpTestServer(createRequestHandler({
    cfg: CFG,
    registry,
    getPmtilesArchive: archiveLoader,
    serveStatic(req, res) {
      res.writeHead(404);
      res.end("Not found");
    },
  }));
  t.after(() => app.close());
  return app;
}

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

test("PMTiles metadata and archive bytes come from the same UDF archive", async () => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  const metadata = await runtime.pmtiles.getPmtilesMetadata(CFG);
  const archive = await runtime.pmtiles.getPmtilesArchive(CFG);
  assert.deepEqual(metadata, {
    sourceLayer: "gpstrace",
    minZoom: 0,
    maxZoom: 0,
    bounds: [-1.08, 53.9, -1.06, 54.1],
    center: [-1.07, 54],
    featureCount: 1,
  });
  assert.deepEqual(archive, FIXTURE);
  assert.equal(runtime.calls(), 1);
});

test("concurrent metadata and archive requests share one lazy UDF invocation", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = runtimeFor(async () => {
    await wait;
    return FIXTURE.toString("base64");
  });
  const metadata = runtime.pmtiles.getPmtilesMetadata(CFG);
  const archive = runtime.pmtiles.getPmtilesArchive(CFG);
  assert.equal(runtime.calls(), 1);
  release();
  const [metadataResult, archiveResult] = await Promise.all([metadata, archive]);
  assert.equal(metadataResult.sourceLayer, "gpstrace");
  assert.deepEqual(archiveResult, FIXTURE);
  assert.equal(runtime.calls(), 1);
});

test("PMTiles source retains the endpoint and returns all metadata fields without application query state", async () => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  assert.deepEqual(await runtime.source.run(CFG), {
    format: "pmtiles",
    archiveUrl: "/api/pmtiles-archive",
    sourceLayer: "gpstrace",
    minZoom: 0,
    maxZoom: 0,
    bounds: [-1.08, 53.9, -1.06, 54.1],
    center: [-1.07, 54],
    featureCount: 1,
  });
});

test("PMTiles archive endpoint returns the full archive with 200 semantics", async (t) => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  let loaderArgs;
  const app = await application(t, runtime, async (...args) => {
    loaderArgs = args;
    return runtime.pmtiles.getPmtilesArchive(...args);
  });
  const response = await app.request("/api/pmtiles-archive?ignored=value");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), String(FIXTURE.length));
  assert.deepEqual(await responseBytes(response), FIXTURE);
  assert.deepEqual(loaderArgs, [CFG]);
});

test("PMTiles archive endpoint returns bounded byte ranges", async (t) => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  const app = await application(t, runtime);
  const response = await app.request("/api/pmtiles-archive", { headers: { Range: "bytes=0-99" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 0-99/${FIXTURE.length}`);
  assert.equal(response.headers.get("content-length"), "100");
  assert.deepEqual(await responseBytes(response), FIXTURE.subarray(0, 100));
});

test("PMTiles archive endpoint returns open-ended byte ranges", async (t) => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  const app = await application(t, runtime);
  const response = await app.request("/api/pmtiles-archive", { headers: { Range: "bytes=100-" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 100-${FIXTURE.length - 1}/${FIXTURE.length}`);
  assert.deepEqual(await responseBytes(response), FIXTURE.subarray(100));
});

test("PMTiles archive endpoint returns suffix byte ranges and the full archive when shorter", async (t) => {
  for (const archive of [FIXTURE, FIXTURE.subarray(0, 50)]) {
    const runtime = runtimeFor(FIXTURE.toString("base64"));
    const app = await application(t, runtime, async () => archive);
    const response = await app.request("/api/pmtiles-archive", { headers: { Range: "bytes=-100" } });
    const start = Math.max(0, archive.length - 100);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${archive.length - 1}/${archive.length}`);
    assert.deepEqual(await responseBytes(response), archive.subarray(start));
  }
});

test("PMTiles archive endpoint clamps a valid range end to the final byte", async (t) => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  const app = await application(t, runtime);
  const start = FIXTURE.length - 25;
  const response = await app.request("/api/pmtiles-archive", { headers: { Range: `bytes=${start}-${FIXTURE.length + 500}` } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes ${start}-${FIXTURE.length - 1}/${FIXTURE.length}`);
  assert.deepEqual(await responseBytes(response), FIXTURE.subarray(start));
});

test("PMTiles archive endpoint returns 416 for unsatisfiable starts and reversed ranges", async (t) => {
  const runtime = runtimeFor(FIXTURE.toString("base64"));
  const app = await application(t, runtime);
  for (const range of [`bytes=${FIXTURE.length}-`, "bytes=100-99"]) {
    const response = await app.request("/api/pmtiles-archive", { headers: { Range: range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${FIXTURE.length}`);
    assert.equal((await responseBytes(response)).length, 0);
  }
});

test("PMTiles metadata permits missing tilestats and reports a nullable feature count", async () => {
  const archive = archiveWithMetadata({ vector_layers: [{ id: "gpstrace" }] });
  const runtime = runtimeFor(archive.toString("base64"));
  const metadata = await runtime.pmtiles.getPmtilesMetadata(CFG);
  assert.equal(metadata.sourceLayer, "gpstrace");
  assert.equal(metadata.featureCount, null);
});

test("PMTiles metadata parses vector_layers encoded as a JSON string", async () => {
  const archive = archiveWithMetadata({ vector_layers: JSON.stringify([{ id: "string-layer" }]) });
  const runtime = runtimeFor(archive.toString("base64"));
  const metadata = await runtime.pmtiles.getPmtilesMetadata(CFG);
  assert.equal(metadata.sourceLayer, "string-layer");
});

for (const [label, output] of [["empty", ""], ["null", null], ["object", {}], ["whitespace", " \r\n\t "]]) {
  test(`PMTiles rejects ${label} UDF output with an explicit response error`, async () => {
    const runtime = runtimeFor(output);
    await assert.rejects(runtime.pmtiles.getPmtilesMetadata(CFG), /empty or non-string response/);
  });
}

test("PMTiles rejects malformed base64 before archive parsing", async () => {
  for (const output of ["not-base64!", ` ${FIXTURE.toString("base64")}`]) {
    const runtime = runtimeFor(output);
    await assert.rejects(runtime.pmtiles.getPmtilesMetadata(CFG), /invalid base64/);
  }
});

test("PMTiles rejects decoded bytes that are not a valid archive", async () => {
  const runtime = runtimeFor(Buffer.from("not a pmtiles archive").toString("base64"));
  await assert.rejects(runtime.pmtiles.getPmtilesMetadata(CFG), /PMTiles|archive|header/i);
});

test("PMTiles rejects a structurally valid non-MVT archive", async () => {
  const archive = archiveWithMetadata({ vector_layers: [{ id: "gpstrace" }] }, TileType.Png);
  const runtime = runtimeFor(archive.toString("base64"));
  await assert.rejects(runtime.pmtiles.getPmtilesMetadata(CFG), /not MVT vector tiles/);
});

test("PMTiles rejects metadata without a vector layer", async () => {
  const archive = archiveWithMetadata({ vector_layers: [] });
  const runtime = runtimeFor(archive.toString("base64"));
  await assert.rejects(runtime.pmtiles.getPmtilesMetadata(CFG), /does not declare a vector layer/);
});

test("PMTiles rejects invalid vector_layers JSON", async () => {
  const archive = archiveWithMetadata({ vector_layers: "{" });
  const runtime = runtimeFor(archive.toString("base64"));
  await assert.rejects(runtime.pmtiles.getPmtilesMetadata(CFG), /vector_layers metadata is invalid JSON/);
});

test("PMTiles evicts rejected cache entries so a later request retries", async () => {
  const runtime = runtimeFor((call) => call === 1 ? "not-base64!" : FIXTURE.toString("base64"));
  await assert.rejects(runtime.pmtiles.getPmtilesArchive(CFG), /invalid base64/);
  assert.deepEqual(await runtime.pmtiles.getPmtilesArchive(CFG), FIXTURE);
  assert.equal(runtime.calls(), 2);
});

test("PMTiles archive failures remain explicit 502 responses", async (t) => {
  const runtime = runtimeFor("not-base64!");
  const app = await application(t, runtime);
  const response = await app.request("/api/pmtiles-archive");
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /invalid base64/);
});
