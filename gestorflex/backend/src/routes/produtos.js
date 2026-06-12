// src/routes/produtos.js
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { checarLimite, checarArmazenamento } = require('../lib/limites');

const BASE = `
  SELECT p.id, p.codigo, p.codigo_barras, p.descricao, c.nome AS categoria, p.categoria_id,
         p.preco_custo, p.preco_venda, p.estoque, p.estoque_min, p.status,
         p.controla_estoque, p.foto,
         p.criado_em, p.atualizado_em
  FROM Produtos p
  LEFT JOIN Categorias c ON c.id = p.categoria_id
  WHERE p.empresa_id = @emp
`;

// GET /api/produtos?busca=&categoria=&status=&page=1&limit=50
router.get('/', auth, async (req, res) => {
  try {
    const { busca = '', categoria = '', status = '', page = 1, limit = 200 } = req.query;
    let where = `p.empresa_id = @emp`;
    const params = { emp: req.user.grupo_id };

    if (busca) {
      where += ` AND (p.descricao LIKE @busca OR p.codigo LIKE @busca OR COALESCE(p.codigo_barras,'') LIKE @busca)`;
      params.busca = `%${busca}%`;
    }
    if (categoria) { where += ` AND c.nome = @cat`; params.cat = categoria; }
    if (status)    { where += ` AND p.status = @st`;  params.st  = status;   }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const r = await query(`
      SELECT p.id, p.codigo, p.codigo_barras, p.descricao, c.nome AS categoria, p.categoria_id,
             p.preco_custo, p.preco_venda, p.estoque, p.estoque_min, p.status,
             p.controla_estoque, p.foto,
             p.criado_em, p.atualizado_em
      FROM Produtos p
      LEFT JOIN Categorias c ON c.id = p.categoria_id
      WHERE ${where}
      ORDER BY p.descricao
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `, params);

    const total = await query(
      `SELECT COUNT(*) AS n FROM Produtos p LEFT JOIN Categorias c ON c.id=p.categoria_id WHERE ${where}`,
      params
    );

    res.json({ data: r.recordset, total: total.recordset[0].n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
});

// GET /api/produtos/categorias — lista categorias da empresa
router.get('/categorias', auth, async (req, res) => {
  try {
    const r = await query(
      'SELECT id, nome FROM Categorias WHERE empresa_id=@emp ORDER BY nome',
      { emp: req.user.grupo_id }
    );
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar categorias.' });
  }
});

// GET /api/produtos/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const r = await query(
      BASE + ' AND p.id = @id',
      { emp: req.user.grupo_id, id: parseInt(req.params.id) }
    );
    if (!r.recordset[0]) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json(r.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar produto.' });
  }
});

