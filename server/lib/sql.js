"use strict";

const sql = require("mssql");
const { getAzToken, RESOURCES } = require("./fabric");

async function sqlQuery(cfg, query) {
  const token = await getAzToken(RESOURCES.sql);
  const pool = new sql.ConnectionPool({
    server: cfg.sql.server,
    database: cfg.sql.database,
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token },
    },
    options: { encrypt: true },
  });

  try {
    await pool.connect();
    const result = await pool.request().query(query);
    return result.recordset || [];
  } finally {
    await pool.close();
  }
}

module.exports = { sqlQuery };
