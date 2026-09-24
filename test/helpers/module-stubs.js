"use strict";

const Module = require("module");
const path = require("path");

function clearModulesUnder(root) {
  const normalizedRoot = path.resolve(root) + path.sep;
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(normalizedRoot)) delete require.cache[id];
  }
}

function loadWithStubs(entry, stubs = {}, rootsToClear = []) {
  for (const root of rootsToClear) clearModulesUnder(root);
  delete require.cache[require.resolve(entry)];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    let resolved;
    try {
      resolved = Module._resolveFilename(request, parent, isMain);
    } catch (_) {
      resolved = request;
    }
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (Object.prototype.hasOwnProperty.call(stubs, resolved)) return stubs[resolved];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(entry);
  } finally {
    Module._load = originalLoad;
  }
}

function credentialStub({ token = "test-token", error, calls = [] } = {}) {
  return {
    DefaultAzureCredential: class {
      async getToken(scope) {
        calls.push(scope);
        if (error) throw error;
        return { token, expiresOnTimestamp: Date.now() + 3_600_000 };
      }
    },
  };
}

function installGlobals(values) {
  const previous = new Map();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return function restoreGlobals() {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

module.exports = { clearModulesUnder, credentialStub, installGlobals, loadWithStubs };
