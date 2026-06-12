// src/routes/vendas.js
const router = require('express').Router();
const { query, getPool, clientQuery } = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/vendas?de=&ate=&pagamento=&cliente_id=&busca=&page=1&limit=50
router.get('/', auth, async (req, res) => {
  try {
    const { de, ate, pagamento, cliente_id, busca = '', page = 1, limit = 100 } = req.query;
    let where = `v.empresa_id = @emp`;
    const params = { emp: req.user.empresa_id };

    if (de)          { where += ` AND v.criado_em >= @de`;   params.de  = new Date(de + 'T00:00:00'); }
    if (ate)         { where += ` AND v.criado_em <= @ate`;  params.ate = new Date(ate + 'T23:59:59'); }
    if (pagamento)   { where += ` AND fp.nome = @pgto`;      params.pgto = pagamento; }
    if (cliente_id)  { where += ` AND v.cliente_id = @cid`;  params.cid  = parseInt(cliente_id); }
    if (busca)       { where += ` AND (v.id::TEXT LIKE @b OR c.nome LIKE @b)`; params.b = `%${busca}%`; }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const r = await query(`
      SELECT v.id, v.criado_em, v.subtotal, v.desconto, v.total, v.observacao, v.status,
             fp.nome AS pagamento,
             c.id   AS cliente_id,
             c.nome AS cliente_nome,
             (SELECT COUNT(*) FROM ItensVenda WHERE venda_id = v.id) AS qtd_itens,
             (SELECT COUNT(*) FROM Devolucoes WHERE venda_id = v.id) AS qtd_devolucoes
      FROM Vendas v
      LEFT JOIN Clientes          c  ON c.id  = v.cliente_id
      LEFT JOIN FormasPagamento   fp ON fp.id = v.forma_pagamento_id
      WHERE ${where}
      ORDER BY v.criado_em DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `, params);

    const tot = await query(
      `SELECT COUNT(*) AS n FROM Vendas v
       LEFT JOIN Clientes c ON c.id=v.cliente_id
       LEFT JOIN FormasPagamento fp ON fp.id=v.forma_pagamento_id
       WHERE ${where}`, params
    );

    res.json({ data: r.recordset, total: tot.recordset[0].n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar vendas.' });
  }
});

// GET /api/vendas/:id — detalhe completo com itens
router.get('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const venda = await query(`
      SELECT v.id, v.criado_em, v.subtotal, v.desconto, v.total, v.observacao, v.status,
             fp.nome AS pagamento,
             c.id AS cliente_id, c.nome AS cliente_nome, c.documento AS cliente_doc
      FROM Vendas v
      LEFT JOIN Clientes        c  ON c.id  = v.cliente_id
      LEFT JOIN FormasPagamento fp ON fp.id = v.forma_pagamento_id
      WHERE v.id = @id AND v.empresa_id = @emp
    `, { id, emp: req.user.empresa_id });

    if (!venda.recordset[0]) return res.status(404).json({ error: 'Venda não encontrada.' });

    const itens = await query(`
      SELECT iv.id, iv.quantidade, iv.preco_unit, iv.subtotal,
             p.id AS produto_id, p.codigo, p.descricao,
             COALESCE((SELECT SUM(idv.quantidade) FROM ItensDevolucao idv
                       JOIN Devolucoes d ON d.id=idv.devolucao_id
                       WHERE d.venda_id=@id AND idv.produto_id=p.id),0) AS qtd_devolvida
      FROM ItensVenda iv
      JOIN Produtos p ON p.id = iv.produto_id
      WHERE iv.venda_id = @id
    `, { id });

    const devolucoes = await query(`
      SELECT d.id, d.tipo, d.valor, d.motivo, d.criado_em, u.nome AS usuario
      FROM Devolucoes d LEFT JOIN Usuarios u ON u.id=d.usuario_id
      WHERE d.venda_id=@id ORDER BY d.criado_em DESC
    `, { id });

    res.json({ ...venda.recordset[0], itens: itens.recordset, devolucoes: devolucoes.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar venda.' });
  }
});

// POST /api/vendas — cria venda + baixa estoque (tudo em transaction)
router.post('/', auth, async (req, res) => {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const { cliente_id, pagamento, itens, desconto = 0, observacao = '' } = req.body;

    if (!itens || !itens.length) {
      return res.status(400).json({ error: 'A venda precisa ter pelo menos um item.' });
    }
    if (!pagamento) {
      return res.status(400).json({ error: 'Forma de pagamento obrigatória.' });
    }
    if (pagamento === 'fiado' && !cliente_id) {
      return res.status(400).json({ error: 'Venda a prazo (fiado) exige um cliente selecionado.' });
    }

    const cxOpen = await query(
      `SELECT id FROM Caixa WHERE empresa_id=@emp AND usuario_id=@uid AND status='aberto' ORDER BY id DESC LIMIT 1`,
      { emp: req.user.empresa_id, uid: req.user.id }
    );
    const caixaId = cxOpen.recordset[0] ? cxOpen.recordset[0].id : null;

    await client.query('BEGIN');

    const fpR = await clientQuery(client, 'SELECT id FROM FormasPagamento WHERE nome=@pgto', { pgto: pagamento });
    if (!fpR.recordset.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    }
    const fpId = fpR.recordset[0].id;

    // Verificar estoque
    for (const item of itens) {
      const estR = await clientQuery(client,
        `SELECT estoque, descricao, controla_estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp AND status='ativo'`,
        { pid: item.produto_id, emp: req.user.empresa_id }
      );
      if (!estR.recordset.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Produto ID ${item.produto_id} não encontrado ou inativo.` });
      }
      const prod = estR.recordset[0];
      if (prod.controla_estoque && prod.estoque < item.quantidade) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Estoque insuficiente para "${prod.descricao}". Disponível: ${prod.estoque}.`
        });
      }
    }

    const isFiado = pagamento === 'fiado';
    const dataVencimento = req.body.data_vencimento || null;
    const parcelas = isFiado ? (parseInt(req.body.parcelas) || 1) : 1;

    // Calcular totais
    let subtotal = 0;
    const itensPreco = [];
    for (const item of itens) {
      const pR = await clientQuery(client, 'SELECT preco_venda FROM Produtos WHERE id=@pid AND empresa_id=@emp',
        { pid: item.produto_id, emp: req.user.empresa_id });
      const preco = pR.recordset[0].preco_venda;
      const sub = preco * item.quantidade;
      subtotal += sub;
      itensPreco.push({ ...item, preco_unit: preco, subtotal: sub });
    }

    const desc  = parseFloat(desconto) || 0;
    const total = Math.max(subtotal - desc, 0);

    let pagamentosList = Array.isArray(req.body.pagamentos) && req.body.pagamentos.length
      ? req.body.pagamentos.map(p => ({ forma: p.forma, valor: +(parseFloat(p.valor) || 0).toFixed(2) })).filter(p => p.forma && p.valor > 0)
      : [{ forma: pagamento, valor: total }];
    if (!pagamentosList.length) pagamentosList = [{ forma: pagamento, valor: total }];
    if (pagamentosList.length > 1) {
      const soma = +pagamentosList.reduce((s, p) => s + p.valor, 0).toFixed(2);
      if (Math.abs(soma - total) > 0.05) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `A soma das formas de pagamento (R$ ${soma.toFixed(2)}) difere do total da venda (R$ ${total.toFixed(2)}).` });
      }
    }

    // Inserir venda
    const vR = await clientQuery(client, `
      INSERT INTO Vendas (empresa_id, cliente_id, forma_pagamento_id, subtotal, desconto, total, observacao, usuario_id, status_cobranca, data_vencimento, data_recebimento, caixa_id)
      VALUES (@emp, @cid, @fp, @sub, @desc, @tot, @obs, @uid, @stcob, @dvenc, @drec, @cxid)
      RETURNING id
    `, {
      emp: req.user.empresa_id, cid: cliente_id || null, fp: fpId,
      sub: subtotal, desc, tot: total, obs: observacao || null,
      uid: req.user.id, stcob: isFiado ? 'pendente' : 'recebido',
      dvenc: dataVencimento ? new Date(dataVencimento) : null,
      drec: isFiado ? null : new Date(), cxid: caixaId
    });
    const vendaId = vR.recordset[0].id;

    // Inserir itens + baixar estoque
    for (const item of itensPreco) {
      await clientQuery(client,
        `INSERT INTO ItensVenda (venda_id,produto_id,quantidade,preco_unit,subtotal) VALUES (@vid,@pid,@qty,@pu,@sub)`,
        { vid: vendaId, pid: item.produto_id, qty: item.quantidade, pu: item.preco_unit, sub: item.subtotal }
      );

      const ceR = await clientQuery(client,
        `SELECT estoque, controla_estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp`,
        { pid: item.produto_id, emp: req.user.empresa_id }
      );
      const controla = ceR.recordset[0]?.controla_estoque;
      if (controla) {
        const saldoAnt = ceR.recordset[0].estoque;
        const saldoAtual = saldoAnt - item.quantidade;
        await clientQuery(client,
          `UPDATE Produtos SET estoque=estoque-@qty, atualizado_em=NOW() WHERE id=@pid AND empresa_id=@emp`,
          { qty: item.quantidade, pid: item.produto_id, emp: req.user.empresa_id }
        );
        await clientQuery(client,
          `INSERT INTO MovimentacoesEstoque (empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_atual,origem,usuario_id) VALUES (@emp,@pid,'saida',@qty,@sant,@sat,@orig,@uid)`,
          { emp: req.user.empresa_id, pid: item.produto_id, qty: item.quantidade,
            sant: saldoAnt, sat: saldoAtual, orig: `Venda #${vendaId}`, uid: req.user.id }
        );
      }
    }

    // Registrar formas de pagamento
    const fpMapR = await clientQuery(client, 'SELECT id, nome FROM FormasPagamento', {});
    const fpMap = {}; fpMapR.recordset.forEach(f => { fpMap[f.nome] = f.id; });
    for (const pg of pagamentosList) {
      await clientQuery(client,
        `INSERT INTO VendaPagamentos (empresa_id,venda_id,forma_pagamento_id,forma,valor) VALUES (@emp,@vid,@fpid,@forma,@valor)`,
        { emp: req.user.empresa_id, vid: vendaId, fpid: fpMap[pg.forma] || null, forma: pg.forma, valor: pg.valor }
      );
    }

    await client.query('COMMIT');

    // Gerar parcelas no ContasReceber se for fiado
    if (isFiado) {
      const valorParcela = +(total / parcelas).toFixed(2);
      const primeiroVenc = dataVencimento ? new Date(dataVencimento) : new Date(Date.now() + 30*86400000);
      for (let i = 0; i < parcelas; i++) {
        const venc = new Date(primeiroVenc);
        venc.setMonth(venc.getMonth() + i);
        const valor = i === parcelas - 1
          ? +(total - valorParcela * (parcelas - 1)).toFixed(2)
          : valorParcela;
        const numDoc = `V${vendaId}-${i+1}/${parcelas}`;
        await query(
          `INSERT INTO ContasReceber (empresa_id,venda_id,cliente_id,numero_documento,parcela_num,parcelas_total,valor,data_emissao,data_vencimento,status,observacao,criado_por)
           VALUES (@emp,@vid,@cid,@ndoc,@pn,@pt,@val,NOW(),@dvenc,'pendente',@obs,@uid)`,
          { emp: req.user.empresa_id, vid: vendaId, cid: cliente_id||null, ndoc: numDoc,
            pn: i+1, pt: parcelas, val: valor, dvenc: venc, obs: observacao||null, uid: req.user.id }
        );
      }
    }

    const full = await query(`
      SELECT v.id, v.criado_em, v.subtotal, v.desconto, v.total, v.observacao,
             fp.nome AS pagamento,
             c.id AS cliente_id, c.nome AS cliente_nome
      FROM Vendas v
      LEFT JOIN Clientes c ON c.id=v.cliente_id
      LEFT JOIN FormasPagamento fp ON fp.id=v.forma_pagamento_id
      WHERE v.id=@id
    `, { id: vendaId });

    const itensR = await query(`
      SELECT iv.quantidade, iv.preco_unit, iv.subtotal, p.codigo, p.descricao
      FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
      WHERE iv.venda_id=@id
    `, { id: vendaId });

    res.status(201).json({ ...full.recordset[0], itens: itensR.recordset });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar venda.' });
  } finally {
    client.release();
  }
});

