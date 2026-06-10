// setup-db.js — Cria o banco e aplica schema.sql + todas as migrations.
// Usa o driver tedious (multiplataforma). Ideal para Linux/Docker.
//   node setup-db.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const DBNAME = process.env.DB_NAME || 'GestorFlex';
const base = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    instanceName: process.env.DB_INSTANCE || undefined,
    enableArithAbort: true,
  },
  pool: { max: 1, min: 1, idleTimeoutMillis: 30000 }, // max:1 => USE/contexto persiste entre lotes
};

async function runFile(pool, file) {
  const text = fs.readFileSync(file, 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);
  for (let i = 0; i < batches.length; i++) {
    try { await pool.request().batch(batches[i]); }
    catch (err) { console.error(`\n❌ Erro em ${path.basename(file)} (lote ${i + 1}): ${err.message}`); throw err; }
  }
  console.log(`   • ${path.basename(file)} (${batches.length} lotes)`);
}

(async () => {
  console.log(`Conectando em ${base.server}:${base.port} ...`);

  // 1) master: garante o banco criado
  let pool = await new sql.ConnectionPool({ ...base, database: 'master' }).connect();
  await pool.request().batch(
    `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name='${DBNAME}') CREATE DATABASE [${DBNAME}];`
  );
  await pool.close();
  console.log(`✅ Banco "${DBNAME}" pronto.`);

  // 2) GestorFlex: schema + migrations (em ordem)
  pool = await new sql.ConnectionPool({ ...base, database: DBNAME }).connect();
  console.log('Aplicando schema e migrations:');
  await runFile(pool, path.join(__dirname, 'schema.sql'));

  const migDir = path.join(__dirname, 'migrations');
  const migs = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const m of migs) await runFile(pool, path.join(migDir, m));

  await pool.close();
  console.log('\n✅ Banco preparado com sucesso. Login: admin@gestorflex.com / admin123');
  process.exit(0);
})().catch(e => { console.error('❌ Falha:', e.message); process.exit(1); });
