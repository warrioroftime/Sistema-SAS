// src/routes/vendas.js
const router = require('express').Router();
const { query, sql, getPool } = require('../db');
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
    if (busca)       { where += ` AND (CAST(v.id AS NVARCHAR) LIKE @b OR c.nome LIKE @b)`; params.b = `%${busca}%`; }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const r = await query(`
      SELECT v.id, v.criado_em, v.subtotal, v.desconto, v.total, v.observacao,
             fp.nome AS pagamento,
             c.id   AS cliente_id,
             c.nome AS cliente_nome,
             (SELECT COUNT(*) FROM ItensVenda WHERE venda_id = v.id) AS qtd_itens
      FROM Vendas v
      LEFT JOIN Clientes          c  ON c.id  = v.cliente_id
      LEFT JOIN FormasPagamento   fp ON fp.id = v.forma_pagamento_id
      WHERE ${where}
      ORDER BY v.criado_em DESC
      OFFSET ${offset} ROWS FETCH NEXT ${parseInt(limit)} ROWS ONLY
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
      SELECT v.id, v.criado_em, v.subtotal, v.desconto, v.total, v.observacao,
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
             p.id AS produto_id, p.codigo, p.descricao
      FROM ItensVenda iv
      JOIN Produtos p ON p.id = iv.produto_id
      WHERE iv.venda_id = @id
    `, { id });

    res.json({ ...venda.recordset[0], itens: itens.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar venda.' });
  }
});