// Helper: devolve estoque dentro de uma transação (pg.PoolClient)
async function devolverEstoque(client, emp, uid, produtoId, qtd, origem) {
  const ceR = await clientQuery(client,
    `SELECT estoque, controla_estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp`,
    { pid: produtoId, emp }
  );
  if (!ceR.recordset[0] || !ceR.recordset[0].controla_estoque) return;
  const saldoAnt = ceR.recordset[0].estoque;
  const saldoAtual = saldoAnt + qtd;
  await clientQuery(client,
    `UPDATE Produtos SET estoque=estoque+@qty, atualizado_em=NOW() WHERE id=@pid AND empresa_id=@emp`,
    { qty: qtd, pid: produtoId, emp }
  );
  await clientQuery(client,
    `INSERT INTO MovimentacoesEstoque (empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_atual,origem,usuario_id)
     VALUES (@emp,@pid,'entrada',@qty,@sant,@sat,@orig,@uid)`,
    { emp, pid: produtoId, qty: qtd, sant: saldoAnt, sat: saldoAtual, orig: origem, uid }
  );
}

// POST /api/vendas/:id/cancelar
router.post('/:id/cancelar', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const emp = req.user.empresa_id;
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const vR = await query(`SELECT id, total, status FROM Vendas WHERE id=@id AND empresa_id=@emp`, { id, emp });
    const venda = vR.recordset[0];
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada.' });
    if (venda.status === 'cancelada') return res.status(400).json({ error: 'Venda já está cancelada.' });

    const itensR = await query(`SELECT produto_id, quantidade, preco_unit, subtotal FROM ItensVenda WHERE venda_id=@id`, { id });

    await client.query('BEGIN');
    for (const it of itensR.recordset) {
      await devolverEstoque(client, emp, req.user.id, it.produto_id, it.quantidade, `Cancelamento Venda #${id}`);
    }
    await clientQuery(client, `UPDATE Vendas SET status='cancelada' WHERE id=@id`, { id });
    await clientQuery(client, `UPDATE ContasReceber SET status='cancelado' WHERE venda_id=@id AND status IN ('pendente','parcial')`, { id });

    const dR = await clientQuery(client,
      `INSERT INTO Devolucoes (empresa_id,venda_id,tipo,valor,motivo,usuario_id)
       VALUES (@emp,@vid,'total',@val,@mot,@uid) RETURNING id`,
      { emp, vid: id, val: venda.total, mot: req.body.motivo || 'Cancelamento da venda', uid: req.user.id }
    );
    const devId = dR.recordset[0].id;
    for (const it of itensR.recordset) {
      await clientQuery(client,
        `INSERT INTO ItensDevolucao (devolucao_id,produto_id,quantidade,preco_unit,subtotal) VALUES (@did,@pid,@qty,@pu,@sub)`,
        { did: devId, pid: it.produto_id, qty: it.quantidade, pu: it.preco_unit, sub: it.subtotal }
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, valor_devolvido: venda.total });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar venda.' });
  } finally {
    client.release();
  }
});

