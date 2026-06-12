// migrate.js — migrates data from SQL Server Express to PostgreSQL
// Run: node migrate.js
require('dotenv').config();
const { execSync } = require('child_process');
const { Pool } = require('pg');

const SQLSERVER = 'localhost\\SQLEXPRESS';
const SQLDB = 'GestorFlex';
const pool = new Pool({
  host: 'localhost', port: 5432, database: 'gestorflex',
  user: 'postgres', password: 'Server123!',
});

function sqlQuery(sql) {
  const tmpFile = require('path').join(require('os').tmpdir(), `mig_${Date.now()}.json`);
  const jsonSql = `${sql} FOR JSON PATH, INCLUDE_NULL_VALUES`;
  // Write output to temp file to avoid console width truncation
  const cmd = `sqlcmd -S "${SQLSERVER}" -E -d ${SQLDB} -y 0 -Y 0 -Q "SET NOCOUNT ON; ${jsonSql}" -o "${tmpFile}"`;
  const fs = require('fs');
  try {
    execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    // sqlcmd wraps lines at 2033 chars; join to reconstruct full JSON
    const raw = fs.readFileSync(tmpFile, 'utf8').split(/\r?\n/).join('').trim();
    try { fs.unlinkSync(tmpFile); } catch {}
    if (!raw || raw === 'NULL') return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('sqlcmd error:', err.message.split('\n')[0]);
    return [];
  }
}

async function truncate(table) {
  await pool.query(`TRUNCATE ${table} CASCADE`);
}

