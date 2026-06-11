// setup-db.js — Cria o banco e aplica schema.sql + todas as migrations.
// Multiplataforma: escolhe o driver igual ao src/db.js.
//   - 'msnodesqlv8' (ODBC, Windows)  → padrão no Windows (suporta instância nomeada .\SQLEXPRESS)
//   - 'tedious'     (JS puro)        → padrão em Linux/macOS/Docker
//   node setup-db.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const driver = process.env.DB_DRIVER || (process.platform === 'win32' ? 'msnodesqlv8' : 'tedious');
const sql = driver === 'msnodesqlv8' ? require('mssql/msnodesqlv8') : require('mssql');

const DBNAME   = process.env.DB_NAME || 'GestorFlex';
const server   = process.env.DB_SERVER || (driver === 'tedious' ? 'localhost' : '.\\SQLEXPRESS');
const user     = process.env.DB_USER !== undefined ? process.env.DB_USER : 'sa';
const password = process.env.DB_PASSWORD || '';
const pool     = { max: 1, min: 1, idleTimeoutMillis: 30000 }; // max:1 => USE/contexto persiste entre lotes

// Constrói a config de conexão para um banco específico, conforme o driver.
function configFor(database) {
  if (driver === 'msnodesqlv8') {
    // Windows / ODBC — usa Trusted_Connection quando não há usuário definido
    const authPart = user ? `UID=${user};PWD=${password};` : `Trusted_Connection=yes;`;
    return {
      connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};${authPart}`,
      pool,
    };
  }
  // tedious (Linux/macOS/Docker) — sem ODBC; instância nomeada via DB_INSTANCE
  return {
    server,
    port: parseInt(process.env.DB_PORT) || 1433,
    user, password, database,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
      instanceName: process.env.DB_INSTANCE || undefined,
      enableArithAbort: true,
    },
    pool,
  };
}

async function runFile(p, file) {
  const text = fs.readFileSync(file, 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(Boolean);
  for (let i = 0; i < batches.length; i++) {
    try { await p.request().batch(batches[i]); }
    catch (err) { console.error(`\n❌ Erro em ${path.basename(file)} (lote ${i + 1}): ${err.message}`); throw err; }
  }
  console.log(`   • ${path.basename(file)} (${batches.length} lotes)`);
}

(async () => {
  console.log(`Conectando (${driver}) em ${server} ...`);

  // 1) master: garante o banco criado
  let p = await new sql.ConnectionPool(configFor('master')).connect();
  await p.request().batch(
    `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name='${DBNAME}') CREATE DATABASE [${DBNAME}];`
  );
  await p.close();
  console.log(`✅ Banco "${DBNAME}" pronto.`);

  // 2) GestorFlex: schema + migrations (em ordem)
  p = await new sql.ConnectionPool(configFor(DBNAME)).connect();
  console.log('Aplicando schema e migrations:');
  await runFile(p, path.join(__dirname, 'schema.sql'));

  const migDir = path.join(__dirname, 'migrations');
  const migs = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const m of migs) await runFile(p, path.join(migDir, m));

  await p.close();
  console.log('\n✅ Banco preparado com sucesso. Login: admin@gestorflex.com / admin123');
  process.exit(0);
})().catch(e => { console.error('❌ Falha:', e.message); process.exit(1); });
