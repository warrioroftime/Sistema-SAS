// src/routes/contas-pagar.js — Contas a Pagar / Lançamento de Despesas
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// Recalcula e persiste status de uma conta a pagar a partir dos seus pagamentos
async function recalcStatusPagar(contaId, emp, uid) {
  const r = await query(`
    SELECT cp.valor, cp.status,
           COALESCE(ag.total, 0) AS total_pago
    FROM ContasPagar cp
    LEFT JOIN LATERAL (
      SELECT SUM(valor_pago) AS total
      FROM PagamentosContasPagar
      WHERE conta_id = cp.id AND estornado = FALSE
    ) ag ON TRUE
    WHERE cp.id = @id AND cp.empresa_id = @emp`,
    { id: contaId, emp }
  );
  const c = r.recordset[0];
  if (!c || c.status === 'cancelado') return c?.status || null;

  const aberto = +(c.valor - c.total_pago).toFixed(2);
  let status = 'pendente';
  if (aberto <= 0.005)      status = 'pago';
  else if (c.total_pago > 0) status = 'parcial';

  await query(`
    UPDATE ContasPagar
    SET status = @st, valor_pago = @vp,
        data_pagamento = CASE WHEN @st = 'pago' THEN NOW() ELSE data_pagamento END,
        atualizado_em = NOW()
    WHERE id = @id AND empresa_id = @emp`,
    { st: status, vp: c.total_pago, id: contaId, emp }
  );
  return status;
}

