// src/routes/estoque.js
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/estoque — posição atual de todos os produtos
router.get('/', auth, async (req, res) => {
  try {
    const { busca = '', filtro = '' } = req.query;
    let where = `p.empresa_id = @emp AND p.status = 'ativo'`;
    const params = { emp: req.user.empresa_id };

    if (busca) {
      where += ` AND (p.descricao LIKE @b OR p.codigo LIKE @b)`;
      params.b = `%${busca}%`;
    }
    if (filtro === 'falta')   where += ` AND p.estoque = 0`;
    if (filtro === 'critico') where += ` AND p.estoque > 0 AND p.estoque <= p.estoque_min`;
    if (filtro === 'ok')      where += ` AND p.estoque > p.estoque_min`;

    const r = await query(`
      SELECT p.id, p.codigo, p.descricao, c.nome AS categoria,
             p.estoque, p.estoque_min,
             CASE
               WHEN p.estoque = 0            THEN 'falta'
               WHEN p.estoque <= p.estoque_min THEN 'critico'
               ELSE 'ok'
             END AS situacao
      FROM Produtos p
      LEFT JOIN Categorias c ON c.id = p.categoria_id
      WHERE ${where}
      ORDER BY p.estoque ASC, p.descricao
    `, params);

    // Resumo
    const resumo = await query(`
      SELECT
        SUM(estoque)                                   AS total_itens,
        SUM(CASE WHEN estoque = 0 THEN 1 ELSE 0 END)  AS em_falta,
        SUM(CASE WHEN estoque > 0 AND estoque <= estoque_min THEN 1 ELSE 0 END) AS critico
      FROM Produtos WHERE empresa_id=@emp AND status='ativo'
    `, { emp: req.user.empresa_id });

    res.json({ data: r.recordset, resumo: resumo.recordset[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar estoque.' });
  }
});

// GET /api/estoque/movimentacoes?de=&ate=&tipo=&busca=&page=1&limit=100
router.get('/movimentacoes', auth, async (req, res) => {
  try {
    const { de, ate, tipo, busca = '', page = 1, limit = 100 } = req.query;
    let where = `m.empresa_id = @emp`;
    const params = { emp: req.user.empresa_id };

    if (de)    { where += ` AND m.criado_em >= @de`;  params.de  = new Date(de  + 'T00:00:00'); }
    if (ate)   { where += ` AND m.criado_em <= @ate`; params.ate = new Date(ate + 'T23:59:59'); }
    if (tipo)  { where += ` AND m.tipo = @tipo`;      params.tipo = tipo; }
    if (busca) { where += ` AND p.descricao LIKE @b`; params.b   = `%${busca}%`; }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const r = await query(`
      SELECT m.id, m.criado_em, m.tipo, m.quantidade, m.saldo_anterior, m.saldo_atual,
             m.origem, p.codigo, p.descricao AS produto,
             u.nome AS usuario
      FROM MovimentacoesEstoque m
      JOIN Produtos p ON p.id = m.produto_id
      LEFT JOIN Usuarios u ON u.id = m.usuario_id
      WHERE ${where}
      ORDER BY m.criado_em DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `, params);

    const tot = await query(
      `SELECT COUNT(*) AS n FROM MovimentacoesEstoque m
       JOIN Produtos p ON p.id=m.produto_id WHERE ${where}`, params
    );

    res.json({ data: r.recordset, total: tot.recordset[0].n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar movimentações.' });
  }
});

// POST /api/estoque/entrada — entrada manual de mercadoria
router.post('/entrada', auth, async (req, res) => {
  try {
    const { produto_id, quantidade, preco_custo, observacao } = req.body;
    if (!produto_id || !quantidade || parseInt(quantidade) <= 0) {
      return res.status(400).json({ error: 'Produto e quantidade são obrigatórios.' });
    }

    // Verificar produto da empresa
    const pR = await query(
      'SELECT id, descricao, estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp',
      { pid: parseInt(produto_id), emp: req.user.empresa_id }
    );
    if (!pR.recordset.length) return res.status(404).json({ error: 'Produto não encontrado.' });

    const prod     = pR.recordset[0];
    const saldoAnt = prod.estoque;
    const qtd      = parseInt(quantidade);
    const saldoAt  = saldoAnt + qtd;

    // Atualizar estoque
    await query(`
      UPDATE Produtos
      SET estoque = estoque + @qtd,
          preco_custo   = CASE WHEN @custo > 0 THEN @custo ELSE preco_custo END,
          atualizado_em = NOW()
      WHERE id=@pid AND empresa_id=@emp
    `, {
      pid:   parseInt(produto_id),
      emp:   req.user.empresa_id,
      qtd,
      custo: parseFloat(preco_custo) || 0,
    });

    // Registrar movimentação
    await query(`
      INSERT INTO MovimentacoesEstoque
        (empresa_id, produto_id, tipo, quantidade, saldo_anterior, saldo_atual, origem, usuario_id)
      VALUES (@emp, @pid, 'entrada', @qtd, @sant, @sat, @orig, @uid)
    `, {
      emp:  req.user.empresa_id,
      pid:  parseInt(produto_id),
      qtd,
      sant: saldoAnt,
      sat:  saldoAt,
      orig: observacao || 'Entrada manual',
      uid:  req.user.id,
    });

    // Retornar produto atualizado
    const updated = await query(
      'SELECT id, codigo, descricao, estoque, estoque_min FROM Produtos WHERE id=@pid',
      { pid: parseInt(produto_id) }
    );

    res.json({ ok: true, produto: updated.recordset[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar entrada.' });
  }
});

module.exports = router;
