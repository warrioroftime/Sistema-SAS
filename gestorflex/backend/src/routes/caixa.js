// src/routes/caixa.js — Turno de caixa (abertura, sangria/suprimento, fechamento)
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// Busca o caixa aberto do usuário atual (ou null)
async function caixaAbertoId(emp, uid) {
  const r = await query(
    `SELECT TOP 1 id FROM Caixa WHERE empresa_id=@emp AND usuario_id=@uid AND status='aberto' ORDER BY id DESC`,
    { emp, uid }
  );
  return r.recordset[0] ? r.recordset[0].id : null;
}

// Monta o resumo financeiro de um caixa
async function resumoCaixa(caixaId, emp) {
  const cab = await query('SELECT * FROM Caixa WHERE id=@id AND empresa_id=@emp', { id: caixaId, emp });
  const caixa = cab.recordset[0];
  if (!caixa) return null;

  const movs = await query(
    `SELECT id, tipo, valor, descricao, criado_em
     FROM MovimentacoesCaixa WHERE caixa_id=@id ORDER BY criado_em DESC`,
    { id: caixaId }
  );

  const tot = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo='suprimento' THEN valor END),0) AS suprimentos,
       COALESCE(SUM(CASE WHEN tipo='sangria'    THEN valor END),0) AS sangrias
     FROM MovimentacoesCaixa WHERE caixa_id=@id`,
    { id: caixaId }
  );

  const vnd = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN fp.nome='dinheiro' THEN v.total END),0) AS vendas_dinheiro,
       COALESCE(SUM(v.total),0) AS vendas_total,
       COUNT(*) AS qtd_vendas
     FROM Vendas v
     LEFT JOIN FormasPagamento fp ON fp.id = v.forma_pagamento_id
     WHERE v.caixa_id=@id`,
    { id: caixaId }
  );

  const abertura     = caixa.valor_abertura;
  const suprimentos  = tot.recordset[0].suprimentos;
  const sangrias     = tot.recordset[0].sangrias;
  const vendasDin    = vnd.recordset[0].vendas_dinheiro;
  const esperado     = +(abertura + suprimentos - sangrias + vendasDin).toFixed(2);

  return {
    caixa,
    movimentacoes: movs.recordset,
    resumo: {
      valor_abertura:    abertura,
      suprimentos,
      sangrias,
      vendas_dinheiro:   vendasDin,
      vendas_total:      vnd.recordset[0].vendas_total,
      qtd_vendas:        vnd.recordset[0].qtd_vendas,
      esperado_dinheiro: esperado,
    },
  };
}

// GET /api/caixa/atual — caixa aberto do usuário + resumo
router.get('/atual', auth, async (req, res) => {
  try {
    const id = await caixaAbertoId(req.user.empresa_id, req.user.id);
    if (!id) return res.json({ aberto: false });
    const data = await resumoCaixa(id, req.user.empresa_id);
    res.json({ aberto: true, ...data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao consultar caixa.' });
  }
});

// POST /api/caixa/abrir — { valor_abertura, observacao }
router.post('/abrir', auth, async (req, res) => {
  try {
    const valor = parseFloat(req.body.valor_abertura) || 0;
    const obs   = (req.body.observacao || '').trim() || null;

    if (await caixaAbertoId(req.user.empresa_id, req.user.id)) {
      return res.status(409).json({ error: 'Já existe um caixa aberto. Feche-o antes de abrir outro.' });
    }
    const r = await query(
      `INSERT INTO Caixa (empresa_id, usuario_id, valor_abertura, obs_abertura)
       OUTPUT INSERTED.id VALUES (@emp, @uid, @valor, @obs)`,
      { emp: req.user.empresa_id, uid: req.user.id, valor, obs }
    );
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao abrir caixa.' });
  }
});

// POST /api/caixa/movimentar — { tipo: 'sangria'|'suprimento', valor, descricao }
router.post('/movimentar', auth, async (req, res) => {
  try {
    const { tipo } = req.body;
    const valor = parseFloat(req.body.valor) || 0;
    const desc  = (req.body.descricao || '').trim() || null;

    if (!['sangria', 'suprimento'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido.' });
    }
    if (valor <= 0) return res.status(400).json({ error: 'Informe um valor maior que zero.' });

    const id = await caixaAbertoId(req.user.empresa_id, req.user.id);
    if (!id) return res.status(400).json({ error: 'Nenhum caixa aberto.' });

    await query(
      `INSERT INTO MovimentacoesCaixa (caixa_id, empresa_id, tipo, valor, descricao, usuario_id)
       VALUES (@cid, @emp, @tipo, @valor, @desc, @uid)`,
      { cid: id, emp: req.user.empresa_id, tipo, valor, desc, uid: req.user.id }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar movimentação.' });
  }
});

// POST /api/caixa/fechar — { valor_informado, observacao }
router.post('/fechar', auth, async (req, res) => {
  try {
    const informado = parseFloat(req.body.valor_informado) || 0;
    const obs = (req.body.observacao || '').trim() || null;

    const id = await caixaAbertoId(req.user.empresa_id, req.user.id);
    if (!id) return res.status(400).json({ error: 'Nenhum caixa aberto.' });

    const data = await resumoCaixa(id, req.user.empresa_id);
    const esperado  = data.resumo.esperado_dinheiro;
    const diferenca = +(informado - esperado).toFixed(2);

    await query(
      `UPDATE Caixa SET status='fechado', valor_informado=@inf, valor_esperado=@esp,
         diferenca=@dif, data_fechamento=GETDATE(), obs_fechamento=@obs
       WHERE id=@id AND empresa_id=@emp`,
      { inf: informado, esp: esperado, dif: diferenca, obs, id, emp: req.user.empresa_id }
    );
    res.json({ ok: true, esperado, informado, diferenca, resumo: data.resumo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao fechar caixa.' });
  }
});

// GET /api/caixa/historico — últimos caixas fechados
router.get('/historico', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT TOP 50 c.id, c.valor_abertura, c.data_abertura, c.valor_informado,
              c.valor_esperado, c.diferenca, c.data_fechamento, u.nome AS operador
       FROM Caixa c LEFT JOIN Usuarios u ON u.id = c.usuario_id
       WHERE c.empresa_id=@emp AND c.status='fechado'
       ORDER BY c.id DESC`,
      { emp: req.user.empresa_id }
    );
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar histórico de caixa.' });
  }
});

module.exports = router;
