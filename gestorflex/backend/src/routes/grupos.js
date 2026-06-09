// src/routes/grupos.js — Grupos de produtos (tabela Categorias)
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/grupos — lista grupos com quantidade de produtos vinculados
router.get('/', auth, async (req, res) => {
  try {
    const r = await query(`
      SELECT c.id, c.nome, COUNT(p.id) AS qtd_produtos
      FROM Categorias c
      LEFT JOIN Produtos p ON p.categoria_id = c.id
      WHERE c.empresa_id = @emp
      GROUP BY c.id, c.nome
      ORDER BY c.nome
    `, { emp: req.user.empresa_id });
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar grupos.' });
  }
});

// POST /api/grupos
router.post('/', auth, async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome do grupo obrigatório.' });

    const dup = await query(
      'SELECT id FROM Categorias WHERE empresa_id=@emp AND nome=@nome',
      { emp: req.user.empresa_id, nome }
    );
    if (dup.recordset.length) return res.status(409).json({ error: 'Já existe um grupo com esse nome.' });

    const r = await query(
      'INSERT INTO Categorias (empresa_id, nome) OUTPUT INSERTED.id VALUES (@emp, @nome)',
      { emp: req.user.empresa_id, nome }
    );
    res.status(201).json({ id: r.recordset[0].id, nome });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar grupo.' });
  }
});

// PUT /api/grupos/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome do grupo obrigatório.' });

    const ex = await query(
      'SELECT id FROM Categorias WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    if (!ex.recordset.length) return res.status(404).json({ error: 'Grupo não encontrado.' });

    const dup = await query(
      'SELECT id FROM Categorias WHERE empresa_id=@emp AND nome=@nome AND id<>@id',
      { emp: req.user.empresa_id, nome, id }
    );
    if (dup.recordset.length) return res.status(409).json({ error: 'Já existe um grupo com esse nome.' });

    await query(
      'UPDATE Categorias SET nome=@nome WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id, nome }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar grupo.' });
  }
});

// DELETE /api/grupos/:id — desvincula produtos (categoria_id=NULL) e remove o grupo
router.delete('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ex = await query(
      'SELECT id FROM Categorias WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    if (!ex.recordset.length) return res.status(404).json({ error: 'Grupo não encontrado.' });

    const desvinc = await query(
      'UPDATE Produtos SET categoria_id=NULL WHERE categoria_id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    await query(
      'DELETE FROM Categorias WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );

    const afetados = desvinc.rowsAffected ? desvinc.rowsAffected[0] : 0;
    res.json({
      ok: true,
      aviso: afetados > 0
        ? `Grupo excluído. ${afetados} produto(s) ficaram sem grupo.`
        : undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir grupo.' });
  }
});

module.exports = router;
