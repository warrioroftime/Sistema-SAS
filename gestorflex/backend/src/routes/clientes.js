// src/routes/clientes.js
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { checarLimite } = require('../lib/limites');

const BASE = `
  SELECT id, nome, nome_fantasia, documento, telefone, email,
         cep, endereco, numero, bairro, cidade, estado, ativo, criado_em
  FROM Clientes
  WHERE empresa_id = @emp AND ativo = TRUE
`;

// GET /api/clientes?busca=&page=1&limit=100
router.get('/', auth, async (req, res) => {
  try {
    const { busca = '', page = 1, limit = 200 } = req.query;
    let where = `empresa_id = @emp AND ativo = TRUE`;
    const params = { emp: req.user.empresa_id };

    if (busca) {
      where += ` AND (nome LIKE @b OR documento LIKE @b OR email LIKE @b)`;
      params.b = `%${busca}%`;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const r = await query(
      `SELECT id, nome, nome_fantasia, documento, telefone, email,
              cep, endereco, numero, bairro, cidade, estado, criado_em
       FROM Clientes WHERE ${where}
       ORDER BY nome
       LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      params
    );

    // Total de compras e valor por cliente (batch)
    const ids = r.recordset.map(c => c.id);
    let statsMap = {};
    if (ids.length) {
      const stats = await query(
        `SELECT cliente_id, COUNT(*) AS qtd_compras, SUM(total) AS total_gasto
         FROM Vendas WHERE empresa_id=@emp AND cliente_id IN (${ids.join(',')})
         GROUP BY cliente_id`,
        { emp: req.user.empresa_id }
      );
      stats.recordset.forEach(s => { statsMap[s.cliente_id] = s; });
    }

    const data = r.recordset.map(c => ({
      ...c,
      qtd_compras:  statsMap[c.id]?.qtd_compras  || 0,
      total_gasto:  statsMap[c.id]?.total_gasto   || 0,
    }));

    const tot = await query(`SELECT COUNT(*) AS n FROM Clientes WHERE ${where}`, params);
    res.json({ data, total: tot.recordset[0].n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar clientes.' });
  }
});

// GET /api/clientes/:id/historico
router.get('/:id/historico', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Verificar posse
    const c = await query(
      'SELECT id, nome FROM Clientes WHERE id=@id AND empresa_id=@emp AND ativo=TRUE',
      { id, emp: req.user.empresa_id }
    );
    if (!c.recordset.length) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const vendas = await query(`
      SELECT v.id, v.criado_em, v.total, v.desconto, v.subtotal,
             fp.nome AS pagamento,
             (SELECT STRING_AGG(p.descricao || ' (' || iv.quantidade::TEXT || ')', ', ')
              FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
              WHERE iv.venda_id=v.id) AS itens_resumo
      FROM Vendas v
      LEFT JOIN FormasPagamento fp ON fp.id=v.forma_pagamento_id
      WHERE v.empresa_id=@emp AND v.cliente_id=@cid
      ORDER BY v.criado_em DESC
    `, { emp: req.user.empresa_id, cid: id });

    const stats = await query(`
      SELECT COUNT(*) AS qtd, SUM(total) AS total_gasto, AVG(total) AS ticket_medio
      FROM Vendas WHERE empresa_id=@emp AND cliente_id=@cid
    `, { emp: req.user.empresa_id, cid: id });

    res.json({
      cliente: c.recordset[0],
      stats:   stats.recordset[0],
      vendas:  vendas.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

// GET /api/clientes/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const r = await query(
      BASE + ' AND id=@id',
      { emp: req.user.empresa_id, id: parseInt(req.params.id) }
    );
    if (!r.recordset[0]) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar cliente.' });
  }
});

// POST /api/clientes
router.post('/', auth, async (req, res) => {
  try {
    const { nome, nome_fantasia, documento, telefone, email,
            cep, endereco, numero, bairro, cidade, estado } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório.' });

    await checarLimite(req.user.empresa_id, 'clientes');

    const r = await query(`
      INSERT INTO Clientes
        (empresa_id, nome, nome_fantasia, documento, telefone, email,
         cep, endereco, numero, bairro, cidade, estado)
      VALUES (@emp, @nome, @fantasia, @doc, @tel, @email, @cep, @end, @num, @bairro, @cid, @est)
      RETURNING id
    `, {
      emp: req.user.empresa_id,
      nome, fantasia: nome_fantasia||null, doc: documento||null,
      tel: telefone||null, email: email||null,
      cep: cep||null, end: endereco||null, num: numero||null,
      bairro: bairro||null, cid: cidade||null, est: estado||null,
    });

    const id = r.recordset[0].id;
    const novo = await query(BASE + ' AND id=@id', { emp: req.user.empresa_id, id });
    res.status(201).json({ ...novo.recordset[0], qtd_compras: 0, total_gasto: 0 });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar cliente.' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nome, nome_fantasia, documento, telefone, email,
            cep, endereco, numero, bairro, cidade, estado } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório.' });

    const ex = await query(
      'SELECT id FROM Clientes WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    if (!ex.recordset.length) return res.status(404).json({ error: 'Cliente não encontrado.' });

    await query(`
      UPDATE Clientes SET
        nome=@nome, nome_fantasia=@fantasia, documento=@doc,
        telefone=@tel, email=@email,
        cep=@cep, endereco=@end, numero=@num, bairro=@bairro,
        cidade=@cid, estado=@est, atualizado_em=NOW()
      WHERE id=@id AND empresa_id=@emp
    `, {
      id, emp: req.user.empresa_id,
      nome, fantasia: nome_fantasia||null, doc: documento||null,
      tel: telefone||null, email: email||null,
      cep: cep||null, end: endereco||null, num: numero||null,
      bairro: bairro||null, cid: cidade||null, est: estado||null,
    });

    const updated = await query(BASE + ' AND id=@id', { emp: req.user.empresa_id, id });
    res.json(updated.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar cliente.' });
  }
});

// DELETE /api/clientes/:id (soft delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await query(
      'UPDATE Clientes SET ativo=FALSE, atualizado_em=NOW() WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir cliente.' });
  }
});

module.exports = router;
