// setup-db.js — Cria o banco PostgreSQL e aplica schema.sql + todas as migrations.
//   node setup-db.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

const DBNAME   = process.env.DB_NAME     || 'gestorflex';
const host     = process.env.DB_HOST     || 'localhost';
const port     = parseInt(process.env.DB_PORT) || 5432;
const user     = process.env.DB_USER     || 'postgres';
const password = process.env.DB_PASSWORD || '';

async function runFile(client, file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    await client.query(text);
  } catch (err) {
    console.error(`\n❌ Erro em ${path.basename(file)}: ${err.message}`);
    throw err;
  }
  console.log(`   • ${path.basename(file)}`);
}

(async () => {
  console.log(`Conectando em ${host}:${port} ...`);

  // 1) Conectar ao banco padrão 'postgres' para criar o banco alvo
  const admin = new Client({ host, port, user, password, database: 'postgres' });
  await admin.connect();

  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [DBNAME]);
  if (!exists.rows.length) {
    await admin.query(`CREATE DATABASE "${DBNAME}"`);
    console.log(`✅ Banco "${DBNAME}" criado.`);
  } else {
    console.log(`✅ Banco "${DBNAME}" já existe.`);
  }
  await admin.end();

  // 2) Conectar ao banco alvo e aplicar schema + migrations
  const client = new Client({ host, port, user, password, database: DBNAME });
  await client.connect();
  console.log('Aplicando schema e migrations:');

  await runFile(client, path.join(__dirname, 'schema.sql'));

  const migDir = path.join(__dirname, 'migrations');
  const migs = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const m of migs) await runFile(client, path.join(migDir, m));

  await client.end();
  console.log('\n✅ Banco preparado com sucesso. Login: admin@gestorflex.com / admin123');
  process.exit(0);
})().catch(e => { console.error('❌ Falha:', e.message); process.exit(1); });