// POST /api/produtos
router.post('/', auth, async (req, res) => {
  try {
    let { codigo, codigo_barras, descricao, categoria_id, preco_custo, preco_venda,
          estoque = 0, estoque_min = 5, status = 'ativo',
          controla_estoque = true, foto = null } = req.body;

    if (!descricao || !preco_venda) {
      return res.status(400).json({ error: 'Descrição e preço de venda são obrigatórios.' });
    }

    await checarLimite(req.user.grupo_id, 'produtos');
    if (foto) await checarArmazenamento(req.user.grupo_id, foto);

    codigo = codigo ? String(codigo).trim() : '';

    if (!codigo) {
      // Código não informado: gera o próximo sequencial (maior código numérico + 1)
      const seq = await query(
        `SELECT MAX(CASE WHEN codigo ~ '^[0-9]+$' THEN codigo::INTEGER ELSE NULL END) AS maxcod FROM Produtos WHERE empresa_id=@emp`,
        { emp: req.user.grupo_id }
      );
      codigo = String((seq.recordset[0].maxcod || 0) + 1);
    } else {
      // Código informado manualmente: garante que não está duplicado
      const dup = await query(
        'SELECT id FROM Produtos WHERE empresa_id=@emp AND codigo=@cod',
        { emp: req.user.grupo_id, cod: codigo }
      );
      if (dup.recordset.length) return res.status(409).json({ error: 'Código já cadastrado.' });
    }

    const r = await query(`
      INSERT INTO Produtos (empresa_id, codigo, codigo_barras, descricao, categoria_id, preco_custo, preco_venda,
                            estoque, estoque_min, status, controla_estoque, foto)
      VALUES (@emp, @cod, @barras, @desc, @cat, @custo, @preco, @est, @min, @st, @ce, @foto)
      RETURNING id
    `, {
      emp:    req.user.grupo_id,
      cod:    codigo,
      barras: codigo_barras ? String(codigo_barras).trim() : null,
      desc:   descricao,
      cat:    categoria_id || null,
      custo:  preco_custo  || 0,
      preco:  preco_venda,
      est:    estoque,
      min:    estoque_min,
      st:     status,
      ce:     controla_estoque !== false,
      foto:   foto || null,
    });

    const newId = r.recordset[0].id;

    // Registrar movimentação de estoque se estoque inicial > 0
    if (parseInt(estoque) > 0) {
      await query(`
        INSERT INTO MovimentacoesEstoque
          (empresa_id, produto_id, tipo, quantidade, saldo_anterior, saldo_atual, origem, usuario_id)
        VALUES (@emp, @pid, 'entrada', @qtd, 0, @qtd, 'Estoque inicial', @uid)
      `, { emp: req.user.grupo_id, pid: newId, qtd: parseInt(estoque), uid: req.user.id });
    }

    const prod = await query(
      BASE + ' AND p.id = @id',
      { emp: req.user.grupo_id, id: newId }
    );
    res.status(201).json(prod.recordset[0]);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// PUT /api/produtos/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { codigo, codigo_barras, descricao, categoria_id, preco_custo, preco_venda,
            estoque_min, status, controla_estoque, foto } = req.body;
    const id = parseInt(req.params.id);

    // Verificar posse
    const ex = await query(
      'SELECT id FROM Produtos WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.grupo_id }
    );
    if (!ex.recordset.length) return res.status(404).json({ error: 'Produto não encontrado.' });

    if (foto) await checarArmazenamento(req.user.grupo_id, foto);

    // Código duplicado (exceto o próprio)
    if (codigo) {
      const dup = await query(
        'SELECT id FROM Produtos WHERE empresa_id=@emp AND codigo=@cod AND id<>@id',
        { emp: req.user.grupo_id, cod: codigo, id }
      );
      if (dup.recordset.length) return res.status(409).json({ error: 'Código já em uso.' });
    }

    await query(`
      UPDATE Produtos SET
        codigo           = COALESCE(@cod,    codigo),
        codigo_barras    = CASE WHEN @barrasSet THEN @barras ELSE codigo_barras END,
        descricao        = COALESCE(@desc,   descricao),
        categoria_id     = COALESCE(@cat,    categoria_id),
        preco_custo      = COALESCE(@custo,  preco_custo),
        preco_venda      = COALESCE(@preco,  preco_venda),
        estoque_min      = COALESCE(@min,    estoque_min),
        status           = COALESCE(@st,     status),
        controla_estoque = COALESCE(@ce,     controla_estoque),
        foto             = CASE WHEN @foto IS NOT NULL THEN @foto ELSE foto END,
        atualizado_em    = NOW()
      WHERE id=@id AND empresa_id=@emp
    `, {
      id, emp: req.user.grupo_id,
      cod:       codigo        ?? null,
      barrasSet: codigo_barras !== undefined,
      barras:    codigo_barras !== undefined ? (codigo_barras ? String(codigo_barras).trim() : null) : null,
      desc:      descricao     ?? null,
      cat:       categoria_id  ?? null,
      custo:     preco_custo   ?? null,
      preco:     preco_venda   ?? null,
      min:       estoque_min   ?? null,
      st:        status        ?? null,
      ce:        controla_estoque !== undefined ? (controla_estoque !== false) : null,
      foto:      foto !== undefined ? (foto || null) : null,
    });

    const prod = await query(BASE + ' AND p.id=@id', { emp: req.user.grupo_id, id });
    res.json(prod.recordset[0]);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar produto.' });
  }
});

// DELETE /api/produtos/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Verificar se há itens de venda referenciando
    const ref = await query(
      'SELECT id FROM ItensVenda WHERE produto_id=@id LIMIT 1', { id }
    );
    if (ref.recordset.length) {
      // Apenas inativar, não excluir fisicamente
      await query(
        'UPDATE Produtos SET status=\'inativo\', atualizado_em=NOW() WHERE id=@id AND empresa_id=@emp',
        { id, emp: req.user.grupo_id }
      );
      return res.json({ ok: true, aviso: 'Produto possui vendas; foi inativado em vez de excluído.' });
    }
    await query(
      'DELETE FROM Produtos WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.grupo_id }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
});

module.exports = router;