// POST /api/vendas — cria venda + baixa estoque (tudo em transaction)
router.post('/', auth, async (req, res) => {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

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

    // Vincula a venda ao turno de caixa aberto do operador (se houver)
    const cxOpen = await query(
      `SELECT TOP 1 id FROM Caixa WHERE empresa_id=@emp AND usuario_id=@uid AND status='aberto' ORDER BY id DESC`,
      { emp: req.user.empresa_id, uid: req.user.id }
    );
    const caixaId = cxOpen.recordset[0] ? cxOpen.recordset[0].id : null;

    await transaction.begin();
    const req2 = new sql.Request(transaction);

    // Resolver forma de pagamento
    req2.input('pgto', pagamento);
    const fpR = await req2.query('SELECT id FROM FormasPagamento WHERE nome=@pgto');
    if (!fpR.recordset.length) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    }
    const fpId = fpR.recordset[0].id;

    // Verificar estoque de todos os itens (apenas se controla_estoque=1)
    for (const item of itens) {
      const rq = new sql.Request(transaction);
      rq.input('pid', item.produto_id);
      rq.input('emp', req.user.empresa_id);
      const estR = await rq.query(
        `SELECT estoque, descricao, controla_estoque
         FROM Produtos WHERE id=@pid AND empresa_id=@emp AND status='ativo'`
      );
      if (!estR.recordset.length) {
        await transaction.rollback();
        return res.status(400).json({ error: `Produto ID ${item.produto_id} não encontrado ou inativo.` });
      }
      const prod = estR.recordset[0];
      if (prod.controla_estoque && prod.estoque < item.quantidade) {
        await transaction.rollback();
        return res.status(400).json({
          error: `Estoque insuficiente para "${prod.descricao}". Disponível: ${prod.estoque}.`
        });
      }
    }

    // Definir vencimento, parcelas e status de cobrança
    const isFiado = pagamento === 'fiado';
    const dataVencimento = req.body.data_vencimento || null;
    const parcelas = isFiado ? (parseInt(req.body.parcelas) || 1) : 1;

    // Calcular totais
    let subtotal = 0;
    const itensPreco = [];
    for (const item of itens) {
      const rq = new sql.Request(transaction);
      rq.input('pid', item.produto_id);
      rq.input('emp', req.user.empresa_id);
      const pR = await rq.query('SELECT preco_venda FROM Produtos WHERE id=@pid AND empresa_id=@emp');
      const preco = pR.recordset[0].preco_venda;
      const sub = preco * item.quantidade;
      subtotal += sub;
      itensPreco.push({ ...item, preco_unit: preco, subtotal: sub });
    }

    const desc  = parseFloat(desconto) || 0;
    const total = Math.max(subtotal - desc, 0);

    // Inserir venda
    const vReq = new sql.Request(transaction);
    vReq.input('emp',  req.user.empresa_id);
    vReq.input('cid',  cliente_id || null);
    vReq.input('fp',   fpId);
    vReq.input('sub',  subtotal);
    vReq.input('desc', desc);
    vReq.input('tot',  total);
    vReq.input('obs',  observacao || null);
    vReq.input('uid',  req.user.id);
    vReq.input('stcob', isFiado ? 'pendente' : 'recebido');
    vReq.input('dvenc', dataVencimento ? new Date(dataVencimento) : null);
    vReq.input('drec',  isFiado ? null : new Date());
    vReq.input('cxid',  caixaId);
    const vR = await vReq.query(`
      INSERT INTO Vendas (empresa_id, cliente_id, forma_pagamento_id, subtotal, desconto, total, observacao, usuario_id, status_cobranca, data_vencimento, data_recebimento, caixa_id)
      OUTPUT INSERTED.id
      VALUES (@emp, @cid, @fp, @sub, @desc, @tot, @obs, @uid, @stcob, @dvenc, @drec, @cxid)
    `);
    const vendaId = vR.recordset[0].id;

    // Inserir itens + baixar estoque (somente se controla_estoque=1)
    for (const item of itensPreco) {
      const iReq = new sql.Request(transaction);
      iReq.input('vid', vendaId); iReq.input('pid', item.produto_id);
      iReq.input('qty', item.quantidade); iReq.input('pu', item.preco_unit); iReq.input('sub', item.subtotal);
      await iReq.query(`INSERT INTO ItensVenda (venda_id,produto_id,quantidade,preco_unit,subtotal) VALUES (@vid,@pid,@qty,@pu,@sub)`);

      // checar controla_estoque
      const ceReq = new sql.Request(transaction);
      ceReq.input('pid', item.produto_id); ceReq.input('emp', req.user.empresa_id);
      const ceR = await ceReq.query(`SELECT estoque, controla_estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp`);
      const controla = ceR.recordset[0]?.controla_estoque;
      if (controla) {
        const saldoAnt = ceR.recordset[0].estoque;
        const saldoAtual = saldoAnt - item.quantidade;
        const eReq = new sql.Request(transaction);
        eReq.input('pid', item.produto_id); eReq.input('emp', req.user.empresa_id); eReq.input('qty', item.quantidade);
        await eReq.query(`UPDATE Produtos SET estoque=estoque-@qty, atualizado_em=GETDATE() WHERE id=@pid AND empresa_id=@emp`);
        const mReq = new sql.Request(transaction);
        mReq.input('emp', req.user.empresa_id); mReq.input('pid', item.produto_id);
        mReq.input('qty', item.quantidade); mReq.input('sant', saldoAnt); mReq.input('sat', saldoAtual);
        mReq.input('orig', `Venda #${vendaId}`); mReq.input('uid', req.user.id);
        await mReq.query(`INSERT INTO MovimentacoesEstoque (empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_atual,origem,usuario_id) VALUES (@emp,@pid,'saida',@qty,@sant,@sat,@orig,@uid)`);
      }
    }

    await transaction.commit();

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
        await query(
          `INSERT INTO ContasReceber (empresa_id,venda_id,cliente_id,parcela_num,parcelas_total,valor,data_vencimento,status,observacao)
           VALUES (@emp,@vid,@cid,@pn,@pt,@val,@dvenc,'pendente',@obs)`,
          { emp: req.user.empresa_id, vid: vendaId, cid: cliente_id||null,
            pn: i+1, pt: parcelas, val: valor, dvenc: venc, obs: observacao||null }
        );
      }
    }

    // Retornar venda completa
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
    try { await transaction.rollback(); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar venda.' });
  }
});

module.exports = router;
