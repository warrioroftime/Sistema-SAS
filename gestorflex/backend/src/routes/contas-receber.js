// src/routes/contas-receber.js — Contas a Receber (fundação financeira)
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// Caixa aberto do usuário (para lançar recebimentos em dinheiro no turno)
async function caixaAbertoId(emp, uid) {
  const r = await query(
    `SELECT id FROM Caixa WHERE empresa_id=@emp AND usuario_id=@uid AND status='aberto' ORDER BY id DESC LIMIT 1`,
    { emp, uid }
  );
  return r.recordset[0] ? r.recordset[0].id : null;
}

// Recalcula e persiste o status de um título a partir dos seus recebimentos
async function recalcStatus(contaId, emp, uid) {
  const r = await query(`
    SELECT cr.valor, cr.status,
           COALESCE(ag.principal,0) AS principal,
           COALESCE(ag.total,0)     AS total,
           COALESCE(ag.juros,0)     AS juros,
           COALESCE(ag.multa,0)     AS multa,
           COALESCE(ag.desconto,0)  AS desconto,
           COALESCE(ag.acrescimo,0) AS acrescimo,
           ag.ult AS ult
    FROM ContasReceber cr
    LEFT JOIN LATERAL (
      SELECT SUM(valor_principal) AS principal, SUM(valor_recebido) AS total,
             SUM(juros) AS juros, SUM(multa) AS multa, SUM(desconto) AS desconto,
             SUM(acrescimo) AS acrescimo, MAX(data_recebimento) AS ult
      FROM RecebimentosContas WHERE conta_id=cr.id AND estornado=FALSE
    ) ag ON TRUE
    WHERE cr.id=@id AND cr.empresa_id=@emp`,
    { id: contaId, emp }
  );
  const c = r.recordset[0];
  if (!c) return null;
  if (['cancelado', 'renegociado'].includes(c.status)) return c.status;

  const aberto = +(c.valor - c.principal).toFixed(2);
  let status = 'pendente';
  if (aberto <= 0.005) status = 'recebido';
  else if (c.total > 0) status = 'parcial';

  await query(`
    UPDATE ContasReceber
    SET status=@st, juros=@j, multa=@m, desconto=@d, acrescimo=@a,
        valor_recebido=@vr, data_recebimento=@ult, alterado_por=@uid, alterado_em=NOW()
    WHERE id=@id AND empresa_id=@emp`,
    { st: status, j: c.juros, m: c.multa, d: c.desconto, a: c.acrescimo,
      vr: c.total, ult: status === 'pendente' ? null : c.ult, uid, id: contaId, emp }
  );
  return status;
}