async function resetSeq(table, col = 'id') {
  await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 1))`);
}

async function run() {
  console.log('=== Migração SQL Server → PostgreSQL ===\n');

  // ── Categorias ──────────────────────────────────────────────────
  console.log('Migrando categorias...');
  await truncate('categorias');
  const cats = sqlQuery('SELECT id, empresa_id, nome FROM Categorias');
  for (const r of cats) {
    await pool.query(
      'INSERT INTO categorias (id, empresa_id, nome) VALUES ($1,$2,$3)',
      [r.id, r.empresa_id, r.nome]
    );
  }
  await resetSeq('categorias');
  console.log(`  ✅ ${cats.length} categorias`);

  // ── Produtos ────────────────────────────────────────────────────
  console.log('Migrando produtos...');
  await truncate('produtos');
  const prods = sqlQuery('SELECT id, empresa_id, codigo, descricao, categoria_id, preco_custo, preco_venda, estoque, estoque_min, status, criado_em, atualizado_em, foto, controla_estoque, codigo_barras FROM Produtos');
  for (const r of prods) {
    await pool.query(
      `INSERT INTO produtos (id, empresa_id, codigo, descricao, categoria_id, preco_custo, preco_venda, estoque, estoque_min, status, criado_em, atualizado_em, foto, controla_estoque, codigo_barras)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [r.id, r.empresa_id, r.codigo || `PROD${r.id}`, r.descricao, r.categoria_id || null,
       r.preco_custo || 0, r.preco_venda || 0, r.estoque || 0, r.estoque_min || 0,
       r.status || 'ativo', r.criado_em || new Date(), r.atualizado_em || null,
       r.foto || null, r.controla_estoque === true || r.controla_estoque === 1, r.codigo_barras || null]
    );
  }
  await resetSeq('produtos');
  console.log(`  ✅ ${prods.length} produtos`);

  // ── Clientes ────────────────────────────────────────────────────
  console.log('Migrando clientes...');
  await truncate('clientes');
  const clients = sqlQuery('SELECT id, empresa_id, nome, nome_fantasia, documento, telefone, email, cep, endereco, numero, bairro, cidade, estado, ativo, criado_em, atualizado_em FROM Clientes');
  for (const r of clients) {
    await pool.query(
      `INSERT INTO clientes (id, empresa_id, nome, nome_fantasia, documento, telefone, email, cep, endereco, numero, bairro, cidade, estado, ativo, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [r.id, r.empresa_id, r.nome, r.nome_fantasia || null, r.documento || null,
       r.telefone || null, r.email || null, r.cep || null, r.endereco || null,
       r.numero || null, r.bairro || null, r.cidade || null, r.estado || null,
       r.ativo === true || r.ativo === 1, r.criado_em || new Date(), r.atualizado_em || null]
    );
  }
  await resetSeq('clientes');
  console.log(`  ✅ ${clients.length} clientes`);

  // ── Fornecedores ─────────────────────────────────────────────────
  console.log('Migrando fornecedores...');
  await pool.query('TRUNCATE fornecedores CASCADE');
  const forns = sqlQuery('SELECT id, empresa_id, nome, documento, telefone, email, endereco, cidade, estado, observacao, ativo, criado_em FROM Fornecedores');
  for (const r of forns) {
    await pool.query(
      'INSERT INTO fornecedores (id, empresa_id, nome, documento, telefone, email, endereco, cidade, estado, observacao, ativo, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [r.id, r.empresa_id, r.nome, r.documento || null, r.telefone || null,
       r.email || null, r.endereco || null, r.cidade || null, r.estado || null,
       r.observacao || null, r.ativo === true || r.ativo === 1, r.criado_em || new Date()]
    );
  }
  await resetSeq('fornecedores');
  console.log(`  ✅ ${forns.length} fornecedores`);

  // ── Caixa ────────────────────────────────────────────────────────
  console.log('Migrando caixa...');
  await pool.query('TRUNCATE caixa CASCADE');
  const caixas = sqlQuery('SELECT id, empresa_id, usuario_id, valor_abertura, data_abertura, valor_informado, valor_esperado, diferenca, data_fechamento, status, obs_abertura, obs_fechamento FROM Caixa');
  for (const r of caixas) {
    await pool.query(
      'INSERT INTO caixa (id, empresa_id, usuario_id, valor_abertura, data_abertura, valor_informado, valor_esperado, diferenca, data_fechamento, status, obs_abertura, obs_fechamento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [r.id, r.empresa_id, r.usuario_id, r.valor_abertura || 0, r.data_abertura || new Date(),
       r.valor_informado || null, r.valor_esperado || null, r.diferenca || null,
       r.data_fechamento || null, r.status || 'aberto', r.obs_abertura || null, r.obs_fechamento || null]
    );
  }
  await resetSeq('caixa');
  console.log(`  ✅ ${caixas.length} caixas`);

  // ── Vendas ───────────────────────────────────────────────────────
  console.log('Migrando vendas...');
  await pool.query('TRUNCATE vendas CASCADE');
  const vendas = sqlQuery('SELECT id, empresa_id, cliente_id, forma_pagamento_id, subtotal, desconto, total, observacao, usuario_id, status, status_cobranca, data_vencimento, data_recebimento, caixa_id, criado_em FROM Vendas');
  for (const r of vendas) {
    await pool.query(
      `INSERT INTO vendas (id, empresa_id, cliente_id, forma_pagamento_id, subtotal, desconto, total, observacao, usuario_id, status, status_cobranca, data_vencimento, data_recebimento, caixa_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [r.id, r.empresa_id, r.cliente_id || null, r.forma_pagamento_id,
       r.subtotal || 0, r.desconto || 0, r.total || 0, r.observacao || null,
       r.usuario_id, r.status || 'ativa', r.status_cobranca || null,
       r.data_vencimento || null, r.data_recebimento || null, r.caixa_id || null, r.criado_em || new Date()]
    );
  }
  await resetSeq('vendas');
  console.log(`  ✅ ${vendas.length} vendas`);

  // ── ItensVenda ───────────────────────────────────────────────────
  console.log('Migrando itensvenda...');
  const itensvenda = sqlQuery('SELECT iv.id, iv.venda_id, iv.produto_id, iv.quantidade, iv.preco_unit, iv.subtotal FROM ItensVenda iv INNER JOIN Produtos p ON p.id = iv.produto_id');
  let ivOk = 0;
  for (const r of itensvenda) {
    try {
      await pool.query(
        'INSERT INTO itensvenda (id, venda_id, produto_id, quantidade, preco_unit, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, r.venda_id, r.produto_id, r.quantidade, r.preco_unit, r.subtotal]
      );
      ivOk++;
    } catch (e) {
      console.warn(`  ⚠️  ItensVenda id=${r.id} ignorado: ${e.message.split('\n')[0]}`);
    }
  }
  await resetSeq('itensvenda');
  console.log(`  ✅ ${ivOk} itens de venda`);

  // ── VendaPagamentos ──────────────────────────────────────────────
  console.log('Migrando vendapagamentos...');
  await pool.query('TRUNCATE vendapagamentos CASCADE');
  const vps = sqlQuery('SELECT id, empresa_id, venda_id, forma_pagamento_id, forma, valor FROM VendaPagamentos');
  let vpOk = 0;
  for (const r of vps) {
    try {
      await pool.query(
        'INSERT INTO vendapagamentos (id, empresa_id, venda_id, forma_pagamento_id, forma, valor) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, r.empresa_id, r.venda_id, r.forma_pagamento_id || null, r.forma, r.valor || 0]
      );
      vpOk++;
    } catch (e) {
      console.warn(`  ⚠️  VendaPagamento id=${r.id} ignorado: ${e.message.split('\n')[0]}`);
    }
  }
  await resetSeq('vendapagamentos');
  console.log(`  ✅ ${vpOk} pagamentos de venda`);

  // ── MovimentacoesEstoque ─────────────────────────────────────────
  console.log('Migrando movimentacoesestoque...');
  await pool.query('TRUNCATE movimentacoesestoque CASCADE');
  const movs = sqlQuery('SELECT me.id, me.empresa_id, me.produto_id, me.tipo, me.quantidade, me.saldo_anterior, me.saldo_atual, me.origem, me.usuario_id, me.criado_em FROM MovimentacoesEstoque me INNER JOIN Produtos p ON p.id = me.produto_id');
  let movOk = 0;
  for (const r of movs) {
    try {
      await pool.query(
        'INSERT INTO movimentacoesestoque (id, empresa_id, produto_id, tipo, quantidade, saldo_anterior, saldo_atual, origem, usuario_id, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [r.id, r.empresa_id, r.produto_id, r.tipo, r.quantidade,
         r.saldo_anterior || 0, r.saldo_atual || 0, r.origem || null, r.usuario_id || null, r.criado_em || new Date()]
      );
      movOk++;
    } catch (e) {
      console.warn(`  ⚠️  Movimentacao id=${r.id} ignorado: ${e.message.split('\n')[0]}`);
    }
  }
  await resetSeq('movimentacoesestoque');
  console.log(`  ✅ ${movOk} movimentações de estoque`);

  // ── Devolucoes ───────────────────────────────────────────────────
  console.log('Migrando devolucoes...');
  await pool.query('TRUNCATE devolucoes CASCADE');
  const devols = sqlQuery('SELECT id, empresa_id, venda_id, tipo, valor, motivo, usuario_id, criado_em FROM Devolucoes');
  for (const r of devols) {
    await pool.query(
      'INSERT INTO devolucoes (id, empresa_id, venda_id, tipo, valor, motivo, usuario_id, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [r.id, r.empresa_id, r.venda_id, r.tipo, r.valor || 0, r.motivo || null, r.usuario_id || null, r.criado_em || new Date()]
    );
  }
  await resetSeq('devolucoes');
  console.log(`  ✅ ${devols.length} devoluções`);

  // ── ItensDevolucao ───────────────────────────────────────────────
  console.log('Migrando itensdevolucao...');
  const idvs = sqlQuery('SELECT id, devolucao_id, produto_id, quantidade, preco_unit, subtotal FROM ItensDevolucao');
  let idvOk = 0;
  for (const r of idvs) {
    try {
      await pool.query(
        'INSERT INTO itensdevolucao (id, devolucao_id, produto_id, quantidade, preco_unit, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, r.devolucao_id, r.produto_id, r.quantidade, r.preco_unit, r.subtotal]
      );
      idvOk++;
    } catch (e) {}
  }
  await resetSeq('itensdevolucao');
  console.log(`  ✅ ${idvOk} itens de devolução`);

  // ── ContasReceber ─────────────────────────────────────────────────
  console.log('Migrando contasreceber...');
  await pool.query('TRUNCATE contasreceber CASCADE');
  const crs = sqlQuery('SELECT id, empresa_id, venda_id, cliente_id, numero_documento, parcela_num, parcelas_total, valor, data_emissao, data_vencimento, status, observacao, criado_por, criado_em FROM ContasReceber');
  for (const r of crs) {
    await pool.query(
      `INSERT INTO contasreceber (id, empresa_id, venda_id, cliente_id, numero_documento, parcela_num, parcelas_total, valor, data_emissao, data_vencimento, status, observacao, criado_por, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [r.id, r.empresa_id, r.venda_id || null, r.cliente_id || null, r.numero_documento || null,
       r.parcela_num || null, r.parcelas_total || null, r.valor || 0,
       r.data_emissao || null, r.data_vencimento, r.status, r.observacao || null,
       r.criado_por || null, r.criado_em || new Date()]
    );
  }
  await resetSeq('contasreceber');
  console.log(`  ✅ ${crs.length} contas a receber`);

  // ── RecebimentosContas ────────────────────────────────────────────
  console.log('Migrando recebimentoscontas...');
  await pool.query('TRUNCATE recebimentoscontas CASCADE');
  const recs = sqlQuery('SELECT id, empresa_id, conta_id, valor_principal, juros, multa, desconto, acrescimo, valor_recebido, forma_pagamento, data_recebimento, usuario_id, caixa_id, observacao, estornado, criado_em FROM RecebimentosContas');
  for (const r of recs) {
    await pool.query(
      `INSERT INTO recebimentoscontas (id, empresa_id, conta_id, valor_principal, juros, multa, desconto, acrescimo, valor_recebido, forma_pagamento, data_recebimento, usuario_id, caixa_id, observacao, estornado, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [r.id, r.empresa_id, r.conta_id, r.valor_principal || 0, r.juros || 0,
       r.multa || 0, r.desconto || 0, r.acrescimo || 0, r.valor_recebido || 0,
       r.forma_pagamento, r.data_recebimento || new Date(), r.usuario_id || null,
       r.caixa_id || null, r.observacao || null, r.estornado === true || r.estornado === 1, r.criado_em || new Date()]
    );
  }
  await resetSeq('recebimentoscontas');
  console.log(`  ✅ ${recs.length} recebimentos de contas`);

  // ── ContasPagar ───────────────────────────────────────────────────
  console.log('Migrando contaspagar...');
  await pool.query('TRUNCATE contaspagar CASCADE');
  const cps = sqlQuery('SELECT id, empresa_id, fornecedor, categoria, descricao, numero_documento, parcela_num, parcelas_total, valor, data_emissao, data_vencimento, status, data_pagamento, valor_pago, observacao, tipo, criado_por, criado_em FROM ContasPagar');
  for (const r of cps) {
    await pool.query(
      `INSERT INTO contaspagar (id, empresa_id, fornecedor, categoria, descricao, numero_documento, parcela_num, parcelas_total, valor, data_emissao, data_vencimento, status, data_pagamento, valor_pago, observacao, tipo, criado_por, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [r.id, r.empresa_id, r.fornecedor || null, r.categoria || null,
       r.descricao || null, r.numero_documento || null, r.parcela_num || 1, r.parcelas_total || 1,
       r.valor || 0, r.data_emissao || null, r.data_vencimento || null,
       r.status || 'pendente', r.data_pagamento || null, r.valor_pago || null,
       r.observacao || null, r.tipo || null, r.criado_por || null, r.criado_em || new Date()]
    );
  }
  await resetSeq('contaspagar');
  console.log(`  ✅ ${cps.length} contas a pagar`);

  // ── PagamentosContasPagar ─────────────────────────────────────────
  console.log('Migrando pagamentoscontaspagar...');
  await pool.query('TRUNCATE pagamentoscontaspagar CASCADE');
  const pcps = sqlQuery('SELECT id, empresa_id, conta_id, valor_pago, forma_pagamento, data_pagamento, usuario_id, caixa_id, observacao, estornado, criado_em FROM PagamentosContasPagar');
  for (const r of pcps) {
    await pool.query(
      `INSERT INTO pagamentoscontaspagar (id, empresa_id, conta_id, valor_pago, forma_pagamento, data_pagamento, usuario_id, caixa_id, observacao, estornado, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.id, r.empresa_id, r.conta_id, r.valor_pago || 0, r.forma_pagamento,
       r.data_pagamento || new Date(), r.usuario_id || null, r.caixa_id || null,
       r.observacao || null, r.estornado === true || r.estornado === 1, r.criado_em || new Date()]
    );
  }
  await resetSeq('pagamentoscontaspagar');
  console.log(`  ✅ ${pcps.length} pagamentos de contas`);

  // ── Compras ───────────────────────────────────────────────────────
  console.log('Migrando compras...');
  await pool.query('TRUNCATE compras CASCADE');
  const compras = sqlQuery('SELECT id, empresa_id, fornecedor_id, numero_documento, total, observacao, gerou_conta_pagar, usuario_id, criado_em FROM Compras');
  for (const r of compras) {
    try {
      await pool.query(
        'INSERT INTO compras (id, empresa_id, fornecedor_id, numero_documento, total, observacao, gerou_conta_pagar, usuario_id, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [r.id, r.empresa_id, r.fornecedor_id || null, r.numero_documento || null, r.total || 0,
         r.observacao || null, r.gerou_conta_pagar === true || r.gerou_conta_pagar === 1,
         r.usuario_id || null, r.criado_em || new Date()]
      );
    } catch (e) {
      console.warn(`  ⚠️  Compra id=${r.id} ignorado: ${e.message.split('\n')[0]}`);
    }
  }
  await resetSeq('compras');
  console.log(`  ✅ ${compras.length} compras`);

  // ── ItensCompra ───────────────────────────────────────────────────
  console.log('Migrando itenscompra...');
  const ics = sqlQuery('SELECT ic.id, ic.compra_id, ic.produto_id, ic.quantidade, ic.custo_unit, ic.subtotal FROM ItensCompra ic INNER JOIN Produtos p ON p.id = ic.produto_id');
  let icOk = 0;
  for (const r of ics) {
    try {
      await pool.query(
        'INSERT INTO itenscompra (id, compra_id, produto_id, quantidade, custo_unit, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.id, r.compra_id, r.produto_id, r.quantidade, r.custo_unit, r.subtotal]
      );
      icOk++;
    } catch (e) {}
  }
  await resetSeq('itenscompra');
  console.log(`  ✅ ${icOk} itens de compra`);

  // ── MovimentacoesCaixa ────────────────────────────────────────────
  console.log('Migrando movimentacoescaixa...');
  await pool.query('TRUNCATE movimentacoescaixa CASCADE');
  const mcs = sqlQuery('SELECT id, caixa_id, empresa_id, tipo, valor, descricao, usuario_id, criado_em FROM MovimentacoesCaixa');
  for (const r of mcs) {
    try {
      await pool.query(
        'INSERT INTO movimentacoescaixa (id, caixa_id, empresa_id, tipo, valor, descricao, usuario_id, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [r.id, r.caixa_id, r.empresa_id, r.tipo, r.valor || 0, r.descricao || null,
         r.usuario_id || null, r.criado_em || new Date()]
      );
    } catch (e) {
      console.warn(`  ⚠️  MovCaixa id=${r.id} ignorado: ${e.message.split('\n')[0]}`);
    }
  }
  await resetSeq('movimentacoescaixa');
  console.log(`  ✅ ${mcs.length} movimentações de caixa`);

  // ── Resultado final ───────────────────────────────────────────────
  console.log('\n=== Verificação final ===');
  const tables = ['categorias','produtos','clientes','vendas','itensvenda','contasreceber','contaspagar','fornecedores','compras'];
  for (const t of tables) {
    const r = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0].n}`);
  }

  await pool.end();
  console.log('\n✅ Migração concluída!');
}

run().catch(err => {
  console.error('Erro fatal:', err);
  pool.end();
  process.exit(1);
});
