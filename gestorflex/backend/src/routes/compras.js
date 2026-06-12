// src/routes/compras.js — Entrada de mercadoria (compras) com atualização de estoque
const router = require('express').Router();
const { query, getPool, clientQuery } = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/compras?de=&ate=
router.get('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    let where = 'c.empresa_id=@emp';
    const params = { emp };
    if (req.query.de)  { where += ' AND c.criado_em >= @de';  params.de  = new Date(req.query.de + 'T00:00:00'); }
    if (req.query.ate) { where += ' AND c.criado_em <= @ate'; params.ate = new Date(req.query.ate + 'T23:59:59'); }
    const r = await query(`
      SELECT c.id, c.criado_em, c.numero_documento, c.total, c.observacao, c.gerou_conta_pagar,
             COALESCE(f.nome,'—') AS fornecedor,
             (SELECT COUNT(*) FROM ItensCompra WHERE compra_id=c.id) AS qtd_itens
      FROM Compras c LEFT JOIN Fornecedores f ON f.id=c.fornecedor_id
      WHERE ${where} ORDER BY c.criado_em DESC
    `, params);
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao listar compras.' }); }
});

// GET /api/compras/:id — detalhe com itens
router.get('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const c = await query(`
      SELECT c.id, c.criado_em, c.numero_documento, c.total, c.observacao, c.gerou_conta_pagar,
             COALESCE(f.nome,'—') AS fornecedor
      FROM Compras c LEFT JOIN Fornecedores f ON f.id=c.fornecedor_id
      WHERE c.id=@id AND c.empresa_id=@emp
    `, { id, emp: req.user.empresa_id });
    if (!c.recordset[0]) return res.status(404).json({ error: 'Compra não encontrada.' });
    const itens = await query(`
      SELECT ic.quantidade, ic.custo_unit, ic.subtotal, p.codigo, p.descricao
      FROM ItensCompra ic JOIN Produtos p ON p.id=ic.produto_id WHERE ic.compra_id=@id
    `, { id });
    res.json({ ...c.recordset[0], itens: itens.recordset });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar compra.' }); }
});

// POST /api/compras — registra entrada de mercadoria
router.post('/', auth, async (req, res) => {
  const emp = req.user.empresa_id;
  const b = req.body;
  if (!b.itens || !b.itens.length) return res.status(400).json({ error: 'Adicione ao menos um produto.' });

  const pool = await getPool();
  const client = await pool.connect();
  try {
    const itens = b.itens
      .map(i => ({ produto_id: parseInt(i.produto_id), quantidade: parseInt(i.quantidade) || 0, custo_unit: parseFloat(i.custo_unit) || 0 }))
      .filter(i => i.produto_id && i.quantidade > 0);
    if (!itens.length) return res.status(400).json({ error: 'Itens inválidos.' });
    itens.forEach(i => { i.subtotal = +(i.quantidade * i.custo_unit).toFixed(2); });
    const total = +itens.reduce((s, i) => s + i.subtotal, 0).toFixed(2);

    await client.query('BEGIN');

    const cR = await clientQuery(client, `
      INSERT INTO Compras (empresa_id, fornecedor_id, numero_documento, total, observacao, gerou_conta_pagar, usuario_id)
      VALUES (@emp,@fid,@ndoc,@tot,@obs,@gcp,@uid) RETURNING id
    `, {
      emp, fid: b.fornecedor_id || null, ndoc: b.numero_documento || null,
      tot: total, obs: b.observacao || null, gcp: !!b.gerar_conta_pagar, uid: req.user.id
    });
    const compraId = cR.recordset[0].id;

    for (const it of itens) {
      await clientQuery(client,
        `INSERT INTO ItensCompra (compra_id,produto_id,quantidade,custo_unit,subtotal) VALUES (@cid,@pid,@qty,@cu,@sub)`,
        { cid: compraId, pid: it.produto_id, qty: it.quantidade, cu: it.custo_unit, sub: it.subtotal }
      );

      const pR = await clientQuery(client,
        `SELECT estoque, controla_estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp`,
        { pid: it.produto_id, emp }
      );
      if (!pR.recordset[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Produto ID ${it.produto_id} não encontrado.` });
      }
      const saldoAnt = pR.recordset[0].estoque;
      const saldoAtual = saldoAnt + it.quantidade;
      const attCusto = !!(b.atualizar_custo && it.custo_unit > 0);

      await clientQuery(client, `
        UPDATE Produtos SET estoque=estoque+@qty,
          preco_custo = CASE WHEN @attCusto THEN @cu ELSE preco_custo END,
          atualizado_em=NOW()
        WHERE id=@pid AND empresa_id=@emp
      `, { qty: it.quantidade, attCusto, cu: it.custo_unit, pid: it.produto_id, emp });

      await clientQuery(client,
        `INSERT INTO MovimentacoesEstoque (empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_atual,origem,usuario_id)
         VALUES (@emp,@pid,'entrada',@qty,@sant,@sat,@orig,@uid)`,
        { emp, pid: it.produto_id, qty: it.quantidade, sant: saldoAnt, sat: saldoAtual,
          orig: `Compra #${compraId}`, uid: req.user.id }
      );
    }

    if (b.gerar_conta_pagar && total > 0) {
      let fornNome = 'Compra de mercadoria';
      if (b.fornecedor_id) {
        const f = await clientQuery(client,
          `SELECT nome FROM Fornecedores WHERE id=@fid AND empresa_id=@emp`,
          { fid: b.fornecedor_id, emp }
        );
        if (f.recordset[0]) fornNome = f.recordset[0].nome;
      }
      await clientQuery(client,
        `INSERT INTO ContasPagar (empresa_id, fornecedor, categoria, descricao, numero_documento, valor, data_emissao, data_vencimento, status, criado_por)
         VALUES (@emp,@forn,'Mercadoria',@desc,@ndoc,@val,NOW(),@dv,'pendente',@uid)`,
        { emp, forn: fornNome, desc: `Compra #${compraId}`, ndoc: b.numero_documento || null,
          val: total, dv: b.data_vencimento ? new Date(b.data_vencimento) : null, uid: req.user.id }
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: compraId, total });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar compra.' });
  } finally {
    client.release();
  }
});

module.exports = router;
