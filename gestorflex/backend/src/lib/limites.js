// src/lib/limites.js — Enforcement dos limites do plano SaaS por empresa
const { query } = require('../db');

const MATRIZ_ID = 1;   // empresa 1 = matriz (ilimitada)

function erroLimite(msg) {
  const e = new Error(msg);
  e.statusCode = 403;
  return e;
}

async function getEmpresa(emp) {
  const r = await query(
    `SELECT status, limite_usuarios, limite_produtos, limite_clientes, limite_armazenamento
     FROM Empresas WHERE id=@id`, { id: emp });
  return r.recordset[0] || null;
}

const TIPOS = {
  usuarios: { col: 'limite_usuarios', sql: 'SELECT COUNT(*) AS n FROM Usuarios  WHERE empresa_id=@id AND ativo=TRUE', label: 'usuários' },
  produtos: { col: 'limite_produtos', sql: 'SELECT COUNT(*) AS n FROM Produtos  WHERE empresa_id=@id',            label: 'produtos' },
  clientes: { col: 'limite_clientes', sql: 'SELECT COUNT(*) AS n FROM Clientes  WHERE empresa_id=@id AND ativo=TRUE', label: 'clientes' },
};

// Lança erro 403 se a criação exceder o limite do plano
async function checarLimite(emp, tipo) {
  if (Number(emp) === MATRIZ_ID) return;            // matriz: sem limite
  const empresa = await getEmpresa(emp);
  if (!empresa) return;
  const t = TIPOS[tipo];
  const limite = empresa[t.col];
  if (limite == null) return;                        // limite em branco = ilimitado

  const c = await query(t.sql, { id: emp });
  if ((c.recordset[0].n || 0) >= limite) {
    throw erroLimite(`Limite de ${t.label} do plano atingido (${limite}). Faça upgrade do plano para cadastrar mais.`);
  }
}

// Bytes ocupados por uma string que será gravada em NVARCHAR (UTF-16)
function bytesNVARCHAR(str) {
  return str ? Buffer.byteLength(str, 'utf16le') : 0;
}

// Lança erro 403 se a nova foto estourar o limite de armazenamento (MB)
async function checarArmazenamento(emp, novaFoto) {
  if (Number(emp) === MATRIZ_ID) return;
  const empresa = await getEmpresa(emp);
  if (!empresa || empresa.limite_armazenamento == null) return;  // ilimitado

  const limiteBytes = empresa.limite_armazenamento * 1024 * 1024;
  const r = await query(`
    SELECT
      COALESCE((SELECT SUM(OCTET_LENGTH(foto)) FROM Produtos WHERE empresa_id=@id AND foto IS NOT NULL),0)
    + COALESCE((SELECT SUM(OCTET_LENGTH(foto)) FROM Usuarios WHERE empresa_id=@id AND foto IS NOT NULL),0) AS usado
  `, { id: emp });
  const usado = Number(r.recordset[0].usado) || 0;

  if (usado + bytesNVARCHAR(novaFoto) > limiteBytes) {
    throw erroLimite(`Limite de armazenamento do plano atingido (${empresa.limite_armazenamento} MB). Remova arquivos ou faça upgrade do plano.`);
  }
}

module.exports = { checarLimite, checarArmazenamento, MATRIZ_ID };
