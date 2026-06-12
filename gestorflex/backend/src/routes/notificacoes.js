// src/routes/notificacoes.js — Central de alertas (estoque, contas, plano)
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/notificacoes
router.get('/', auth, async (req, res) => {
  try {
    const emp = req.user.empresa_id;
    const notifs = [];

    // Estoque baixo / em falta
    const est = (await query(`
      SELECT SUM(CASE WHEN estoque=0 THEN 1 ELSE 0 END) AS falta,
             SUM(CASE WHEN estoque>0 AND estoque<=estoque_min THEN 1 ELSE 0 END) AS critico
      FROM Produtos WHERE empresa_id=@emp AND status='ativo'
    `, { emp })).recordset[0];
    if (Number(est.falta) > 0)
      notifs.push({ tipo: 'estoque', cor: 'red', icone: 'fa-triangle-exclamation',
        titulo: `${est.falta} produto(s) em falta`, descricao: 'Sem estoque disponível.', pagina: 'estoque' });
    if (Number(est.critico) > 0)
      notifs.push({ tipo: 'estoque', cor: 'amber', icone: 'fa-box-open',
        titulo: `${est.critico} produto(s) com estoque baixo`, descricao: 'Abaixo do estoque mínimo.', pagina: 'estoque' });

    // Contas a receber vencidas / vencendo hoje
    const cr = (await query(`
      SELECT
        SUM(CASE WHEN data_vencimento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS vencidas,
        SUM(CASE WHEN CAST(data_vencimento AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS hoje,
        COALESCE(SUM(CASE WHEN data_vencimento < CAST(GETDATE() AS DATE) THEN (valor - COALESCE(valor_recebido,0)) ELSE 0 END),0) AS valor_vencido
      FROM ContasReceber WHERE empresa_id=@emp AND status IN ('pendente','parcial')
    `, { emp })).recordset[0];
    if (Number(cr.vencidas) > 0)
      notifs.push({ tipo: 'receber', cor: 'red', icone: 'fa-hand-holding-dollar',
        titulo: `${cr.vencidas} título(s) a receber vencidos`, descricao: `Total vencido em aberto.`, pagina: 'contas-receber' });
    if (Number(cr.hoje) > 0)
      notifs.push({ tipo: 'receber', cor: 'amber', icone: 'fa-calendar-day',
        titulo: `${cr.hoje} recebimento(s) vencem hoje`, descricao: 'Confira as contas a receber.', pagina: 'contas-receber' });

    // Contas a pagar vencidas / vencendo hoje
    const cp = (await query(`
      SELECT
        SUM(CASE WHEN data_vencimento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS vencidas,
        SUM(CASE WHEN CAST(data_vencimento AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS hoje
      FROM ContasPagar WHERE empresa_id=@emp AND status IN ('pendente','parcial')
    `, { emp })).recordset[0];
    if (Number(cp.vencidas) > 0)
      notifs.push({ tipo: 'pagar', cor: 'red', icone: 'fa-file-invoice-dollar',
        titulo: `${cp.vencidas} conta(s) a pagar vencidas`, descricao: 'Pague para evitar juros.', pagina: 'contas-pagar' });
    if (Number(cp.hoje) > 0)
      notifs.push({ tipo: 'pagar', cor: 'amber', icone: 'fa-calendar-day',
        titulo: `${cp.hoje} conta(s) a pagar vencem hoje`, descricao: 'Confira as contas a pagar.', pagina: 'contas-pagar' });

    // Plano do tenant vencendo (somente quando há data de vencimento e <= 7 dias)
    const empd = (await query(`
      SELECT data_vencimento, DATEDIFF(DAY, CAST(GETDATE() AS DATE), data_vencimento) AS dias
      FROM Empresas WHERE id=@emp
    `, { emp })).recordset[0];
    if (empd && empd.data_vencimento != null && empd.dias != null) {
      if (Number(empd.dias) < 0)
        notifs.push({ tipo: 'plano', cor: 'red', icone: 'fa-gem',
          titulo: 'Assinatura vencida', descricao: 'Regularize para evitar bloqueio.', pagina: 'minha-empresa' });
      else if (Number(empd.dias) <= 7)
        notifs.push({ tipo: 'plano', cor: 'amber', icone: 'fa-gem',
          titulo: `Assinatura vence em ${empd.dias} dia(s)`, descricao: 'Renove sua assinatura.', pagina: 'minha-empresa' });
    }

    res.json({ total: notifs.length, notificacoes: notifs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar notificações.' });
  }
});

module.exports = router;
