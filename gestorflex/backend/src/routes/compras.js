// src/routes/compras.js — Entrada de mercadoria (compras) com atualização de estoque
const router = require('express').Router();
const { query, sql, getPool } = require('../db');
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

// POST /api/compras — registra entrada: incrementa estoque + (opcional) gera conta a pagar
// body: { fornecedor_id, numero_documento, observacao, itens:[{produto_id,quantidade,custo_unit}],
//         atualizar_custo, gerar_conta_pagar, data_vencimento }
router.post('/', auth, async (req, res) => {
  const emp = req.user.empresa_id;
  const b = req.body;
  if (!b.itens || !b.itens.length) return res.status(400).json({ error: 'Adicione ao menos um produto.' });

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    // Monta itens com subtotal
    const itens = b.itens
      .map(i => ({ produto_id: parseInt(i.produto_id), quantidade: parseInt(i.quantidade) || 0, custo_unit: parseFloat(i.custo_unit) || 0 }))
      .filter(i => i.produto_id && i.quantidade > 0);
    if (!itens.length) return res.status(400).json({ error: 'Itens inválidos.' });
    itens.forEach(i => { i.subtotal = +(i.quantidade * i.custo_unit).toFixed(2); });
    const total = +itens.reduce((s, i) => s + i.subtotal, 0).toFixed(2);

    await transaction.begin();

    // Cria a compra
    const cReq = new sql.Request(transaction);
    cReq.input('emp', emp); cReq.input('fid', b.fornecedor_id || null);
    cReq.input('ndoc', b.numero_documento || null); cReq.input('tot', total);
    cReq.input('obs', b.observacao || null); cReq.input('gcp', b.gerar_conta_pagar ? 1 : 0);
    cReq.input('uid', req.user.id);
    const cR = await cReq.query(`
      INSERT INTO Compras (empresa_id, fornecedor_id, numero_documento, total, observacao, gerou_conta_pagar, usuario_id)
      OUTPUT INSERTED.id VALUES (@emp,@fid,@ndoc,@tot,@obs,@gcp,@uid)
    `);
    const compraId = cR.recordset[0].id;

    // Itens + entrada de estoque + (opcional) atualiza custo do produto
    for (const it of itens) {
      const ic = new sql.Request(transaction);
      ic.input('cid', compraId); ic.input('pid', it.produto_id); ic.input('qty', it.quantidade);
      ic.input('cu', it.custo_unit); ic.input('sub', it.subtotal);
      await ic.query(`INSERT INTO ItensCompra (compra_id,produto_id,quantidade,custo_unit,subtotal)
                      VALUES (@cid,@pid,@qty,@cu,@sub)`);

      const pr = new sql.Request(transaction);
      pr.input('pid', it.produto_id); pr.input('emp', emp);
      const pR = await pr.query(`SELECT estoque, controla_estoque FROM Produtos WHERE id=@pid AND empresa_id=@emp`);
      if (!pR.recordset[0]) { await transaction.rollback(); return res.status(400).json({ error: `Produto ID ${it.produto_id} não encontrado.` }); }
      const saldoAnt = pR.recordset[0].estoque;
      const saldoAtual = saldoAnt + it.quantidade;

      const up = new sql.Request(transaction);
      up.input('pid', it.produto_id); up.input('emp', emp); up.input('qty', it.quantidade);
      up.input('cu', it.custo_unit); up.input('attCusto', b.atualizar_custo && it.custo_unit > 0 ? 1 : 0);
      await up.query(`UPDATE Produtos SET estoque=estoque+@qty,
                        preco_custo = CASE WHEN @attCusto=1 THEN @cu ELSE preco_custo END,
                        atualizado_em=GETDATE()
                      WHERE id=@pid AND empresa_id=@emp`);

      const mv = new sql.Request(transaction);
      mv.input('emp', emp); mv.input('pid', it.produto_id); mv.input('qty', it.quantidade);
      mv.input('sant', saldoAnt); mv.input('sat', saldoAtual); mv.input('orig', `Compra #${compraId}`); mv.input('uid', req.user.id);
      await mv.query(`INSERT INTO MovimentacoesEstoque (empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_atual,origem,usuario_id)
                      VALUES (@emp,@pid,'entrada',@qty,@sant,@sat,@orig,@uid)`);
    }

    // Gera conta a pagar (opcional)
    if (b.gerar_conta_pagar && total > 0) {
      let fornNome = 'Compra de mercadoria';
      if (b.fornecedor_id) {
        const fr = new sql.Request(transaction);
        fr.input('fid', b.fornecedor_id); fr.input('emp', emp);
        const f = await fr.query(`SELECT nome FROM Fornecedores WHERE id=@fid AND empresa_id=@emp`);
        if (f.recordset[0]) fornNome = f.recordset[0].nome;
      }
      const cp = new sql.Request(transaction);
      cp.input('emp', emp); cp.input('forn', fornNome); cp.input('desc', `Compra #${compraId}`);
      cp.input('ndoc', b.numero_documento || null); cp.input('val', total);
      cp.input('dv', b.data_vencimento ? new Date(b.data_vencimento) : null); cp.input('uid', req.user.id);
      await cp.query(`INSERT INTO ContasPagar (empresa_id, fornecedor, categoria, descricao, numero_documento, valor, data_emissao, data_vencimento, status, criado_por)
                      VALUES (@emp,@forn,'Mercadoria',@desc,@ndoc,@val,GETDATE(),@dv,'pendente',@uid)`);
    }

    await transaction.commit();
    res.status(201).json({ id: compraId, total });
  } catch (err) {
    try { await transaction.rollback(); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar compra.' });
  }
});

module.exports = router;
