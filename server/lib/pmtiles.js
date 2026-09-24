"use strict";

const zlib = require("zlib");
const { Compression, PMTiles, TileType } = require("pmtiles");
const { invokeUdf } = require("./fabric");

let archivePromise;

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
  const encoded = output;
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("PMTiles UDF returned invalid base64.");
  }
  const archive = Buffer.from(encoded, "base64");
  if (archive.toString("base64") !== encoded) throw new Error("PMTiles UDF returned invalid base64.");
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

async function loadArchive(cfg) {
  const output = await invokeUdf(cfg.udf.pmtiles, {}, cfg.udfResource);
  const archive = decodeFunctionOutput(output);
  const pmtiles = new PMTiles(new BufferSource(archive, "gpstrace:udf"), undefined, decompress);
  const [header, metadata] = await Promise.all([pmtiles.getHeader(), pmtiles.getMetadata()]);
  if (header.tileType !== TileType.Mvt) {
    throw new Error(`GpsTrace.pmtiles contains tile type ${header.tileType}, not MVT vector tiles.`);
  }

  const sourceLayer = sourceLayerFrom(metadata);
  return {
    archive,
    header,
    sourceLayer,
    featureCount: featureCountFrom(metadata, sourceLayer),
  };
}

function openPmtiles(cfg) {
  if (!archivePromise) {
    archivePromise = loadArchive(cfg).catch((err) => {
      archivePromise = undefined;
      throw err;
    });
  }
  return archivePromise;
}

async function getPmtilesMetadata(cfg) {
  const { header, sourceLayer, featureCount } = await openPmtiles(cfg);
  return {
    sourceLayer,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    center: [header.centerLon, header.centerLat],
    featureCount,
  };
}

async function getPmtilesArchive(cfg) {
  const { archive } = await openPmtiles(cfg);
  return archive;
}

module.exports = { getPmtilesMetadata, getPmtilesArchive };