// ── GET / — listagem com filtros + totais p/ os cards ─────────────
// ?status=&cliente_id=&busca=&documento=&de=&ate=&rec_de=&rec_ate=&page=&limit=
router.get('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const { status = '', cliente_id = '', busca = '', documento = '',
            de = '', ate = '', rec_de = '', rec_ate = '', page = 1, limit = 200 } = req.query;

    // Filtros que valem também para os cards (tudo menos o status)
    let baseWhere = `cr.empresa_id=@emp`;
    const params = { emp };
    if (cliente_id) { baseWhere += ` AND cr.cliente_id=@cid`; params.cid = parseInt(cliente_id); }
    if (documento)  { baseWhere += ` AND cr.numero_documento LIKE @doc`; params.doc = `%${documento}%`; }
    if (busca)      { baseWhere += ` AND (c.nome LIKE @bsc OR c.documento LIKE @bsc)`; params.bsc = `%${busca}%`; }
    if (de)         { baseWhere += ` AND cr.data_vencimento >= @de`;  params.de  = new Date(de + 'T00:00:00'); }
    if (ate)        { baseWhere += ` AND cr.data_vencimento <= @ate`; params.ate = new Date(ate + 'T23:59:59'); }

    // Filtro de status (inclui o "vencido" calculado)
    let where = baseWhere;
    if (status === 'vencido') {
      where += ` AND cr.status IN ('pendente','parcial') AND cr.data_vencimento < CURRENT_DATE`;
    } else if (status) {
      where += ` AND cr.status=@st`; params.st = status;
    }
    if (rec_de || rec_ate) {
      if (rec_de)  { where += ` AND cr.data_recebimento >= @rde`;  params.rde = new Date(rec_de + 'T00:00:00'); }
      if (rec_ate) { where += ` AND cr.data_recebimento <= @rate`; params.rate = new Date(rec_ate + 'T23:59:59'); }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const r = await query(`
      SELECT cr.id, cr.venda_id, cr.numero_documento, cr.parcela_num, cr.parcelas_total,
             cr.valor, cr.juros, cr.multa, cr.desconto, cr.acrescimo,
             cr.data_emissao, cr.data_vencimento, cr.status, cr.data_recebimento,
             cr.valor_recebido, cr.lancamento_manual, cr.observacao, cr.criado_em,
             c.id AS cliente_id, c.nome AS cliente_nome, c.documento AS cliente_doc, c.telefone AS cliente_tel,
             COALESCE(ag.principal,0) AS principal_recebido,
             COALESCE(ag.total,0)     AS total_recebido_real,
             (cr.valor - COALESCE(ag.principal,0)) AS valor_aberto,
             CASE WHEN cr.status IN ('pendente','parcial') AND cr.data_vencimento < CURRENT_DATE
                  THEN (CURRENT_DATE - cr.data_vencimento::date) ELSE 0 END AS dias_atraso
      FROM ContasReceber cr
      LEFT JOIN Clientes c ON c.id = cr.cliente_id
      LEFT JOIN LATERAL (
        SELECT SUM(valor_principal) AS principal, SUM(valor_recebido) AS total
        FROM RecebimentosContas WHERE conta_id=cr.id AND estornado=FALSE
      ) ag ON TRUE
      WHERE ${where}
      ORDER BY
        CASE WHEN cr.status IN ('pendente','parcial') THEN 0 ELSE 1 END,
        cr.data_vencimento ASC, cr.id DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `, params);

    // Cards: aplica filtros base (menos status) p/ refletir o universo todo
    const tot = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN cr.status IN ('pendente','parcial') THEN cr.valor - COALESCE(ag.principal,0) ELSE 0 END),0) AS total_aberto,
        COALESCE(SUM(COALESCE(ag.total,0)),0) AS total_recebido,
        COALESCE(SUM(CASE WHEN cr.status IN ('pendente','parcial') AND cr.data_vencimento < CURRENT_DATE
                          THEN cr.valor - COALESCE(ag.principal,0) ELSE 0 END),0) AS total_vencido,
        SUM(CASE WHEN cr.status IN ('pendente','parcial') THEN 1 ELSE 0 END) AS qtd_aberto,
        SUM(CASE WHEN cr.status='recebido' THEN 1 ELSE 0 END) AS qtd_recebido,
        SUM(CASE WHEN cr.status IN ('pendente','parcial') AND cr.data_vencimento < CURRENT_DATE THEN 1 ELSE 0 END) AS qtd_vencido
      FROM ContasReceber cr
      LEFT JOIN Clientes c ON c.id = cr.cliente_id
      LEFT JOIN LATERAL (
        SELECT SUM(valor_principal) AS principal, SUM(valor_recebido) AS total
        FROM RecebimentosContas WHERE conta_id=cr.id AND estornado=FALSE
      ) ag ON TRUE
      WHERE ${baseWhere}
    `, params);

    const t = tot.recordset[0];
    res.json({
      data: r.recordset,
      total_aberto:   t.total_aberto,
      total_recebido: t.total_recebido,
      total_vencido:  t.total_vencido,
      qtd_aberto:     t.qtd_aberto,
      qtd_recebido:   t.qtd_recebido,
      qtd_vencido:    t.qtd_vencido,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar contas a receber.' });
  }
});

// ── POST / — lançamento manual de título (avulso, com parcelas) ───
// body: { cliente_id?, numero_documento?, valor_total, data_emissao?, data_vencimento?, parcelas?, observacao? }
router.post('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const uid = req.user.id;
    const clienteId = req.body.cliente_id ? parseInt(req.body.cliente_id) : null;
    const valorTotal = parseFloat(req.body.valor_total) || 0;
    const parcelas = Math.max(parseInt(req.body.parcelas) || 1, 1);
    const obs = (req.body.observacao || '').trim() || null;
    const docBase = (req.body.numero_documento || '').trim();
    const emissao = req.body.data_emissao ? new Date(req.body.data_emissao) : new Date();

    if (valorTotal <= 0) return res.status(400).json({ error: 'Informe um valor maior que zero.' });

    const primeiroVenc = req.body.data_vencimento
      ? new Date(req.body.data_vencimento)
      : new Date(Date.now() + 30 * 86400000);

    const valorParcela = +(valorTotal / parcelas).toFixed(2);
    const ids = [];
    for (let i = 0; i < parcelas; i++) {
      const venc = new Date(primeiroVenc);
      venc.setMonth(venc.getMonth() + i);
      const valor = i === parcelas - 1
        ? +(valorTotal - valorParcela * (parcelas - 1)).toFixed(2)
        : valorParcela;
      const numDoc = parcelas > 1
        ? `${docBase || 'MAN'}-${i + 1}/${parcelas}`
        : (docBase || null);
      const r = await query(`
        INSERT INTO ContasReceber
          (empresa_id, cliente_id, numero_documento, parcela_num, parcelas_total,
           valor, data_emissao, data_vencimento, status, lancamento_manual, observacao, criado_por)
        VALUES (@emp, @cid, @ndoc, @pn, @pt, @val, @emi, @dvenc, 'pendente', 1, @obs, @uid)
        RETURNING id`,
        { emp, cid: clienteId, ndoc: numDoc, pn: i + 1, pt: parcelas, val: valor,
          emi: emissao, dvenc: venc, obs, uid });
      ids.push(r.recordset[0].id);
    }

    res.status(201).json({ ok: true, ids, parcelas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao lançar conta a receber.' });
  }
});

// ── GET /:id — detalhe do título + histórico de recebimentos ──────
router.get('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const emp = req.user.empresa_id;
    const cab = await query(`
      SELECT cr.*, c.nome AS cliente_nome, c.documento AS cliente_doc, c.telefone AS cliente_tel,
             (cr.valor - COALESCE((SELECT SUM(valor_principal) FROM RecebimentosContas WHERE conta_id=cr.id AND estornado=FALSE),0)) AS valor_aberto
      FROM ContasReceber cr
      LEFT JOIN Clientes c ON c.id = cr.cliente_id
      WHERE cr.id=@id AND cr.empresa_id=@emp`, { id, emp });
    if (!cab.recordset[0]) return res.status(404).json({ error: 'Título não encontrado.' });

    const recs = await query(`
      SELECT rc.*, u.nome AS operador
      FROM RecebimentosContas rc
      LEFT JOIN Usuarios u ON u.id = rc.usuario_id
      WHERE rc.conta_id=@id ORDER BY rc.criado_em DESC`, { id });

    res.json({ titulo: cab.recordset[0], recebimentos: recs.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao consultar título.' });
  }
});

// ── POST /:id/receber — baixa total ou parcial ────────────────────
router.post('/:id/receber', auth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const emp = req.user.empresa_id;
    const uid = req.user.id;
    const forma = (req.body.forma_pagamento || 'dinheiro').toLowerCase();
    const juros     = Math.max(parseFloat(req.body.juros)     || 0, 0);
    const multa     = Math.max(parseFloat(req.body.multa)     || 0, 0);
    const desconto  = Math.max(parseFloat(req.body.desconto)  || 0, 0);
    const acrescimo = Math.max(parseFloat(req.body.acrescimo) || 0, 0);
    const obs   = (req.body.observacao || '').trim() || null;
    const dataRec = req.body.data_recebimento ? new Date(req.body.data_recebimento) : new Date();

    const rec = await query(`
      SELECT cr.valor, cr.status,
             COALESCE((SELECT SUM(valor_principal) FROM RecebimentosContas WHERE conta_id=cr.id AND estornado=FALSE),0) AS principal
      FROM ContasReceber cr WHERE cr.id=@id AND cr.empresa_id=@emp`, { id, emp });
    if (!rec.recordset[0]) return res.status(404).json({ error: 'Título não encontrado.' });
    const conta = rec.recordset[0];
    if (conta.status === 'recebido')  return res.status(400).json({ error: 'Este título já foi totalmente recebido.' });
    if (conta.status === 'cancelado') return res.status(400).json({ error: 'Título cancelado não pode receber.' });

    const aberto = +(conta.valor - conta.principal).toFixed(2);
    let principal = req.body.valor_principal != null ? parseFloat(req.body.valor_principal) : aberto;
    if (isNaN(principal) || principal <= 0) return res.status(400).json({ error: 'Informe um valor de principal maior que zero.' });
    if (principal > aberto + 0.005) principal = aberto;   // não recebe mais que o aberto
    principal = +principal.toFixed(2);

    const valorRecebido = +(principal + juros + multa + acrescimo - desconto).toFixed(2);
    const caixaId = await caixaAbertoId(emp, uid);

    await query(`
      INSERT INTO RecebimentosContas
        (empresa_id, conta_id, valor_principal, juros, multa, desconto, acrescimo,
         valor_recebido, forma_pagamento, data_recebimento, usuario_id, caixa_id, observacao)
      VALUES (@emp, @cid, @pr, @j, @m, @d, @a, @vr, @forma, @dt, @uid, @cxid, @obs)`,
      { emp, cid: id, pr: principal, j: juros, m: multa, d: desconto, a: acrescimo,
        vr: valorRecebido, forma, dt: dataRec, uid, cxid: caixaId, obs });

    const status = await recalcStatus(id, emp, uid);
    res.status(201).json({ ok: true, status, valor_recebido: valorRecebido, caixa_id: caixaId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar recebimento.' });
  }
});

// ── POST /receber-lote — baixa total de vários títulos de uma vez ─
// body: { ids:[...], forma_pagamento, observacao }
router.post('/receber-lote', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const uid = req.user.id;
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const forma = (req.body.forma_pagamento || 'dinheiro').toLowerCase();
    const obs = (req.body.observacao || '').trim() || null;
    if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos um título.' });

    // Só permite lote de parcelas do MESMO cliente
    const cli = await query(`
      SELECT COUNT(DISTINCT COALESCE(cliente_id, -1)) AS clientes
      FROM ContasReceber
      WHERE empresa_id=@emp AND id IN (${ids.map((_, i) => '@i' + i).join(',')})`,
      ids.reduce((p, id, i) => (p['i' + i] = id, p), { emp }));
    if ((cli.recordset[0].clientes || 0) > 1) {
      return res.status(400).json({ error: 'O recebimento em lote só é permitido para parcelas do mesmo cliente.' });
    }

    const caixaId = await caixaAbertoId(emp, uid);
    let recebidos = 0, totalRecebido = 0;

    for (const id of ids) {
      const rec = await query(`
        SELECT cr.valor, cr.status,
               COALESCE((SELECT SUM(valor_principal) FROM RecebimentosContas WHERE conta_id=cr.id AND estornado=FALSE),0) AS principal
        FROM ContasReceber cr WHERE cr.id=@id AND cr.empresa_id=@emp`, { id, emp });
      const conta = rec.recordset[0];
      if (!conta || ['recebido', 'cancelado', 'renegociado'].includes(conta.status)) continue;

      const aberto = +(conta.valor - conta.principal).toFixed(2);
      if (aberto <= 0.005) continue;

      await query(`
        INSERT INTO RecebimentosContas
          (empresa_id, conta_id, valor_principal, valor_recebido, forma_pagamento, usuario_id, caixa_id, observacao)
        VALUES (@emp, @cid, @pr, @vr, @forma, @uid, @cxid, @obs)`,
        { emp, cid: id, pr: aberto, vr: aberto, forma, uid, cxid: caixaId, obs });
      await recalcStatus(id, emp, uid);
      recebidos++; totalRecebido += aberto;
    }

    res.json({ ok: true, recebidos, total_recebido: +totalRecebido.toFixed(2) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no recebimento em lote.' });
  }
});

// ── POST /recebimentos/:recId/estornar — desfaz um recebimento ────
router.post('/recebimentos/:recId/estornar', auth, async (req, res) => {
  try {
    const recId = parseInt(req.params.recId);
    const emp = req.user.empresa_id;
    const uid = req.user.id;

    const r = await query(
      `SELECT conta_id, estornado FROM RecebimentosContas WHERE id=@id AND empresa_id=@emp`,
      { id: recId, emp });
    if (!r.recordset[0]) return res.status(404).json({ error: 'Recebimento não encontrado.' });
    if (r.recordset[0].estornado) return res.status(400).json({ error: 'Recebimento já estornado.' });

    await query(`
      UPDATE RecebimentosContas
      SET estornado=TRUE, estornado_por=@uid, estornado_em=NOW()
      WHERE id=@id AND empresa_id=@emp`, { id: recId, uid, emp });

    const status = await recalcStatus(r.recordset[0].conta_id, emp, uid);
    res.json({ ok: true, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao estornar recebimento.' });
  }
});

// ── PUT /:id/cancelar ─────────────────────────────────────────────
router.put('/:id/cancelar', auth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const emp = req.user.empresa_id;
    await query(
      `UPDATE ContasReceber SET status='cancelado', alterado_por=@uid, alterado_em=NOW()
       WHERE id=@id AND empresa_id=@emp AND status<>'recebido'`,
      { id, emp, uid: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar.' });
  }
});

module.exports = router;
