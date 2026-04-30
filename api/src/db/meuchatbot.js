'use strict';

const { Pool } = require('pg');

let pool = null;

function getMeuchatbotPool() {
  if (!pool) {
    const connectionString = process.env.MEUCHATBOT_DATABASE_URL;
    if (!connectionString) {
      throw new Error('MEUCHATBOT_DATABASE_URL não definida — endpoints de camila_interna desativados.');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
    pool.on('error', (err) => {
      console.error('[meuchatbot DB] erro no pool:', err.message);
    });
  }
  return pool;
}

module.exports = { getMeuchatbotPool };