// ── GET / — listagem com filtros + totais para os cards ─────────
// ?status=&categoria=&busca=&de=&ate=&page=&limit=
router.get('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const { status = '', tipo = '', categoria = '', busca = '', de = '', ate = '', page = 1, limit = 200 } = req.query;

    let baseWhere = `cp.empresa_id = @emp`;
    const params = { emp };

    if (tipo)      { baseWhere += ` AND cp.tipo = @tipo`;              params.tipo = tipo; }
    if (categoria) { baseWhere += ` AND cp.categoria = @cat`;         params.cat = categoria; }
    if (busca)     { baseWhere += ` AND (cp.fornecedor LIKE @bsc OR COALESCE(cp.descricao,'') LIKE @bsc OR COALESCE(cp.numero_documento,'') LIKE @bsc)`; params.bsc = `%${busca}%`; }
    if (de)        { baseWhere += ` AND cp.data_vencimento >= @de`;    params.de  = new Date(de  + 'T00:00:00'); }
    if (ate)       { baseWhere += ` AND cp.data_vencimento <= @ate`;   params.ate = new Date(ate + 'T23:59:59'); }

    let where = baseWhere;
    if (status === 'vencido') {
      where += ` AND cp.status IN ('pendente','parcial') AND cp.data_vencimento < CURRENT_DATE`;
    } else if (status) {
      where += ` AND cp.status = @st`; params.st = status;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const r = await query(`
      SELECT cp.id, cp.tipo, cp.fornecedor, cp.categoria, cp.descricao, cp.numero_documento,
             cp.parcela_num, cp.parcelas_total, cp.valor, cp.data_emissao,
             cp.data_vencimento, cp.status, cp.data_pagamento, cp.valor_pago,
             cp.observacao, cp.criado_em,
             COALESCE(ag.total_pago, 0) AS total_pago_real,
             (cp.valor - COALESCE(ag.total_pago, 0)) AS valor_aberto,
             CASE WHEN cp.status IN ('pendente','parcial') AND cp.data_vencimento < CURRENT_DATE
                  THEN (CURRENT_DATE - cp.data_vencimento::date) ELSE 0 END AS dias_atraso
      FROM ContasPagar cp
      LEFT JOIN LATERAL (
        SELECT SUM(valor_pago) AS total_pago
        FROM PagamentosContasPagar WHERE conta_id = cp.id AND estornado = FALSE
      ) ag ON TRUE
      WHERE ${where}
      ORDER BY
        CASE WHEN cp.status IN ('pendente','parcial') THEN 0 ELSE 1 END,
        cp.data_vencimento ASC, cp.id DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `, params);

    const tot = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN cp.status IN ('pendente','parcial') THEN cp.valor - COALESCE(ag.total_pago,0) ELSE 0 END), 0) AS total_aberto,
        COALESCE(SUM(COALESCE(ag.total_pago, 0)), 0) AS total_pago,
        COALESCE(SUM(CASE WHEN cp.status IN ('pendente','parcial') AND cp.data_vencimento < CURRENT_DATE
                          THEN cp.valor - COALESCE(ag.total_pago,0) ELSE 0 END), 0) AS total_vencido,
        SUM(CASE WHEN cp.status IN ('pendente','parcial') THEN 1 ELSE 0 END) AS qtd_aberto,
        SUM(CASE WHEN cp.status = 'pago' THEN 1 ELSE 0 END) AS qtd_pago,
        SUM(CASE WHEN cp.status IN ('pendente','parcial') AND cp.data_vencimento < CURRENT_DATE THEN 1 ELSE 0 END) AS qtd_vencido
      FROM ContasPagar cp
      LEFT JOIN LATERAL (
        SELECT SUM(valor_pago) AS total_pago
        FROM PagamentosContasPagar WHERE conta_id = cp.id AND estornado = FALSE
      ) ag ON TRUE
      WHERE ${baseWhere}
    `, params);

    const t = tot.recordset[0];
    res.json({
      data:          r.recordset,
      total_aberto:  t.total_aberto,
      total_pago:    t.total_pago,
      total_vencido: t.total_vencido,
      qtd_aberto:    t.qtd_aberto,
      qtd_pago:      t.qtd_pago,
      qtd_vencido:   t.qtd_vencido,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar contas a pagar.' });
  }
});

// ── POST / — lançamento de despesa (com parcelas) ───────────────
router.post('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const uid = req.user.id;
    const tipo        = ['despesa','fornecedor'].includes(req.body.tipo) ? req.body.tipo : 'fornecedor';
    const fornecedor  = (req.body.fornecedor || '').trim();
    const categoria   = (req.body.categoria  || '').trim() || null;
    const descricao   = (req.body.descricao  || '').trim() || null;
    const numDoc      = (req.body.numero_documento || '').trim();
    const obs         = (req.body.observacao || '').trim() || null;
    const valorTotal  = parseFloat(req.body.valor_total) || 0;
    const parcelas    = Math.max(parseInt(req.body.parcelas) || 1, 1);
    const emissao     = req.body.data_emissao   ? new Date(req.body.data_emissao)   : new Date();
    const primeiroVenc = req.body.data_vencimento ? new Date(req.body.data_vencimento) : new Date(Date.now() + 30 * 86400000);

    if (!fornecedor)   return res.status(400).json({ error: 'Informe o fornecedor/credor.' });
    if (valorTotal <= 0) return res.status(400).json({ error: 'Informe um valor maior que zero.' });

    const valorParcela = +(valorTotal / parcelas).toFixed(2);
    const ids = [];
    for (let i = 0; i < parcelas; i++) {
      const venc = new Date(primeiroVenc);
      venc.setMonth(venc.getMonth() + i);
      const valor = i === parcelas - 1
        ? +(valorTotal - valorParcela * (parcelas - 1)).toFixed(2)
        : valorParcela;
      const docParc = parcelas > 1 ? `${numDoc || 'DESP'}-${i + 1}/${parcelas}` : (numDoc || null);
      const r = await query(`
        INSERT INTO ContasPagar
          (empresa_id, tipo, fornecedor, categoria, descricao, numero_documento,
           parcela_num, parcelas_total, valor, data_emissao, data_vencimento,
           status, observacao, criado_por)
        VALUES (@emp, @tipo, @forn, @cat, @desc, @ndoc, @pn, @pt, @val, @emi, @dvenc, 'pendente', @obs, @uid)
        RETURNING id`,
        { emp, tipo, forn: fornecedor, cat: categoria, desc: descricao, ndoc: docParc,
          pn: i + 1, pt: parcelas, val: valor, emi: emissao, dvenc: venc, obs, uid });
      ids.push(r.recordset[0].id);
    }

    res.status(201).json({ ok: true, ids, parcelas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao lançar despesa.' });
  }
});

// ── GET /:id — detalhe + histórico de pagamentos ────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const emp = req.user.empresa_id;

    const cab = await query(`
      SELECT cp.*,
             (cp.valor - COALESCE((SELECT SUM(valor_pago) FROM PagamentosContasPagar WHERE conta_id = cp.id AND estornado = FALSE), 0)) AS valor_aberto
      FROM ContasPagar cp
      WHERE cp.id = @id AND cp.empresa_id = @emp`, { id, emp });
    if (!cab.recordset[0]) return res.status(404).json({ error: 'Conta não encontrada.' });

    const pags = await query(`
      SELECT p.*, u.nome AS operador
      FROM PagamentosContasPagar p
      LEFT JOIN Usuarios u ON u.id = p.usuario_id
      WHERE p.conta_id = @id ORDER BY p.criado_em DESC`, { id });

    res.json({ titulo: cab.recordset[0], pagamentos: pags.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao consultar conta.' });
  }
});

// ── POST /:id/pagar — registra pagamento ────────────────────────
router.post('/:id/pagar', auth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const emp = req.user.empresa_id;
    const uid = req.user.id;
    const forma   = (req.body.forma_pagamento || 'dinheiro').toLowerCase();
    const obs     = (req.body.observacao || '').trim() || null;
    const dataP   = req.body.data_pagamento ? new Date(req.body.data_pagamento) : new Date();
    let valorPago = parseFloat(req.body.valor_pago) || 0;

    const rec = await query(`
      SELECT cp.valor, cp.status,
             COALESCE((SELECT SUM(valor_pago) FROM PagamentosContasPagar WHERE conta_id = cp.id AND estornado = FALSE), 0) AS total_pago
      FROM ContasPagar cp WHERE cp.id = @id AND cp.empresa_id = @emp`, { id, emp });
    if (!rec.recordset[0]) return res.status(404).json({ error: 'Conta não encontrada.' });

    const c = rec.recordset[0];
    if (c.status === 'pago')      return res.status(400).json({ error: 'Esta conta já foi totalmente paga.' });
    if (c.status === 'cancelado') return res.status(400).json({ error: 'Conta cancelada não pode receber pagamento.' });

    const aberto = +(c.valor - c.total_pago).toFixed(2);
    if (valorPago <= 0) return res.status(400).json({ error: 'Informe um valor de pagamento maior que zero.' });
    if (valorPago > aberto + 0.005) valorPago = aberto;
    valorPago = +valorPago.toFixed(2);

    await query(`
      INSERT INTO PagamentosContasPagar
        (empresa_id, conta_id, valor_pago, forma_pagamento, data_pagamento, usuario_id, observacao)
      VALUES (@emp, @cid, @vp, @forma, @dt, @uid, @obs)`,
      { emp, cid: id, vp: valorPago, forma, dt: dataP, uid, obs });

    const status = await recalcStatusPagar(id, emp, uid);
    res.status(201).json({ ok: true, status, valor_pago: valorPago });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar pagamento.' });
  }
});

// ── POST /pagamentos/:pagId/estornar ────────────────────────────
router.post('/pagamentos/:pagId/estornar', auth, async (req, res) => {
  try {
    const pagId = parseInt(req.params.pagId);
    const emp   = req.user.empresa_id;
    const uid   = req.user.id;

    const r = await query(
      `SELECT conta_id, estornado FROM PagamentosContasPagar WHERE id = @id AND empresa_id = @emp`,
      { id: pagId, emp });
    if (!r.recordset[0]) return res.status(404).json({ error: 'Pagamento não encontrado.' });
    if (r.recordset[0].estornado) return res.status(400).json({ error: 'Pagamento já estornado.' });

    await query(`
      UPDATE PagamentosContasPagar
      SET estornado = TRUE, estornado_por = @uid, estornado_em = NOW()
      WHERE id = @id AND empresa_id = @emp`, { id: pagId, uid, emp });

    const status = await recalcStatusPagar(r.recordset[0].conta_id, emp, uid);
    res.json({ ok: true, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao estornar pagamento.' });
  }
});

// ── PUT /:id/cancelar ───────────────────────────────────────────
router.put('/:id/cancelar', auth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const emp = req.user.empresa_id;
    await query(
      `UPDATE ContasPagar SET status = 'cancelado', atualizado_em = NOW()
       WHERE id = @id AND empresa_id = @emp AND status <> 'pago'`,
      { id, emp });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar.' });
  }
});

module.exports = router;
