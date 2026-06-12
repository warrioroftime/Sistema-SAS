// src/routes/comissoes.js — Cálculo de comissão por vendedor
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

const dDe  = s => new Date((s || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]) + 'T00:00:00');
const dAte = s => new Date((s || new Date().toISOString().split('T')[0]) + 'T23:59:59');

// GET /api/comissoes?de=&ate=
// Base = total das vendas ativas do vendedor − devoluções parciais. Comissão = base × %.
router.get('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const de = dDe(req.query.de), ate = dAte(req.query.ate);

    const vendas = (await query(`
      SELECT u.id AS usuario_id, u.nome AS vendedor, u.comissao_percentual AS percentual,
             COUNT(v.id) AS qtd_vendas, COALESCE(SUM(v.total),0) AS total_vendido
      FROM Usuarios u
      JOIN Vendas v ON v.usuario_id = u.id
      WHERE v.empresa_id=@emp AND v.status='ativa' AND v.criado_em BETWEEN @de AND @ate
      GROUP BY u.id, u.nome, u.comissao_percentual
    `, { emp, de, ate })).recordset;

    // Devoluções parciais (vendas continuam ativas) — reduzem a base
    const devol = (await query(`
      SELECT v.usuario_id, COALESCE(SUM(d.valor),0) AS devolvido
      FROM Devolucoes d JOIN Vendas v ON v.id = d.venda_id
      WHERE v.empresa_id=@emp AND d.tipo='parcial' AND v.status='ativa' AND v.criado_em BETWEEN @de AND @ate
      GROUP BY v.usuario_id
    `, { emp, de, ate })).recordset;
    const devMap = {}; devol.forEach(d => { devMap[d.usuario_id] = Number(d.devolvido); });

    const linhas = vendas.map(v => {
      const devolvido = devMap[v.usuario_id] || 0;
      const base = Math.max(Number(v.total_vendido) - devolvido, 0);
      const perc = Number(v.percentual) || 0;
      const comissao = +(base * perc / 100).toFixed(2);
      return {
        usuario_id: v.usuario_id, vendedor: v.vendedor, qtd_vendas: v.qtd_vendas,
        total_vendido: Number(v.total_vendido), devolvido, base, percentual: perc, comissao,
      };
    }).sort((a, b) => b.comissao - a.comissao);

    const totalComissao = +linhas.reduce((s, l) => s + l.comissao, 0).toFixed(2);
    const totalBase = +linhas.reduce((s, l) => s + l.base, 0).toFixed(2);
    res.json({ periodo: { de: req.query.de, ate: req.query.ate }, total_base: totalBase, total_comissao: totalComissao, linhas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao calcular comissões.' });
  }
});

// POST /api/comissoes/lancar — gera conta a pagar da comissão de um vendedor
// body: { usuario_id, vendedor, valor, periodo, data_vencimento }
router.post('/lancar', auth, async (req, res) => {
  try {
    const b = req.body;
    const valor = parseFloat(b.valor) || 0;
    if (!b.usuario_id || valor <= 0) return res.status(400).json({ error: 'Vendedor e valor são obrigatórios.' });
    const nome = b.vendedor || 'vendedor';
    await query(`
      INSERT INTO ContasPagar (empresa_id, fornecedor, categoria, descricao, valor, data_emissao, data_vencimento, status, criado_por)
      VALUES (@emp, @forn, 'Comissão', @desc, @val, NOW(), @dv, 'pendente', @uid)
    `, {
      emp: req.user.empresa_id, forn: `Comissão - ${nome}`,
      desc: b.periodo ? `Comissão (${b.periodo})` : 'Comissão de vendas',
      val: valor, dv: b.data_vencimento ? new Date(b.data_vencimento) : null, uid: req.user.id,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao lançar comissão.' });
  }
});

module.exports = router;
