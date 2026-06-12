// src/routes/fornecedores.js — CRUD de fornecedores
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/fornecedores?busca=&incluir_inativos=
router.get('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const busca = req.query.busca || '';
    let where = 'empresa_id=@emp';
    const params = { emp };
    if (!req.query.incluir_inativos) where += ' AND ativo=TRUE';
    if (busca) { where += ' AND (nome LIKE @b OR documento LIKE @b)'; params.b = `%${busca}%`; }
    const r = await query(`
      SELECT id, nome, documento, telefone, email, endereco, cidade, estado, observacao, ativo, criado_em
      FROM Fornecedores WHERE ${where} ORDER BY nome ASC
    `, params);
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao listar fornecedores.' }); }
});

// POST /api/fornecedores
router.post('/', auth, async (req, res) => {
  try {
    const b = req.body;
    if (!b.nome || !b.nome.trim()) return res.status(400).json({ error: 'Nome do fornecedor é obrigatório.' });
    const r = await query(`
      INSERT INTO Fornecedores (empresa_id, nome, documento, telefone, email, endereco, cidade, estado, observacao)
      VALUES (@emp, @nome, @doc, @tel, @email, @end, @cid, @uf, @obs)
      RETURNING id
    `, {
      emp: req.user.empresa_id, nome: b.nome.trim(), doc: b.documento || null, tel: b.telefone || null,
      email: b.email || null, end: b.endereco || null, cid: b.cidade || null,
      uf: b.estado || null, obs: b.observacao || null,
    });
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar fornecedor.' }); }
});

// PUT /api/fornecedores/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const b = req.body;
    if (!b.nome || !b.nome.trim()) return res.status(400).json({ error: 'Nome do fornecedor é obrigatório.' });
    await query(`
      UPDATE Fornecedores SET nome=@nome, documento=@doc, telefone=@tel, email=@email,
             endereco=@end, cidade=@cid, estado=@uf, observacao=@obs
      WHERE id=@id AND empresa_id=@emp
    `, {
      nome: b.nome.trim(), doc: b.documento || null, tel: b.telefone || null, email: b.email || null,
      end: b.endereco || null, cid: b.cidade || null, uf: b.estado || null, obs: b.observacao || null,
      id: parseInt(req.params.id), emp: req.user.empresa_id,
    });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao atualizar fornecedor.' }); }
});

// PATCH /api/fornecedores/:id/toggle
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    await query(`UPDATE Fornecedores SET ativo = NOT ativo WHERE id=@id AND empresa_id=@emp`,
      { id: parseInt(req.params.id), emp: req.user.empresa_id });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao alterar status.' }); }
});

module.exports = router;
