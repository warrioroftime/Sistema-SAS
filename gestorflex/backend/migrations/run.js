// Aplica um arquivo .sql (dividindo em lotes por GO) usando a conexão do projeto
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool } = require('../src/db');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node migrations/run.js <arquivo.sql>'); process.exit(1); }
  const sqlText = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const batches = sqlText
    .split(/^\s*GO\s*$/gim)
    .map(b => b.trim())
    .filter(Boolean);

  const pool = await getPool();
  for (let i = 0; i < batches.length; i++) {
    try {
      await pool.request().batch(batches[i]);
    } catch (err) {
      console.error(`\n❌ Erro no lote ${i + 1}:\n`, batches[i], '\n', err.message);
      process.exit(1);
    }
  }
  console.log(`✅ Migração aplicada: ${file} (${batches.length} lotes)`);
  process.exit(0);
})();
