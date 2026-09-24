"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const NativeMap = globalThis.Map;

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new NativeMap();
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this._innerHTML = "";
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !names.has(name) : force;
        if (enabled) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
        return enabled;
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === "") {
      this.children = [];
      this.value = "";
    }
  }

  appendChild(child) {
    this.children.push(child);
    if (this.tagName === "SELECT" && !this.value) this.value = child.value;
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type, target: this });
  }
}

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.intervals = new NativeMap();
    this.created = [];
  }

  setInterval(callback, milliseconds) {
    const id = this.nextId++;
    this.intervals.set(id, { callback, milliseconds, elapsed: 0 });
    this.created.push(milliseconds);
    return id;
  }

  clearInterval(id) {
    this.intervals.delete(id);
  }

  async advance(milliseconds) {
    const pending = [];
    for (const timer of this.intervals.values()) {
      timer.elapsed += milliseconds;
      while (timer.elapsed >= timer.milliseconds) {
        timer.elapsed -= timer.milliseconds;
        pending.push(timer.callback());
      }
    }
    await Promise.all(pending);
  }
}

function jsonResponse(body, { status = 200, format = "geojson" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "x-data-format" ? format : null },
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    },
  };
}

function boundsFromData(geojson) {
  const coordinates = [];
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) coordinates.push(value);
    else for (const child of value) visit(child);
  }
  for (const feature of geojson.features || []) visit(feature.geometry && feature.geometry.coordinates);
  if (!coordinates.length) return null;
  const xs = coordinates.map((coordinate) => coordinate[0]);
  const ys = coordinates.map((coordinate) => coordinate[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function createBrowserHarness({ sources = [], responses = {}, includeMethodElement = true, origin = "https://example.test" } = {}) {
  const elements = new NativeMap();
  for (const id of ["status", "status-pill", "source-select", "rt-group", "rt-toggle", "rt-interval", "reload"]) elements.set(id, new FakeElement(id === "source-select" || id === "rt-interval" ? "select" : "div", id));
  if (includeMethodElement) elements.set("method-select", new FakeElement("select", "method-select"));
  elements.get("rt-group").className = "rt-group hidden";
  elements.get("rt-interval").value = "5000";

  const state = {
    accesses: [],
    consoleErrors: [],
    dataSources: [],
    dataUrls: [],
    fetchCalls: [],
    layers: [],
    maps: [],
    popups: [],
    protocols: [],
    vectorSources: [],
  };
  const responseQueues = new NativeMap();
  const timers = new FakeTimers();

  class EventManager {
    constructor() {
      this.handlers = new NativeMap();
    }

    add(type, targetOrHandler, maybeHandler) {
      const handler = maybeHandler || targetOrHandler;
      const handlers = this.handlers.get(type) || [];
      handlers.push(handler);
      this.handlers.set(type, handlers);
    }

    emit(type, event = {}) {
      for (const handler of this.handlers.get(type) || []) handler(event);
    }
  }

  class FakeMap {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      this.cameraCalls = [];
      this.events = new EventManager();
      this.controls = { added: [], add: (controls, placement) => this.controls.added.push({ controls, placement }) };
      this.sources = {
        added: [],
        removed: [],
        add: (source) => this.sources.added.push(source),
        remove: (source) => this.sources.removed.push(source),
      };
      this.layers = {
        added: [],
        removed: [],
        add: (layers) => this.layers.added.push(...(Array.isArray(layers) ? layers : [layers])),
        remove: (layers) => this.layers.removed.push(...(Array.isArray(layers) ? layers : [layers])),
      };
      state.maps.push(this);
    }

    setCamera(options) {
      this.cameraCalls.push(options);
    }
  }

  class DataSource {
    constructor() {
      this.added = [];
      this.clearCount = 0;
      state.dataSources.push(this);
    }

    add(data) {
      this.added.push(data);
    }

    clear() {
      this.clearCount += 1;
    }
  }

  class VectorTileSource {
    constructor(id, options) {
      this.id = id;
      this.options = options;
      state.vectorSources.push(this);
    }
  }

  class Popup {
    constructor(options) {
      this.options = options;
      this.opened = false;
      this.closed = false;
      state.popups.push(this);
    }

    setOptions(options) {
      this.options = options;
    }

    open(map) {
      this.map = map;
      this.opened = true;
    }

    close() {
      this.closed = true;
    }
  }

  function layerClass(kind) {
    return class {
      constructor(source, id, options) {
        this.kind = kind;
        this.source = source;
        this.id = id;
        this.options = options;
        state.layers.push(this);
      }
    };
  }

  const atlas = {
    Map: FakeMap,
    Popup,
    addProtocol(name, callback) {
      state.protocols.push({ name, callback });
    },
    control: {
      ZoomControl: class {},
      CompassControl: class {},
      PitchControl: class {},
      StyleControl: class { constructor(options) { this.options = options; } },
      ScaleControl: class { constructor(options) { this.options = options; } },
    },
    data: { BoundingBox: { fromData: boundsFromData } },
    layer: {
      LineLayer: layerClass("LineLayer"),
      PolygonLayer: layerClass("PolygonLayer"),
      SymbolLayer: layerClass("SymbolLayer"),
    },
    source: { DataSource, VectorTileSource },
  };
  const window = {
    atlas,
    pmtiles: { Protocol: class { constructor() { this.tile = () => {}; } } },
  };
  const document = {
    getElementById(id) {
      state.accesses.push(id);
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  async function fetch(url, options) {
    state.fetchCalls.push({ url, options });
    if (url === "./api/config") return jsonResponse({ maps: { authType: "key", key: "test-key" }, sources });
    if (url === "./api/maps-token") return jsonResponse("test-token");
    if (url.startsWith("./api/data?")) {
      state.dataUrls.push(url);
      const source = new URL(url, origin).searchParams.get("source");
      const queue = responseQueues.get(source);
      const configured = queue && queue.length ? queue.shift() : responses[source];
      if (!configured) throw new Error(`No fake response configured for ${source}.`);
      const response = await (typeof configured === "function" ? configured({ source, url, options, state }) : configured);
      return jsonResponse(response.body, response);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }

  const context = vm.createContext({
    URL,
    atlas,
    clearInterval: (id) => timers.clearInterval(id),
    console: { log() {}, error: (...args) => state.consoleErrors.push(args) },
    document,
    fetch,
    location: { origin },
    setInterval: (callback, milliseconds) => timers.setInterval(callback, milliseconds),
    window,
  });

  async function settle() {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  }

  function runScript(relativePath) {
    const filename = path.join(ROOT, relativePath);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }

  async function boot({ includePmtiles = true } = {}) {
    runScript(path.join("public", "app.js"));
    if (includePmtiles) runScript(path.join("public", "render-pmtiles.js"));
    await settle();
    const map = state.maps[0];
    if (map) {
      map.events.emit("ready");
      await settle();
    }
    return map;
  }

  function enqueueResponse(source, response) {
    const queue = responseQueues.get(source) || [];
    queue.push(response);
    responseQueues.set(source, queue);
  }

  return { atlas, boot, context, document, elements, enqueueResponse, runScript, settle, state, timers, window };
}

module.exports = { createBrowserHarness };
