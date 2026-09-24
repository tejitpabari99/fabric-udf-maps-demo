"use strict";

const http = require("http");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function startHttpTestServer(handler) {
  const server = http.createServer(handler);
  const baseUrl = await listen(server);
  return {
    baseUrl,
    request(path, options) {
      return fetch(baseUrl + path, options);
    },
    close() {
      return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    },
  };
}

async function startJsonTestServer(responder) {
  return startHttpTestServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      const response = await responder(req, body);
      const status = response.status || 200;
      const headers = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, response.headers);
      const payload = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
      res.writeHead(status, headers);
      res.end(payload);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

module.exports = { startHttpTestServer, startJsonTestServer };