// POST /api/vendas/:id/devolver — devolução parcial
router.post('/:id/devolver', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const emp = req.user.empresa_id;
  const { itens = [], motivo = '' } = req.body;
  if (!itens.length) return res.status(400).json({ error: 'Selecione ao menos um item para devolver.' });

  const pool = await getPool();
  const client = await pool.connect();
  try {
    const vR = await query(`SELECT id, status FROM Vendas WHERE id=@id AND empresa_id=@emp`, { id, emp });
    const venda = vR.recordset[0];
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada.' });
    if (venda.status === 'cancelada') return res.status(400).json({ error: 'Venda cancelada não pode ter devolução.' });

    const vendidosR = await query(`
      SELECT iv.produto_id, iv.quantidade, iv.preco_unit,
             COALESCE((SELECT SUM(idv.quantidade) FROM ItensDevolucao idv
                       JOIN Devolucoes d ON d.id=idv.devolucao_id
                       WHERE d.venda_id=@id AND idv.produto_id=iv.produto_id),0) AS qtd_devolvida
      FROM ItensVenda iv WHERE iv.venda_id=@id
    `, { id });
    const mapa = {};
    vendidosR.recordset.forEach(r => { mapa[r.produto_id] = r; });

    const aDevolver = [];
    for (const it of itens) {
      const base = mapa[it.produto_id];
      const qtd = parseInt(it.quantidade) || 0;
      if (!base || qtd <= 0) continue;
      const disp = base.quantidade - base.qtd_devolvida;
      if (qtd > disp) {
        return res.status(400).json({ error: `Quantidade a devolver excede o disponível (produto ${it.produto_id}: máx ${disp}).` });
      }
      aDevolver.push({ produto_id: it.produto_id, quantidade: qtd, preco_unit: base.preco_unit, subtotal: +(qtd * base.preco_unit).toFixed(2) });
    }
    if (!aDevolver.length) return res.status(400).json({ error: 'Nenhuma quantidade válida para devolver.' });
    const valorTotal = +aDevolver.reduce((s, i) => s + i.subtotal, 0).toFixed(2);

    await client.query('BEGIN');
    for (const it of aDevolver) {
      await devolverEstoque(client, emp, req.user.id, it.produto_id, it.quantidade, `Devolução Venda #${id}`);
    }
    const dR = await clientQuery(client,
      `INSERT INTO Devolucoes (empresa_id,venda_id,tipo,valor,motivo,usuario_id)
       VALUES (@emp,@vid,'parcial',@val,@mot,@uid) RETURNING id`,
      { emp, vid: id, val: valorTotal, mot: motivo || null, uid: req.user.id }
    );
    const devId = dR.recordset[0].id;
    for (const it of aDevolver) {
      await clientQuery(client,
        `INSERT INTO ItensDevolucao (devolucao_id,produto_id,quantidade,preco_unit,subtotal) VALUES (@did,@pid,@qty,@pu,@sub)`,
        { did: devId, pid: it.produto_id, qty: it.quantidade, pu: it.preco_unit, sub: it.subtotal }
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, valor_devolvido: valorTotal });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar devolução.' });
  } finally {
    client.release();
  }
});

module.exports = router;
