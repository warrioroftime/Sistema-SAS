// src/routes/produtos.js
const router = require('express').Router();
const { query, sql } = require('../db');
const { auth } = require('../middleware/auth');

const BASE = `
  SELECT p.id, p.codigo, p.descricao, c.nome AS categoria, p.categoria_id,
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
    const params = { emp: req.user.empresa_id };

    if (busca) {
      where += ` AND (p.descricao LIKE @busca OR p.codigo LIKE @busca)`;
      params.busca = `%${busca}%`;
    }
    if (categoria) { where += ` AND c.nome = @cat`; params.cat = categoria; }
    if (status)    { where += ` AND p.status = @st`;  params.st  = status;   }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const r = await query(`
      SELECT p.id, p.codigo, p.descricao, c.nome AS categoria, p.categoria_id,
             p.preco_custo, p.preco_venda, p.estoque, p.estoque_min, p.status,
             p.controla_estoque, p.foto,
             p.criado_em, p.atualizado_em
      FROM Produtos p
      LEFT JOIN Categorias c ON c.id = p.categoria_id
      WHERE ${where}
      ORDER BY p.descricao
      OFFSET ${offset} ROWS FETCH NEXT ${parseInt(limit)} ROWS ONLY
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
      { emp: req.user.empresa_id }
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
      { emp: req.user.empresa_id, id: parseInt(req.params.id) }
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
    let { codigo, descricao, categoria_id, preco_custo, preco_venda,
          estoque = 0, estoque_min = 5, status = 'ativo',
          controla_estoque = true, foto = null } = req.body;

    if (!descricao || !preco_venda) {
      return res.status(400).json({ error: 'Descrição e preço de venda são obrigatórios.' });
    }

    codigo = codigo ? String(codigo).trim() : '';

    if (!codigo) {
      // Código não informado: gera o próximo sequencial (maior código numérico + 1)
      const seq = await query(
        `SELECT MAX(TRY_CONVERT(INT, codigo)) AS maxcod FROM Produtos WHERE empresa_id=@emp`,
        { emp: req.user.empresa_id }
      );
      codigo = String((seq.recordset[0].maxcod || 0) + 1);
    } else {
      // Código informado manualmente: garante que não está duplicado
      const dup = await query(
        'SELECT id FROM Produtos WHERE empresa_id=@emp AND codigo=@cod',
        { emp: req.user.empresa_id, cod: codigo }
      );
      if (dup.recordset.length) return res.status(409).json({ error: 'Código já cadastrado.' });
    }

    const r = await query(`
      INSERT INTO Produtos (empresa_id, codigo, descricao, categoria_id, preco_custo, preco_venda,
                            estoque, estoque_min, status, controla_estoque, foto)
      OUTPUT INSERTED.id
      VALUES (@emp, @cod, @desc, @cat, @custo, @preco, @est, @min, @st, @ce, @foto)
    `, {
      emp:   req.user.empresa_id,
      cod:   codigo,
      desc:  descricao,
      cat:   categoria_id || null,
      custo: preco_custo  || 0,
      preco: preco_venda,
      est:   estoque,
      min:   estoque_min,
      st:    status,
      ce:    controla_estoque !== false ? 1 : 0,
      foto:  foto || null,
    });

    const newId = r.recordset[0].id;

    // Registrar movimentação de estoque se estoque inicial > 0
    if (parseInt(estoque) > 0) {
      await query(`
        INSERT INTO MovimentacoesEstoque
          (empresa_id, produto_id, tipo, quantidade, saldo_anterior, saldo_atual, origem, usuario_id)
        VALUES (@emp, @pid, 'entrada', @qtd, 0, @qtd, 'Estoque inicial', @uid)
      `, { emp: req.user.empresa_id, pid: newId, qtd: parseInt(estoque), uid: req.user.id });
    }

    const prod = await query(
      BASE + ' AND p.id = @id',
      { emp: req.user.empresa_id, id: newId }
    );
    res.status(201).json(prod.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// PUT /api/produtos/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { codigo, descricao, categoria_id, preco_custo, preco_venda,
            estoque_min, status, controla_estoque, foto } = req.body;
    const id = parseInt(req.params.id);

    // Verificar posse
    const ex = await query(
      'SELECT id FROM Produtos WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    if (!ex.recordset.length) return res.status(404).json({ error: 'Produto não encontrado.' });

    // Código duplicado (exceto o próprio)
    if (codigo) {
      const dup = await query(
        'SELECT id FROM Produtos WHERE empresa_id=@emp AND codigo=@cod AND id<>@id',
        { emp: req.user.empresa_id, cod: codigo, id }
      );
      if (dup.recordset.length) return res.status(409).json({ error: 'Código já em uso.' });
    }

    await query(`
      UPDATE Produtos SET
        codigo           = COALESCE(@cod,  codigo),
        descricao        = COALESCE(@desc, descricao),
        categoria_id     = COALESCE(@cat,  categoria_id),
        preco_custo      = COALESCE(@custo,preco_custo),
        preco_venda      = COALESCE(@preco,preco_venda),
        estoque_min      = COALESCE(@min,  estoque_min),
        status           = COALESCE(@st,   status),
        controla_estoque = COALESCE(@ce,   controla_estoque),
        foto             = CASE WHEN @foto IS NOT NULL THEN @foto ELSE foto END,
        atualizado_em    = GETDATE()
      WHERE id=@id AND empresa_id=@emp
    `, {
      id, emp: req.user.empresa_id,
      cod:   codigo        ?? null,
      desc:  descricao     ?? null,
      cat:   categoria_id  ?? null,
      custo: preco_custo   ?? null,
      preco: preco_venda   ?? null,
      min:   estoque_min   ?? null,
      st:    status        ?? null,
      ce:    controla_estoque !== undefined ? (controla_estoque !== false ? 1 : 0) : null,
      foto:  foto !== undefined ? (foto || null) : null,
    });

    const prod = await query(BASE + ' AND p.id=@id', { emp: req.user.empresa_id, id });
    res.json(prod.recordset[0]);
  } catch (err) {
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
      'SELECT TOP 1 id FROM ItensVenda WHERE produto_id=@id', { id }
    );
    if (ref.recordset.length) {
      // Apenas inativar, não excluir fisicamente
      await query(
        'UPDATE Produtos SET status=\'inativo\', atualizado_em=GETDATE() WHERE id=@id AND empresa_id=@emp',
        { id, emp: req.user.empresa_id }
      );
      return res.json({ ok: true, aviso: 'Produto possui vendas; foi inativado em vez de excluído.' });
    }
    await query(
      'DELETE FROM Produtos WHERE id=@id AND empresa_id=@emp',
      { id, emp: req.user.empresa_id }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
});

module.exports = router;
