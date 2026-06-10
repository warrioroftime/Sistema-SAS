// src/db.js — Conexão com SQL Server (multiplataforma)
// Driver escolhido por DB_DRIVER:
//   - 'msnodesqlv8' (ODBC, Windows)  → padrão no Windows
//   - 'tedious'     (JS puro)        → padrão em Linux/macOS (e Docker)
const driver = process.env.DB_DRIVER || (process.platform === 'win32' ? 'msnodesqlv8' : 'tedious');
const sql = driver === 'msnodesqlv8' ? require('mssql/msnodesqlv8') : require('mssql');

const server   = process.env.DB_SERVER   || (driver === 'tedious' ? 'localhost' : '.\\SQLEXPRESS');
const database = process.env.DB_NAME     || 'GestorFlex';
const user     = process.env.DB_USER     || 'sa';
const password = process.env.DB_PASSWORD || '';
const pool     = { max: 10, min: 0, idleTimeoutMillis: 30000 };

let config;
if (driver === 'msnodesqlv8') {
  // Windows / ODBC
  config = {
    connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};UID=${user};PWD=${password};`,
    pool,
  };
} else {
  // tedious (Linux/macOS/Docker) — sem ODBC
  config = {
    server,                                   // hostname (ex: localhost). Instância nomeada via DB_INSTANCE
    port: parseInt(process.env.DB_PORT) || 1433,
    user, password, database,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',  // self-signed por padrão
      instanceName: process.env.DB_INSTANCE || undefined,
      enableArithAbort: true,
    },
    pool,
  };
}

let poolPromise = null;

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config);
    await poolPromise;
    console.log(`✅ SQL Server conectado (${driver}):`, server, '/', database);
  }
  return poolPromise;
}

// Atalhos para queries parametrizadas
async function query(text, params = {}) {
  const p = await getPool();
  const req = p.request();
  for (const [key, val] of Object.entries(params)) {
    req.input(key, val);
  }
  return req.query(text);
}

async function queryTyped(text, params = []) {
  // params = [{ name, type, value }]
  const p = await getPool();
  const req = p.request();
  for (const { name, type, value } of params) {
    req.input(name, type, value);
  }
  return req.query(text);
}

module.exports = { sql, getPool, query, queryTyped };
