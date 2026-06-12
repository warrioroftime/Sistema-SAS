// src/db.js — Conexão PostgreSQL via pg
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'gestorflex',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30000,
});

let connected = false;

async function getPool() {
  if (!connected) {
    const client = await pool.connect();
    client.release();
    connected = true;
    console.log(`✅ PostgreSQL conectado: ${process.env.DB_HOST || 'localhost'} / ${process.env.DB_NAME || 'gestorflex'}`);
  }
  return pool;
}

// Converte @paramName → $1, $2... e coleta valores na ordem
function convertParams(text, namedParams) {
  const values = [];
  const idx = {};
  const sql = text.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    if (!(name in idx)) {
      idx[name] = values.length + 1;
      values.push(namedParams[name]);
    }
    return `$${idx[name]}`;
  });
  return { sql, values };
}

// query(text, { param: value }) — compatível com o padrão anterior
async function query(text, params = {}) {
  const { sql, values } = convertParams(text, params);
  const result = await pool.query(sql, values);
  return { recordset: result.rows, rowsAffected: [result.rowCount] };
}

// queryTyped(text, [{ name, type, value }]) — ignora type, delega para query()
async function queryTyped(text, params = []) {
  const named = {};
  for (const { name, value } of params) named[name] = value;
  return query(text, named);
}

// Helper para queries dentro de transações (recebe pg.PoolClient)
function clientQuery(client, text, params = {}) {
  const { sql, values } = convertParams(text, params);
  return client.query(sql, values).then(r => ({ recordset: r.rows, rowsAffected: [r.rowCount] }));
}

module.exports = { getPool, query, queryTyped, clientQuery, pool };
