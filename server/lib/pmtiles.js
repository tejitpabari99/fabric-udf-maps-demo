"use strict";

const zlib = require("zlib");
const { Compression, PMTiles, TileType } = require("pmtiles");
const { invokeUdf, readOneLakeFile } = require("./fabric");

const FILE_PATH = "Files/GeoJson/GpsTrace.pmtiles";
const archiveCache = new Map();

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

class BufferSource {
  constructor(buffer, key) {
    this.buffer = buffer;
    this.key = key;
  }

  getKey() {
    return this.key;
  }

  async getBytes(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      throw new Error(`Invalid PMTiles byte range: offset=${offset}, length=${length}.`);
    }
    const end = offset + length;
    if (end > this.buffer.length) {
      throw new Error(`PMTiles byte range ${offset}-${end} exceeds archive size ${this.buffer.length}.`);
    }
    return { data: toArrayBuffer(this.buffer.subarray(offset, end)) };
  }
}

async function decompress(data, compression) {
  if (compression === Compression.None || compression === Compression.Unknown) return data;

  const input = Buffer.from(data);
  if (compression === Compression.Gzip) return toArrayBuffer(zlib.gunzipSync(input));
  if (compression === Compression.Brotli) return toArrayBuffer(zlib.brotliDecompressSync(input));

  throw new Error(`Unsupported PMTiles compression type: ${compression}.`);
}

function decodeFunctionOutput(output) {
  if (typeof output !== "string" || !output.trim()) {
    throw new Error("PMTiles UDF returned an empty or non-string response.");
  }
  const archive = Buffer.from(output, "base64");
  if (!archive.length) throw new Error("PMTiles UDF returned no archive bytes.");
  return archive;
}

function vectorLayers(metadata) {
  let layers = metadata && metadata.vector_layers;
  if (typeof layers === "string") {
    try {
      layers = JSON.parse(layers);
    } catch (err) {
      throw new Error(`PMTiles vector_layers metadata is invalid JSON: ${err.message}`);
    }
  }
  return Array.isArray(layers) ? layers : [];
}

function sourceLayerFrom(metadata) {
  const layer = vectorLayers(metadata).find((candidate) => candidate && typeof candidate.id === "string");
  if (!layer) throw new Error("PMTiles metadata does not declare a vector layer.");
  return layer.id;
}

function featureCountFrom(metadata, sourceLayer) {
  const layers = metadata && metadata.tilestats && metadata.tilestats.layers;
  if (!Array.isArray(layers)) return null;
  const layer = layers.find((candidate) => candidate && candidate.layer === sourceLayer);
  return layer && Number.isFinite(layer.count) ? layer.count : null;
}

async function loadArchive(cfg, method) {
  let archive;
  if (method === "direct") {
    archive = await readOneLakeFile(cfg, FILE_PATH, { binary: true });
  } else if (method === "function") {
    const output = await invokeUdf(cfg.udf.pmtiles, {}, cfg.udfResource);
    archive = decodeFunctionOutput(output);
  } else {
    throw new Error(`Unsupported PMTiles method '${method}'.`);
  }

  const pmtiles = new PMTiles(new BufferSource(archive, `gpstrace:${method}`), undefined, decompress);
  const [header, metadata] = await Promise.all([pmtiles.getHeader(), pmtiles.getMetadata()]);
  if (header.tileType !== TileType.Mvt) {
    throw new Error(`GpsTrace.pmtiles contains tile type ${header.tileType}, not MVT vector tiles.`);
  }

  const sourceLayer = sourceLayerFrom(metadata);
  return {
    archive,
    pmtiles,
    header,
    metadata,
    sourceLayer,
    featureCount: featureCountFrom(metadata, sourceLayer),
  };
}

function openPmtiles(cfg, method) {
  if (!archiveCache.has(method)) {
    const pending = loadArchive(cfg, method).catch((err) => {
      archiveCache.delete(method);
      throw err;
    });
    archiveCache.set(method, pending);
  }
  return archiveCache.get(method);
}

async function getPmtilesMetadata(cfg, method) {
  const { header, sourceLayer, featureCount } = await openPmtiles(cfg, method);
  return {
    sourceLayer,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    center: [header.centerLon, header.centerLat],
    featureCount,
  };
}

async function getPmtilesArchive(cfg, method) {
  const { archive } = await openPmtiles(cfg, method);
  return archive; // full .pmtiles archive Buffer (cached per method)
}

module.exports = { FILE_PATH, getPmtilesMetadata, getPmtilesArchive };
