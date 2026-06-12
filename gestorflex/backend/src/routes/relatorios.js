// src/routes/relatorios.js
const router = require('express').Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────
const dDe  = (s) => new Date((s || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]) + 'T00:00:00');
const dAte = (s) => new Date((s || new Date().toISOString().split('T')[0]) + 'T23:59:59');

// ──────────────────────────────────────────────────────────────────
// DASHBOARD (usado pela home) — mantido
// ──────────────────────────────────────────────────────────────────
router.get('/dashboard', auth, async (req, res) => {
  try {
    const dias = parseInt(req.query.periodo) || 30;
    const emp  = req.user.empresa_id;

    const kpis = await query(`
      SELECT COUNT(*) AS qtd_vendas, COALESCE(SUM(total),0) AS faturamento,
             COALESCE(AVG(total),0) AS ticket_medio, COALESCE(SUM(desconto),0) AS total_descontos
      FROM Vendas WHERE empresa_id=@emp AND status='ativa' AND criado_em >= DATEADD(DAY,-@dias,GETDATE())
    `, { emp, dias });

    const estoque = await query(`
      SELECT COALESCE(SUM(estoque),0) AS total_itens,
             SUM(CASE WHEN estoque=0 THEN 1 ELSE 0 END) AS em_falta,
             SUM(CASE WHEN estoque>0 AND estoque<=estoque_min THEN 1 ELSE 0 END) AS critico
      FROM Produtos WHERE empresa_id=@emp AND status='ativo'
    `, { emp });

    const topProd = await query(`
      SELECT TOP 6 p.descricao, SUM(iv.quantidade) AS qtd_vendida
      FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id JOIN Vendas v ON v.id=iv.venda_id
      WHERE v.empresa_id=@emp AND v.criado_em >= DATEADD(DAY,-@dias,GETDATE())
      GROUP BY p.id,p.descricao ORDER BY qtd_vendida DESC
    `, { emp, dias });

    const ultimasVendas = await query(`
      SELECT TOP 5 v.id, v.criado_em, v.total, fp.nome AS pagamento,
             COALESCE(c.nome,'Consumidor') AS cliente,
             (SELECT COUNT(*) FROM ItensVenda WHERE venda_id=v.id) AS qtd_itens
      FROM Vendas v LEFT JOIN Clientes c ON c.id=v.cliente_id
      LEFT JOIN FormasPagamento fp ON fp.id=v.forma_pagamento_id
      WHERE v.empresa_id=@emp ORDER BY v.criado_em DESC
    `, { emp });

    const alertas = await query(`
      SELECT TOP 10 id, codigo, descricao, estoque, estoque_min,
             CASE WHEN estoque=0 THEN 'falta' ELSE 'critico' END AS tipo
      FROM Produtos WHERE empresa_id=@emp AND status='ativo' AND estoque<=estoque_min
      ORDER BY estoque ASC
    `, { emp });

    res.json({
      kpis: kpis.recordset[0], estoque: estoque.recordset[0],
      top_produtos: topProd.recordset, ultimas_vendas: ultimasVendas.recordset,
      alertas: alertas.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar dashboard.' });
  }
});

// ──────────────────────────────────────────────────────────────────
// REGISTRY DE RELATÓRIOS
// Cada relatório devolve o formato unificado:
//   { titulo, descricao, escopo, kpis[], colunas[], linhas[], grafico|null }
//   kpis:    { label, valor, tipo:'moeda'|'num'|'pct'|'texto', cor? }
//   colunas: { key, label, tipo:'moeda'|'num'|'pct'|'data'|'texto'|'badge' }
//   grafico: { tipo:'bar'|'barh'|'doughnut'|'line', labels[], valores[], label }
// ──────────────────────────────────────────────────────────────────
const RELATORIOS = {

  // ── VENDAS: resumo do período ──────────────────────────────────
  vendas: {
    titulo: 'Resumo de Vendas',
    descricao: 'Faturamento, ticket médio e extrato diário no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const resumo = (await query(`
        SELECT COUNT(*) AS qtd_vendas, COALESCE(SUM(total),0) AS faturamento,
               COALESCE(SUM(desconto),0) AS descontos, COALESCE(AVG(total),0) AS ticket_medio,
               (SELECT COALESCE(SUM(iv.quantidade),0) FROM ItensVenda iv
                JOIN Vendas v2 ON v2.id=iv.venda_id
                WHERE v2.empresa_id=@emp AND v2.criado_em BETWEEN @de AND @ate) AS itens
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0];

      const extrato = (await query(`
        SELECT CAST(criado_em AS DATE) AS data, COUNT(*) AS qtd_vendas,
               SUM(total) AS total, SUM(desconto) AS descontos
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
        GROUP BY CAST(criado_em AS DATE) ORDER BY data ASC
      `, { emp, de, ate })).recordset;

      return {
        kpis: [
          { label: 'Faturamento', valor: resumo.faturamento, tipo: 'moeda', cor: 'green' },
          { label: 'Qtd. Vendas', valor: resumo.qtd_vendas, tipo: 'num' },
          { label: 'Ticket Médio', valor: resumo.ticket_medio, tipo: 'moeda' },
          { label: 'Itens Vendidos', valor: resumo.itens, tipo: 'num' },
          { label: 'Descontos', valor: resumo.descontos, tipo: 'moeda', cor: 'red' },
        ],
        colunas: [
          { key: 'data', label: 'Data', tipo: 'data' },
          { key: 'qtd_vendas', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'descontos', label: 'Descontos', tipo: 'moeda' },
          { key: 'total', label: 'Total', tipo: 'moeda' },
        ],
        linhas: extrato,
        grafico: {
          tipo: 'line', label: 'Faturamento por dia',
          labels: extrato.map(e => e.data), valores: extrato.map(e => e.total),
        },
      };
    },
  },

  // ── VENDAS POR FORMA DE PAGAMENTO ──────────────────────────────
  'vendas-pagamento': {
    titulo: 'Vendas por Forma de Pagamento',
    descricao: 'Distribuição do faturamento entre as formas de pagamento.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(fp.nome,'—') AS pagamento, COUNT(*) AS qtd, SUM(v.total) AS total
        FROM Vendas v LEFT JOIN FormasPagamento fp ON fp.id=v.forma_pagamento_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY fp.nome ORDER BY total DESC
      `, { emp, de, ate })).recordset;
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        kpis: [
          { label: 'Total', valor: total, tipo: 'moeda', cor: 'green' },
          { label: 'Formas usadas', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'pagamento', label: 'Forma de Pagamento', tipo: 'texto' },
          { key: 'qtd', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'total', label: 'Total', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Total',
          labels: rows.map(r => r.pagamento), valores: rows.map(r => r.total),
        },
      };
    },
  },

  // ── VENDAS POR CATEGORIA ───────────────────────────────────────
  'vendas-categoria': {
    titulo: 'Vendas por Categoria',
    descricao: 'Faturamento e itens vendidos por categoria de produto.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(cat.nome,'Sem categoria') AS categoria,
               SUM(iv.quantidade) AS qtd, SUM(iv.subtotal) AS faturado
        FROM ItensVenda iv
        JOIN Produtos p ON p.id=iv.produto_id
        JOIN Vendas v ON v.id=iv.venda_id
        LEFT JOIN Categorias cat ON cat.id=p.categoria_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY cat.nome ORDER BY faturado DESC
      `, { emp, de, ate })).recordset;
      const fat = rows.reduce((s, r) => s + Number(r.faturado || 0), 0);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Categorias', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'categoria', label: 'Categoria', tipo: 'texto' },
          { key: 'qtd', label: 'Itens Vendidos', tipo: 'num' },
          { key: 'faturado', label: 'Faturado', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Faturamento por categoria',
          labels: rows.map(r => r.categoria), valores: rows.map(r => r.faturado),
        },
      };
    },
  },

  // ── VENDAS POR OPERADOR / VENDEDOR ─────────────────────────────
  'vendas-operador': {
    titulo: 'Vendas por Operador',
    descricao: 'Desempenho de cada vendedor/operador no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(u.nome,'—') AS operador, COUNT(v.id) AS qtd_vendas,
               SUM(v.total) AS total, AVG(v.total) AS ticket
        FROM Vendas v LEFT JOIN Usuarios u ON u.id=v.usuario_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY u.nome ORDER BY total DESC
      `, { emp, de, ate })).recordset;
      const fat = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Operadores', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'operador', label: 'Operador', tipo: 'texto' },
          { key: 'qtd_vendas', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'ticket', label: 'Ticket Médio', tipo: 'moeda' },
          { key: 'total', label: 'Total', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Total vendido',
          labels: rows.slice(0, 10).map(r => r.operador),
          valores: rows.slice(0, 10).map(r => r.total),
        },
      };
    },
  },

  // ── VENDAS POR HORÁRIO (pico) ──────────────────────────────────
  'vendas-horario': {
    titulo: 'Vendas por Horário',
    descricao: 'Distribuição das vendas por hora do dia — identifica os horários de pico.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT DATEPART(HOUR, criado_em) AS hora, COUNT(*) AS qtd_vendas, SUM(total) AS total
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
        GROUP BY DATEPART(HOUR, criado_em) ORDER BY hora ASC
      `, { emp, de, ate })).recordset;
      rows.forEach(r => { r.faixa = String(r.hora).padStart(2, '0') + 'h'; });
      const fat  = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      const pico = rows.reduce((a, r) => Number(r.total) > Number(a ? a.total : -1) ? r : a, null);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Horário de Pico', valor: pico ? pico.faixa : '—', tipo: 'texto' },
          { label: 'Vendas no Pico', valor: pico ? pico.qtd_vendas : 0, tipo: 'num' },
        ],
        colunas: [
          { key: 'faixa', label: 'Horário', tipo: 'texto' },
          { key: 'qtd_vendas', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'total', label: 'Faturamento', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'bar', label: 'Faturamento por hora',
          labels: rows.map(r => r.faixa), valores: rows.map(r => r.total),
        },
      };
    },
  },

  // ── VENDAS POR DIA DA SEMANA ───────────────────────────────────
  'vendas-dia-semana': {
    titulo: 'Vendas por Dia da Semana',
    descricao: 'Faturamento agrupado por dia da semana.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      // (DATEDIFF a partir de 1900-01-01, uma segunda-feira) % 7 → 0=Seg … 6=Dom (independe de idioma)
      const rows = (await query(`
        SELECT (DATEDIFF(DAY,'19000101', criado_em) % 7) AS dow,
               COUNT(*) AS qtd_vendas, SUM(total) AS total
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
        GROUP BY (DATEDIFF(DAY,'19000101', criado_em) % 7) ORDER BY dow ASC
      `, { emp, de, ate })).recordset;
      const NOMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
      rows.forEach(r => { r.dia = NOMES[r.dow]; });
      const fat    = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      const melhor = rows.reduce((a, r) => Number(r.total) > Number(a ? a.total : -1) ? r : a, null);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Melhor Dia', valor: melhor ? melhor.dia : '—', tipo: 'texto' },
        ],
        colunas: [
          { key: 'dia', label: 'Dia da Semana', tipo: 'texto' },
          { key: 'qtd_vendas', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'total', label: 'Faturamento', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'bar', label: 'Faturamento por dia',
          labels: rows.map(r => r.dia), valores: rows.map(r => r.total),
        },
      };
    },
  },

  // ── VENDAS DETALHADAS (listagem transacional) ──────────────────
  'vendas-detalhadas': {
    titulo: 'Vendas Detalhadas',
    descricao: 'Listagem de cada venda do período (cliente, operador, pagamento e total).',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 500 v.id, v.criado_em AS data, COALESCE(c.nome,'Consumidor') AS cliente,
               COALESCE(u.nome,'—') AS operador, COALESCE(fp.nome,'—') AS pagamento,
               (SELECT COUNT(*) FROM ItensVenda WHERE venda_id=v.id) AS itens,
               v.desconto, v.total
        FROM Vendas v
        LEFT JOIN Clientes c ON c.id=v.cliente_id
        LEFT JOIN Usuarios u ON u.id=v.usuario_id
        LEFT JOIN FormasPagamento fp ON fp.id=v.forma_pagamento_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        ORDER BY v.criado_em DESC
      `, { emp, de, ate })).recordset;
      const fat = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        kpis: [
          { label: 'Vendas', valor: rows.length, tipo: 'num' },
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Ticket Médio', valor: rows.length ? fat / rows.length : 0, tipo: 'moeda' },
        ],
        colunas: [
          { key: 'id', label: 'Nº', tipo: 'num' },
          { key: 'data', label: 'Data', tipo: 'data' },
          { key: 'cliente', label: 'Cliente', tipo: 'texto' },
          { key: 'operador', label: 'Operador', tipo: 'texto' },
          { key: 'pagamento', label: 'Pagamento', tipo: 'texto' },
          { key: 'itens', label: 'Itens', tipo: 'num' },
          { key: 'desconto', label: 'Desconto', tipo: 'moeda' },
          { key: 'total', label: 'Total', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── FATURAMENTO MENSAL (evolução) ──────────────────────────────
  'faturamento-mensal': {
    titulo: 'Faturamento Mensal',
    descricao: 'Evolução do faturamento mês a mês no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT FORMAT(criado_em,'yyyy-MM') AS mes, COUNT(*) AS qtd_vendas, SUM(total) AS total
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
        GROUP BY FORMAT(criado_em,'yyyy-MM') ORDER BY mes ASC
      `, { emp, de, ate })).recordset;
      rows.forEach(r => { const [y, m] = r.mes.split('-'); r.mes_label = `${m}/${y}`; });
      const fat = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      const melhor = rows.reduce((a, r) => Number(r.total) > Number(a ? a.total : -1) ? r : a, null);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Média Mensal', valor: rows.length ? fat / rows.length : 0, tipo: 'moeda' },
          { label: 'Melhor Mês', valor: melhor ? melhor.mes_label : '—', tipo: 'texto' },
        ],
        colunas: [
          { key: 'mes_label', label: 'Mês', tipo: 'texto' },
          { key: 'qtd_vendas', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'total', label: 'Faturamento', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'bar', label: 'Faturamento por mês',
          labels: rows.map(r => r.mes_label), valores: rows.map(r => r.total),
        },
      };
    },
  },

  // ── VENDAS POR ESTADO (UF) ─────────────────────────────────────
  'vendas-uf': {
    titulo: 'Vendas por Estado',
    descricao: 'Faturamento por UF do cliente (distribuição geográfica).',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(NULLIF(c.estado,''),'—') AS uf,
               COUNT(v.id) AS qtd_vendas, SUM(v.total) AS total
        FROM Vendas v LEFT JOIN Clientes c ON c.id=v.cliente_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY c.estado ORDER BY total DESC
      `, { emp, de, ate })).recordset;
      const fat = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Estados', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'uf', label: 'UF', tipo: 'texto' },
          { key: 'qtd_vendas', label: 'Qtd. Vendas', tipo: 'num' },
          { key: 'total', label: 'Faturamento', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Faturamento por UF',
          labels: rows.map(r => r.uf), valores: rows.map(r => r.total),
        },
      };
    },
  },

  // ── DESCONTOS CONCEDIDOS (por operador) ────────────────────────
  descontos: {
    titulo: 'Descontos Concedidos',
    descricao: 'Total de descontos dados nas vendas, por operador.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(u.nome,'—') AS operador,
               COUNT(CASE WHEN v.desconto > 0 THEN 1 END) AS vendas_com_desconto,
               SUM(v.desconto) AS total_desconto,
               SUM(v.total) AS faturamento
        FROM Vendas v LEFT JOIN Usuarios u ON u.id=v.usuario_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY u.nome ORDER BY total_desconto DESC
      `, { emp, de, ate })).recordset;
      rows.forEach(r => {
        const bruto = Number(r.faturamento) + Number(r.total_desconto);
        r.perc = bruto > 0 ? (Number(r.total_desconto) / bruto) * 100 : 0;
      });
      const totDesc = rows.reduce((s, r) => s + Number(r.total_desconto || 0), 0);
      const totVcd  = rows.reduce((s, r) => s + Number(r.vendas_com_desconto || 0), 0);
      return {
        kpis: [
          { label: 'Total de Descontos', valor: totDesc, tipo: 'moeda', cor: 'red' },
          { label: 'Vendas com Desconto', valor: totVcd, tipo: 'num' },
        ],
        colunas: [
          { key: 'operador', label: 'Operador', tipo: 'texto' },
          { key: 'vendas_com_desconto', label: 'Vendas c/ Desc.', tipo: 'num' },
          { key: 'total_desconto', label: 'Total Desconto', tipo: 'moeda' },
          { key: 'perc', label: '% s/ Bruto', tipo: 'pct' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Desconto concedido',
          labels: rows.slice(0, 10).map(r => r.operador),
          valores: rows.slice(0, 10).map(r => r.total_desconto),
        },
      };
    },
  },

  // ── PRODUTOS MAIS VENDIDOS ─────────────────────────────────────
  'produtos-mais-vendidos': {
    titulo: 'Produtos Mais Vendidos',
    descricao: 'Ranking de produtos por quantidade vendida no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT p.codigo, p.descricao,
               SUM(iv.quantidade) AS qtd, SUM(iv.subtotal) AS faturado
        FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
        JOIN Vendas v ON v.id=iv.venda_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY p.id, p.codigo, p.descricao
        ORDER BY qtd DESC
      `, { emp, de, ate })).recordset;
      const itens = rows.reduce((s, r) => s + Number(r.qtd || 0), 0);
      const fat   = rows.reduce((s, r) => s + Number(r.faturado || 0), 0);
      return {
        kpis: [
          { label: 'Itens Vendidos', valor: itens, tipo: 'num' },
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Produtos Distintos', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'qtd', label: 'Qtd. Vendida', tipo: 'num' },
          { key: 'faturado', label: 'Faturado', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Qtd. vendida',
          labels: rows.slice(0, 10).map(r => r.descricao),
          valores: rows.slice(0, 10).map(r => r.qtd),
        },
      };
    },
  },

  // ── PRODUTOS MENOS VENDIDOS (inclui sem vendas) ────────────────
  'produtos-menos-vendidos': {
    titulo: 'Produtos Menos Vendidos',
    descricao: 'Produtos com menor giro no período (inclui os sem vendas).',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 100 p.codigo, p.descricao, p.estoque,
               COALESCE(vd.qtd,0) AS qtd, COALESCE(vd.faturado,0) AS faturado
        FROM Produtos p
        OUTER APPLY (
          SELECT SUM(iv.quantidade) AS qtd, SUM(iv.subtotal) AS faturado
          FROM ItensVenda iv JOIN Vendas v ON v.id=iv.venda_id
          WHERE iv.produto_id=p.id AND v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        ) vd
        WHERE p.empresa_id=@emp AND p.status='ativo'
        ORDER BY qtd ASC, faturado ASC, p.descricao ASC
      `, { emp, de, ate })).recordset;
      const semVenda = rows.filter(r => Number(r.qtd) === 0).length;
      return {
        kpis: [
          { label: 'Produtos Ativos', valor: rows.length, tipo: 'num' },
          { label: 'Sem Vendas no Período', valor: semVenda, tipo: 'num', cor: 'red' },
        ],
        colunas: [
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'estoque', label: 'Estoque', tipo: 'num' },
          { key: 'qtd', label: 'Qtd. Vendida', tipo: 'num' },
          { key: 'faturado', label: 'Faturado', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── CURVA ABC DE PRODUTOS (Pareto) ─────────────────────────────
  'curva-abc': {
    titulo: 'Curva ABC de Produtos',
    descricao: 'Classificação A/B/C por faturamento acumulado (regra de Pareto 80/15/5).',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        WITH base AS (
          SELECT p.codigo, p.descricao,
                 SUM(iv.quantidade) AS qtd, SUM(iv.subtotal) AS faturado
          FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
          JOIN Vendas v ON v.id=iv.venda_id
          WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
          GROUP BY p.id, p.codigo, p.descricao
        ),
        tot AS (SELECT SUM(faturado) AS t FROM base)
        SELECT b.codigo, b.descricao, b.qtd, b.faturado,
               100.0 * b.faturado / NULLIF(tot.t,0) AS perc,
               100.0 * SUM(b.faturado) OVER (ORDER BY b.faturado DESC) / NULLIF(tot.t,0) AS acum
        FROM base b CROSS JOIN tot
        ORDER BY b.faturado DESC
      `, { emp, de, ate })).recordset;
      rows.forEach(r => { r.classe = Number(r.acum) <= 80 ? 'A' : (Number(r.acum) <= 95 ? 'B' : 'C'); });
      const fat = rows.reduce((s, r) => s + Number(r.faturado || 0), 0);
      const cnt = c => rows.filter(r => r.classe === c).length;
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda', cor: 'green' },
          { label: 'Classe A', valor: cnt('A'), tipo: 'num' },
          { label: 'Classe B', valor: cnt('B'), tipo: 'num' },
          { label: 'Classe C', valor: cnt('C'), tipo: 'num' },
        ],
        colunas: [
          { key: 'classe', label: 'Classe', tipo: 'badge' },
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'qtd', label: 'Qtd.', tipo: 'num' },
          { key: 'faturado', label: 'Faturado', tipo: 'moeda' },
          { key: 'perc', label: '% Fat.', tipo: 'pct' },
          { key: 'acum', label: '% Acum.', tipo: 'pct' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Faturado',
          labels: rows.slice(0, 10).map(r => r.descricao),
          valores: rows.slice(0, 10).map(r => r.faturado),
        },
      };
    },
  },

  // ── LUCRATIVIDADE POR PRODUTO ──────────────────────────────────
  lucratividade: {
    titulo: 'Lucratividade por Produto',
    descricao: 'Margem de lucro por produto (preço de venda x custo atual).',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT p.codigo, p.descricao,
               SUM(iv.quantidade) AS qtd,
               SUM(iv.subtotal) AS faturado,
               SUM(iv.quantidade * p.preco_custo) AS custo,
               SUM(iv.subtotal) - SUM(iv.quantidade * p.preco_custo) AS lucro
        FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
        JOIN Vendas v ON v.id=iv.venda_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY p.id, p.codigo, p.descricao
        ORDER BY lucro DESC
      `, { emp, de, ate })).recordset;
      rows.forEach(r => { r.margem = Number(r.faturado) > 0 ? (Number(r.lucro) / Number(r.faturado)) * 100 : 0; });
      const fat   = rows.reduce((s, r) => s + Number(r.faturado || 0), 0);
      const custo = rows.reduce((s, r) => s + Number(r.custo || 0), 0);
      const lucro = fat - custo;
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda' },
          { label: 'Custo', valor: custo, tipo: 'moeda', cor: 'red' },
          { label: 'Lucro Bruto', valor: lucro, tipo: 'moeda', cor: 'green' },
          { label: 'Margem', valor: fat > 0 ? (lucro / fat) * 100 : 0, tipo: 'pct' },
        ],
        colunas: [
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'qtd', label: 'Qtd.', tipo: 'num' },
          { key: 'faturado', label: 'Faturado', tipo: 'moeda' },
          { key: 'custo', label: 'Custo', tipo: 'moeda' },
          { key: 'lucro', label: 'Lucro', tipo: 'moeda' },
          { key: 'margem', label: 'Margem', tipo: 'pct' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Lucro',
          labels: rows.slice(0, 10).map(r => r.descricao),
          valores: rows.slice(0, 10).map(r => r.lucro),
        },
      };
    },
  },

  // ── MARGEM POR CATEGORIA ───────────────────────────────────────
  'margem-categoria': {
    titulo: 'Margem por Categoria',
    descricao: 'Faturamento, custo, lucro e margem agrupados por categoria.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(cat.nome,'Sem categoria') AS categoria,
               SUM(iv.subtotal) AS faturado,
               SUM(iv.quantidade * p.preco_custo) AS custo,
               SUM(iv.subtotal) - SUM(iv.quantidade * p.preco_custo) AS lucro
        FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
        JOIN Vendas v ON v.id=iv.venda_id
        LEFT JOIN Categorias cat ON cat.id=p.categoria_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY cat.nome ORDER BY lucro DESC
      `, { emp, de, ate })).recordset;
      rows.forEach(r => { r.margem = Number(r.faturado) > 0 ? (Number(r.lucro) / Number(r.faturado)) * 100 : 0; });
      const fat   = rows.reduce((s, r) => s + Number(r.faturado || 0), 0);
      const lucro = rows.reduce((s, r) => s + Number(r.lucro || 0), 0);
      return {
        kpis: [
          { label: 'Faturamento', valor: fat, tipo: 'moeda' },
          { label: 'Lucro Bruto', valor: lucro, tipo: 'moeda', cor: 'green' },
          { label: 'Margem', valor: fat > 0 ? (lucro / fat) * 100 : 0, tipo: 'pct' },
        ],
        colunas: [
          { key: 'categoria', label: 'Categoria', tipo: 'texto' },
          { key: 'faturado', label: 'Faturado', tipo: 'moeda' },
          { key: 'custo', label: 'Custo', tipo: 'moeda' },
          { key: 'lucro', label: 'Lucro', tipo: 'moeda' },
          { key: 'margem', label: 'Margem', tipo: 'pct' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Lucro por categoria',
          labels: rows.map(r => r.categoria), valores: rows.map(r => r.lucro),
        },
      };
    },
  },

  // ── POSIÇÃO DE ESTOQUE ─────────────────────────────────────────
  estoque: {
    titulo: 'Posição de Estoque',
    descricao: 'Saldo atual e valor do estoque por produto.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT p.codigo, p.descricao, p.estoque, p.estoque_min,
               p.preco_custo, p.preco_venda,
               (p.estoque * p.preco_custo) AS valor_custo,
               (p.estoque * p.preco_venda) AS valor_venda
        FROM Produtos p WHERE p.empresa_id=@emp AND p.status='ativo'
        ORDER BY p.descricao ASC
      `, { emp })).recordset;
      const itens = rows.reduce((s, r) => s + Number(r.estoque || 0), 0);
      const vCusto = rows.reduce((s, r) => s + Number(r.valor_custo || 0), 0);
      const vVenda = rows.reduce((s, r) => s + Number(r.valor_venda || 0), 0);
      return {
        kpis: [
          { label: 'Produtos', valor: rows.length, tipo: 'num' },
          { label: 'Itens em Estoque', valor: itens, tipo: 'num' },
          { label: 'Valor (Custo)', valor: vCusto, tipo: 'moeda' },
          { label: 'Valor (Venda)', valor: vVenda, tipo: 'moeda', cor: 'green' },
        ],
        colunas: [
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'estoque', label: 'Estoque', tipo: 'num' },
          { key: 'preco_custo', label: 'Custo Un.', tipo: 'moeda' },
          { key: 'preco_venda', label: 'Venda Un.', tipo: 'moeda' },
          { key: 'valor_custo', label: 'Valor Custo', tipo: 'moeda' },
          { key: 'valor_venda', label: 'Valor Venda', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── ESTOQUE BAIXO / REPOSIÇÃO ──────────────────────────────────
  'estoque-baixo': {
    titulo: 'Estoque Baixo / Reposição',
    descricao: 'Produtos zerados ou abaixo do estoque mínimo.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT p.codigo, p.descricao, p.estoque, p.estoque_min,
               (p.estoque_min - p.estoque) AS repor,
               CASE WHEN p.estoque=0 THEN 'EM FALTA' ELSE 'CRÍTICO' END AS situacao
        FROM Produtos p
        WHERE p.empresa_id=@emp AND p.status='ativo' AND p.estoque<=p.estoque_min
        ORDER BY p.estoque ASC
      `, { emp })).recordset;
      const falta = rows.filter(r => Number(r.estoque) === 0).length;
      return {
        kpis: [
          { label: 'Para Repor', valor: rows.length, tipo: 'num', cor: 'red' },
          { label: 'Em Falta (zerados)', valor: falta, tipo: 'num', cor: 'red' },
          { label: 'Críticos', valor: rows.length - falta, tipo: 'num' },
        ],
        colunas: [
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'estoque', label: 'Estoque', tipo: 'num' },
          { key: 'estoque_min', label: 'Mínimo', tipo: 'num' },
          { key: 'repor', label: 'Repor', tipo: 'num' },
          { key: 'situacao', label: 'Situação', tipo: 'badge' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── ESTOQUE PARADO (capital sem giro) ──────────────────────────
  'estoque-parado': {
    titulo: 'Estoque Parado',
    descricao: 'Produtos com saldo em estoque mas sem nenhuma venda no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT p.codigo, p.descricao, p.estoque, p.preco_custo,
               (p.estoque * p.preco_custo) AS valor_parado
        FROM Produtos p
        WHERE p.empresa_id=@emp AND p.status='ativo' AND p.estoque > 0
          AND NOT EXISTS (
            SELECT 1 FROM ItensVenda iv JOIN Vendas v ON v.id=iv.venda_id
            WHERE iv.produto_id=p.id AND v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
          )
        ORDER BY valor_parado DESC
      `, { emp, de, ate })).recordset;
      const itens = rows.reduce((s, r) => s + Number(r.estoque || 0), 0);
      const valor = rows.reduce((s, r) => s + Number(r.valor_parado || 0), 0);
      return {
        kpis: [
          { label: 'Produtos Parados', valor: rows.length, tipo: 'num', cor: 'red' },
          { label: 'Itens Parados', valor: itens, tipo: 'num' },
          { label: 'Capital Parado', valor: valor, tipo: 'moeda', cor: 'red' },
        ],
        colunas: [
          { key: 'codigo', label: 'Código', tipo: 'texto' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'estoque', label: 'Estoque', tipo: 'num' },
          { key: 'preco_custo', label: 'Custo Un.', tipo: 'moeda' },
          { key: 'valor_parado', label: 'Capital Parado', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── ESTOQUE POR CATEGORIA ──────────────────────────────────────
  'estoque-categoria': {
    titulo: 'Estoque por Categoria',
    descricao: 'Quantidade e valor do estoque agrupados por categoria.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT COALESCE(cat.nome,'Sem categoria') AS categoria,
               COUNT(*) AS produtos, SUM(p.estoque) AS itens,
               SUM(p.estoque * p.preco_custo) AS valor_custo,
               SUM(p.estoque * p.preco_venda) AS valor_venda
        FROM Produtos p LEFT JOIN Categorias cat ON cat.id=p.categoria_id
        WHERE p.empresa_id=@emp AND p.status='ativo'
        GROUP BY cat.nome ORDER BY valor_custo DESC
      `, { emp })).recordset;
      const vCusto = rows.reduce((s, r) => s + Number(r.valor_custo || 0), 0);
      const vVenda = rows.reduce((s, r) => s + Number(r.valor_venda || 0), 0);
      return {
        kpis: [
          { label: 'Categorias', valor: rows.length, tipo: 'num' },
          { label: 'Valor (Custo)', valor: vCusto, tipo: 'moeda' },
          { label: 'Valor (Venda)', valor: vVenda, tipo: 'moeda', cor: 'green' },
        ],
        colunas: [
          { key: 'categoria', label: 'Categoria', tipo: 'texto' },
          { key: 'produtos', label: 'Produtos', tipo: 'num' },
          { key: 'itens', label: 'Itens', tipo: 'num' },
          { key: 'valor_custo', label: 'Valor Custo', tipo: 'moeda' },
          { key: 'valor_venda', label: 'Valor Venda', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Valor de estoque (custo)',
          labels: rows.map(r => r.categoria), valores: rows.map(r => r.valor_custo),
        },
      };
    },
  },

  // ── CONTAS A RECEBER (em aberto) ───────────────────────────────
  'contas-receber': {
    titulo: 'Contas a Receber',
    descricao: 'Títulos em aberto (pendentes/parciais) com posição de vencimento.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT cr.id, COALESCE(c.nome,'—') AS cliente, cr.numero_documento,
               cr.valor, COALESCE(cr.valor_recebido,0) AS recebido,
               (cr.valor - COALESCE(cr.valor_recebido,0)) AS saldo,
               cr.data_vencimento, cr.status,
               DATEDIFF(DAY, cr.data_vencimento, GETDATE()) AS dias_atraso
        FROM ContasReceber cr LEFT JOIN Clientes c ON c.id=cr.cliente_id
        WHERE cr.empresa_id=@emp AND cr.status IN ('pendente','parcial')
        ORDER BY cr.data_vencimento ASC
      `, { emp })).recordset;
      const saldoTotal = rows.reduce((s, r) => s + Number(r.saldo || 0), 0);
      const vencidas = rows.filter(r => Number(r.dias_atraso) > 0);
      const vencido  = vencidas.reduce((s, r) => s + Number(r.saldo || 0), 0);
      rows.forEach(r => { r.situacao = Number(r.dias_atraso) > 0 ? `${r.dias_atraso}d atraso` : 'a vencer'; });
      return {
        kpis: [
          { label: 'Total a Receber', valor: saldoTotal, tipo: 'moeda', cor: 'green' },
          { label: 'Títulos em Aberto', valor: rows.length, tipo: 'num' },
          { label: 'Vencido', valor: vencido, tipo: 'moeda', cor: 'red' },
          { label: 'Títulos Vencidos', valor: vencidas.length, tipo: 'num', cor: 'red' },
        ],
        colunas: [
          { key: 'cliente', label: 'Cliente', tipo: 'texto' },
          { key: 'numero_documento', label: 'Documento', tipo: 'texto' },
          { key: 'data_vencimento', label: 'Vencimento', tipo: 'data' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
          { key: 'recebido', label: 'Recebido', tipo: 'moeda' },
          { key: 'saldo', label: 'Saldo', tipo: 'moeda' },
          { key: 'situacao', label: 'Situação', tipo: 'badge' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── INADIMPLÊNCIA / AGING (contas a receber por faixa) ─────────
  'aging-receber': {
    titulo: 'Inadimplência (Aging)',
    descricao: 'Saldo a receber agrupado por faixa de dias em atraso.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT faixa, COUNT(*) AS titulos, SUM(saldo) AS saldo FROM (
          SELECT (cr.valor - COALESCE(cr.valor_recebido,0)) AS saldo,
            CASE
              WHEN cr.data_vencimento IS NULL OR DATEDIFF(DAY, cr.data_vencimento, GETDATE()) <= 0 THEN 'A vencer'
              WHEN DATEDIFF(DAY, cr.data_vencimento, GETDATE()) <= 30 THEN '1 a 30 dias'
              WHEN DATEDIFF(DAY, cr.data_vencimento, GETDATE()) <= 60 THEN '31 a 60 dias'
              WHEN DATEDIFF(DAY, cr.data_vencimento, GETDATE()) <= 90 THEN '61 a 90 dias'
              ELSE 'Mais de 90 dias'
            END AS faixa
          FROM ContasReceber cr
          WHERE cr.empresa_id=@emp AND cr.status IN ('pendente','parcial')
        ) t GROUP BY faixa
      `, { emp })).recordset;
      const ORD = ['A vencer', '1 a 30 dias', '31 a 60 dias', '61 a 90 dias', 'Mais de 90 dias'];
      rows.sort((a, b) => ORD.indexOf(a.faixa) - ORD.indexOf(b.faixa));
      const total   = rows.reduce((s, r) => s + Number(r.saldo || 0), 0);
      const vencido = rows.filter(r => r.faixa !== 'A vencer').reduce((s, r) => s + Number(r.saldo || 0), 0);
      return {
        kpis: [
          { label: 'Total a Receber', valor: total, tipo: 'moeda' },
          { label: 'Vencido', valor: vencido, tipo: 'moeda', cor: 'red' },
          { label: 'Inadimplência', valor: total > 0 ? (vencido / total) * 100 : 0, tipo: 'pct', cor: 'red' },
        ],
        colunas: [
          { key: 'faixa', label: 'Faixa de Atraso', tipo: 'texto' },
          { key: 'titulos', label: 'Títulos', tipo: 'num' },
          { key: 'saldo', label: 'Saldo', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Saldo por faixa',
          labels: rows.map(r => r.faixa), valores: rows.map(r => r.saldo),
        },
      };
    },
  },

  // ── CONTAS A PAGAR (em aberto) ─────────────────────────────────
  'contas-pagar': {
    titulo: 'Contas a Pagar',
    descricao: 'Títulos em aberto (pendentes/parciais) com posição de vencimento.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT cp.id, cp.fornecedor, cp.categoria, cp.numero_documento,
               cp.valor, COALESCE(cp.valor_pago,0) AS pago,
               (cp.valor - COALESCE(cp.valor_pago,0)) AS saldo,
               cp.data_vencimento, cp.status,
               DATEDIFF(DAY, cp.data_vencimento, GETDATE()) AS dias_atraso
        FROM ContasPagar cp
        WHERE cp.empresa_id=@emp AND cp.status IN ('pendente','parcial')
        ORDER BY cp.data_vencimento ASC
      `, { emp })).recordset;
      const saldoTotal = rows.reduce((s, r) => s + Number(r.saldo || 0), 0);
      const vencidas = rows.filter(r => Number(r.dias_atraso) > 0);
      const vencido  = vencidas.reduce((s, r) => s + Number(r.saldo || 0), 0);
      rows.forEach(r => { r.situacao = Number(r.dias_atraso) > 0 ? `${r.dias_atraso}d atraso` : 'a vencer'; });
      return {
        kpis: [
          { label: 'Total a Pagar', valor: saldoTotal, tipo: 'moeda', cor: 'red' },
          { label: 'Títulos em Aberto', valor: rows.length, tipo: 'num' },
          { label: 'Vencido', valor: vencido, tipo: 'moeda', cor: 'red' },
          { label: 'Títulos Vencidos', valor: vencidas.length, tipo: 'num', cor: 'red' },
        ],
        colunas: [
          { key: 'fornecedor', label: 'Fornecedor', tipo: 'texto' },
          { key: 'categoria', label: 'Categoria', tipo: 'texto' },
          { key: 'data_vencimento', label: 'Vencimento', tipo: 'data' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
          { key: 'pago', label: 'Pago', tipo: 'moeda' },
          { key: 'saldo', label: 'Saldo', tipo: 'moeda' },
          { key: 'situacao', label: 'Situação', tipo: 'badge' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── AGING DE CONTAS A PAGAR (por faixa de vencimento) ──────────
  'aging-pagar': {
    titulo: 'Aging de Contas a Pagar',
    descricao: 'Saldo a pagar agrupado por faixa de dias em atraso.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT faixa, COUNT(*) AS titulos, SUM(saldo) AS saldo FROM (
          SELECT (cp.valor - COALESCE(cp.valor_pago,0)) AS saldo,
            CASE
              WHEN cp.data_vencimento IS NULL OR DATEDIFF(DAY, cp.data_vencimento, GETDATE()) <= 0 THEN 'A vencer'
              WHEN DATEDIFF(DAY, cp.data_vencimento, GETDATE()) <= 30 THEN '1 a 30 dias'
              WHEN DATEDIFF(DAY, cp.data_vencimento, GETDATE()) <= 60 THEN '31 a 60 dias'
              WHEN DATEDIFF(DAY, cp.data_vencimento, GETDATE()) <= 90 THEN '61 a 90 dias'
              ELSE 'Mais de 90 dias'
            END AS faixa
          FROM ContasPagar cp
          WHERE cp.empresa_id=@emp AND cp.status IN ('pendente','parcial')
        ) t GROUP BY faixa
      `, { emp })).recordset;
      const ORD = ['A vencer', '1 a 30 dias', '31 a 60 dias', '61 a 90 dias', 'Mais de 90 dias'];
      rows.sort((a, b) => ORD.indexOf(a.faixa) - ORD.indexOf(b.faixa));
      const total   = rows.reduce((s, r) => s + Number(r.saldo || 0), 0);
      const vencido = rows.filter(r => r.faixa !== 'A vencer').reduce((s, r) => s + Number(r.saldo || 0), 0);
      return {
        kpis: [
          { label: 'Total a Pagar', valor: total, tipo: 'moeda', cor: 'red' },
          { label: 'Vencido', valor: vencido, tipo: 'moeda', cor: 'red' },
          { label: '% Vencido', valor: total > 0 ? (vencido / total) * 100 : 0, tipo: 'pct' },
        ],
        colunas: [
          { key: 'faixa', label: 'Faixa de Atraso', tipo: 'texto' },
          { key: 'titulos', label: 'Títulos', tipo: 'num' },
          { key: 'saldo', label: 'Saldo', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Saldo por faixa',
          labels: rows.map(r => r.faixa), valores: rows.map(r => r.saldo),
        },
      };
    },
  },

  // ── RECEBIMENTOS REALIZADOS (baixas de contas a receber) ───────
  recebimentos: {
    titulo: 'Recebimentos Realizados',
    descricao: 'Baixas de contas a receber efetuadas no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 300 rc.data_recebimento AS data, COALESCE(c.nome,'—') AS cliente,
               rc.valor_recebido AS valor, rc.forma_pagamento, COALESCE(u.nome,'—') AS usuario
        FROM RecebimentosContas rc
        LEFT JOIN ContasReceber cr ON cr.id=rc.conta_id
        LEFT JOIN Clientes c ON c.id=cr.cliente_id
        LEFT JOIN Usuarios u ON u.id=rc.usuario_id
        WHERE rc.empresa_id=@emp AND rc.estornado=0 AND rc.data_recebimento BETWEEN @de AND @ate
        ORDER BY rc.data_recebimento DESC
      `, { emp, de, ate })).recordset;
      const total = rows.reduce((s, r) => s + Number(r.valor || 0), 0);
      const porForma = {};
      rows.forEach(r => { const f = r.forma_pagamento || '—'; porForma[f] = (porForma[f] || 0) + Number(r.valor || 0); });
      const labels = Object.keys(porForma);
      return {
        kpis: [
          { label: 'Total Recebido', valor: total, tipo: 'moeda', cor: 'green' },
          { label: 'Baixas', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'data', label: 'Data', tipo: 'data' },
          { key: 'cliente', label: 'Cliente', tipo: 'texto' },
          { key: 'forma_pagamento', label: 'Forma', tipo: 'texto' },
          { key: 'usuario', label: 'Operador', tipo: 'texto' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: labels.length ? {
          tipo: 'doughnut', label: 'Por forma de pagamento',
          labels, valores: labels.map(l => porForma[l]),
        } : null,
      };
    },
  },

  // ── PAGAMENTOS REALIZADOS (baixas de contas a pagar) ───────────
  pagamentos: {
    titulo: 'Pagamentos Realizados',
    descricao: 'Baixas de contas a pagar efetuadas no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 300 pp.data_pagamento AS data, COALESCE(cp.fornecedor,'—') AS fornecedor,
               pp.valor_pago AS valor, pp.forma_pagamento, COALESCE(u.nome,'—') AS usuario
        FROM PagamentosContasPagar pp
        LEFT JOIN ContasPagar cp ON cp.id=pp.conta_id
        LEFT JOIN Usuarios u ON u.id=pp.usuario_id
        WHERE pp.empresa_id=@emp AND pp.estornado=0 AND pp.data_pagamento BETWEEN @de AND @ate
        ORDER BY pp.data_pagamento DESC
      `, { emp, de, ate })).recordset;
      const total = rows.reduce((s, r) => s + Number(r.valor || 0), 0);
      const porForma = {};
      rows.forEach(r => { const f = r.forma_pagamento || '—'; porForma[f] = (porForma[f] || 0) + Number(r.valor || 0); });
      const labels = Object.keys(porForma);
      return {
        kpis: [
          { label: 'Total Pago', valor: total, tipo: 'moeda', cor: 'red' },
          { label: 'Baixas', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'data', label: 'Data', tipo: 'data' },
          { key: 'fornecedor', label: 'Fornecedor', tipo: 'texto' },
          { key: 'forma_pagamento', label: 'Forma', tipo: 'texto' },
          { key: 'usuario', label: 'Operador', tipo: 'texto' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: labels.length ? {
          tipo: 'doughnut', label: 'Por forma de pagamento',
          labels, valores: labels.map(l => porForma[l]),
        } : null,
      };
    },
  },

  // ── DESPESAS POR CATEGORIA ─────────────────────────────────────
  'despesas-categoria': {
    titulo: 'Despesas por Categoria',
    descricao: 'Contas a pagar lançadas no período, agrupadas por categoria.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT COALESCE(NULLIF(categoria,''),'Sem categoria') AS categoria,
               COUNT(*) AS qtd, SUM(valor) AS total
        FROM ContasPagar
        WHERE empresa_id=@emp AND status<>'cancelado' AND criado_em BETWEEN @de AND @ate
        GROUP BY categoria ORDER BY total DESC
      `, { emp, de, ate })).recordset;
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        kpis: [
          { label: 'Total de Despesas', valor: total, tipo: 'moeda', cor: 'red' },
          { label: 'Categorias', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'categoria', label: 'Categoria', tipo: 'texto' },
          { key: 'qtd', label: 'Lançamentos', tipo: 'num' },
          { key: 'total', label: 'Total', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Despesas por categoria',
          labels: rows.map(r => r.categoria), valores: rows.map(r => r.total),
        },
      };
    },
  },

  // ── CLIENTES QUE MAIS COMPRARAM ────────────────────────────────
  clientes: {
    titulo: 'Clientes que Mais Compraram',
    descricao: 'Ranking de clientes por valor de compras no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 100 c.nome AS cliente, COUNT(v.id) AS compras,
               SUM(v.total) AS total, AVG(v.total) AS ticket, MAX(v.criado_em) AS ultima
        FROM Vendas v JOIN Clientes c ON c.id=v.cliente_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY c.id, c.nome ORDER BY total DESC
      `, { emp, de, ate })).recordset;
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        kpis: [
          { label: 'Clientes', valor: rows.length, tipo: 'num' },
          { label: 'Faturamento (identificado)', valor: total, tipo: 'moeda', cor: 'green' },
        ],
        colunas: [
          { key: 'cliente', label: 'Cliente', tipo: 'texto' },
          { key: 'compras', label: 'Compras', tipo: 'num' },
          { key: 'ticket', label: 'Ticket Médio', tipo: 'moeda' },
          { key: 'total', label: 'Total', tipo: 'moeda' },
          { key: 'ultima', label: 'Última Compra', tipo: 'data' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'barh', label: 'Total comprado',
          labels: rows.slice(0, 10).map(r => r.cliente),
          valores: rows.slice(0, 10).map(r => r.total),
        },
      };
    },
  },

  // ── NOVOS CLIENTES (cadastrados no período) ────────────────────
  'novos-clientes': {
    titulo: 'Novos Clientes',
    descricao: 'Clientes cadastrados no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT c.nome AS cliente, c.documento, c.telefone,
               c.cidade, c.estado, c.criado_em AS data
        FROM Clientes c
        WHERE c.empresa_id=@emp AND c.criado_em BETWEEN @de AND @ate
        ORDER BY c.criado_em DESC
      `, { emp, de, ate })).recordset;
      return {
        kpis: [
          { label: 'Novos Clientes', valor: rows.length, tipo: 'num', cor: 'green' },
        ],
        colunas: [
          { key: 'data', label: 'Cadastro', tipo: 'data' },
          { key: 'cliente', label: 'Cliente', tipo: 'texto' },
          { key: 'documento', label: 'CPF/CNPJ', tipo: 'texto' },
          { key: 'telefone', label: 'Telefone', tipo: 'texto' },
          { key: 'cidade', label: 'Cidade', tipo: 'texto' },
          { key: 'estado', label: 'UF', tipo: 'texto' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── CLIENTES POR CIDADE ────────────────────────────────────────
  'clientes-cidade': {
    titulo: 'Clientes por Cidade',
    descricao: 'Distribuição geográfica da base de clientes ativos.',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT COALESCE(NULLIF(cidade,''),'—') AS cidade,
               COALESCE(NULLIF(estado,''),'') AS uf, COUNT(*) AS clientes
        FROM Clientes WHERE empresa_id=@emp AND ativo=1
        GROUP BY cidade, estado ORDER BY clientes DESC
      `, { emp })).recordset;
      const total = rows.reduce((s, r) => s + Number(r.clientes || 0), 0);
      return {
        kpis: [
          { label: 'Clientes Ativos', valor: total, tipo: 'num' },
          { label: 'Cidades', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'cidade', label: 'Cidade', tipo: 'texto' },
          { key: 'uf', label: 'UF', tipo: 'texto' },
          { key: 'clientes', label: 'Clientes', tipo: 'num' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'doughnut', label: 'Clientes por cidade',
          labels: rows.slice(0, 12).map(r => r.cidade),
          valores: rows.slice(0, 12).map(r => r.clientes),
        },
      };
    },
  },

  // ── CLIENTES INATIVOS (reativação) ─────────────────────────────
  'clientes-inativos': {
    titulo: 'Clientes Inativos',
    descricao: 'Clientes ativos sem compras há mais de 60 dias (ou que nunca compraram).',
    usaPeriodo: false,
    async run(emp) {
      const rows = (await query(`
        SELECT TOP 200 c.nome AS cliente, c.telefone, ult.ultima, ult.compras,
               DATEDIFF(DAY, ult.ultima, GETDATE()) AS dias_sem_comprar
        FROM Clientes c
        CROSS APPLY (
          SELECT MAX(v.criado_em) AS ultima, COUNT(v.id) AS compras
          FROM Vendas v WHERE v.cliente_id=c.id AND v.empresa_id=@emp
        ) ult
        WHERE c.empresa_id=@emp AND c.ativo=1
          AND (ult.ultima IS NULL OR ult.ultima < DATEADD(DAY,-60,GETDATE()))
        ORDER BY ult.ultima ASC
      `, { emp })).recordset;
      const nunca = rows.filter(r => !r.ultima).length;
      return {
        kpis: [
          { label: 'Clientes Inativos', valor: rows.length, tipo: 'num', cor: 'red' },
          { label: 'Nunca Compraram', valor: nunca, tipo: 'num' },
        ],
        colunas: [
          { key: 'cliente', label: 'Cliente', tipo: 'texto' },
          { key: 'telefone', label: 'Telefone', tipo: 'texto' },
          { key: 'compras', label: 'Compras', tipo: 'num' },
          { key: 'ultima', label: 'Última Compra', tipo: 'data' },
          { key: 'dias_sem_comprar', label: 'Dias sem Comprar', tipo: 'num' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── MOVIMENTAÇÕES DE ESTOQUE ───────────────────────────────────
  movimentacoes: {
    titulo: 'Movimentações de Estoque',
    descricao: 'Entradas e saídas de estoque no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 300 m.criado_em, p.descricao, m.tipo, m.quantidade,
               m.saldo_atual, m.origem, COALESCE(u.nome,'—') AS usuario
        FROM MovimentacoesEstoque m JOIN Produtos p ON p.id=m.produto_id
        LEFT JOIN Usuarios u ON u.id=m.usuario_id
        WHERE m.empresa_id=@emp AND m.criado_em BETWEEN @de AND @ate
        ORDER BY m.criado_em DESC
      `, { emp, de, ate })).recordset;
      const entradas = rows.filter(r => r.tipo === 'entrada').reduce((s, r) => s + Number(r.quantidade || 0), 0);
      const saidas   = rows.filter(r => r.tipo === 'saida').reduce((s, r) => s + Number(r.quantidade || 0), 0);
      return {
        kpis: [
          { label: 'Movimentações', valor: rows.length, tipo: 'num' },
          { label: 'Entradas', valor: entradas, tipo: 'num', cor: 'green' },
          { label: 'Saídas', valor: saidas, tipo: 'num', cor: 'red' },
        ],
        colunas: [
          { key: 'criado_em', label: 'Data', tipo: 'data' },
          { key: 'descricao', label: 'Produto', tipo: 'texto' },
          { key: 'tipo', label: 'Tipo', tipo: 'badge' },
          { key: 'quantidade', label: 'Qtd.', tipo: 'num' },
          { key: 'saldo_atual', label: 'Saldo', tipo: 'num' },
          { key: 'origem', label: 'Origem', tipo: 'texto' },
          { key: 'usuario', label: 'Usuário', tipo: 'texto' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── FECHAMENTOS DE CAIXA ───────────────────────────────────────
  caixa: {
    titulo: 'Fechamentos de Caixa',
    descricao: 'Turnos de caixa abertos no período, com sobras e quebras.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT cx.id, cx.data_abertura, cx.data_fechamento, COALESCE(u.nome,'—') AS operador,
               cx.valor_esperado, cx.valor_informado, cx.diferenca, cx.status
        FROM Caixa cx LEFT JOIN Usuarios u ON u.id=cx.usuario_id
        WHERE cx.empresa_id=@emp AND cx.data_abertura BETWEEN @de AND @ate
        ORDER BY cx.data_abertura DESC
      `, { emp, de, ate })).recordset;
      const fechados = rows.filter(r => r.status === 'fechado');
      const sobras  = fechados.filter(r => Number(r.diferenca) > 0).reduce((s, r) => s + Number(r.diferenca), 0);
      const quebras = fechados.filter(r => Number(r.diferenca) < 0).reduce((s, r) => s + Number(r.diferenca), 0);
      return {
        kpis: [
          { label: 'Turnos', valor: rows.length, tipo: 'num' },
          { label: 'Abertos', valor: rows.length - fechados.length, tipo: 'num' },
          { label: 'Sobras', valor: sobras, tipo: 'moeda', cor: 'green' },
          { label: 'Quebras', valor: quebras, tipo: 'moeda', cor: 'red' },
        ],
        colunas: [
          { key: 'data_abertura', label: 'Abertura', tipo: 'data' },
          { key: 'operador', label: 'Operador', tipo: 'texto' },
          { key: 'valor_esperado', label: 'Esperado', tipo: 'moeda' },
          { key: 'valor_informado', label: 'Informado', tipo: 'moeda' },
          { key: 'diferenca', label: 'Diferença', tipo: 'moeda' },
          { key: 'status', label: 'Status', tipo: 'badge' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── SANGRIAS E SUPRIMENTOS DE CAIXA ────────────────────────────
  'movimentacoes-caixa': {
    titulo: 'Sangrias e Suprimentos',
    descricao: 'Retiradas (sangrias) e entradas de troco (suprimentos) de caixa no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rows = (await query(`
        SELECT TOP 300 mc.criado_em AS data, mc.tipo, mc.valor, mc.descricao,
               COALESCE(u.nome,'—') AS usuario
        FROM MovimentacoesCaixa mc LEFT JOIN Usuarios u ON u.id=mc.usuario_id
        WHERE mc.empresa_id=@emp AND mc.criado_em BETWEEN @de AND @ate
        ORDER BY mc.criado_em DESC
      `, { emp, de, ate })).recordset;
      const sup = rows.filter(r => r.tipo === 'suprimento').reduce((s, r) => s + Number(r.valor || 0), 0);
      const san = rows.filter(r => r.tipo === 'sangria').reduce((s, r) => s + Number(r.valor || 0), 0);
      return {
        kpis: [
          { label: 'Suprimentos', valor: sup, tipo: 'moeda', cor: 'green' },
          { label: 'Sangrias', valor: san, tipo: 'moeda', cor: 'red' },
          { label: 'Lançamentos', valor: rows.length, tipo: 'num' },
        ],
        colunas: [
          { key: 'data', label: 'Data', tipo: 'data' },
          { key: 'tipo', label: 'Tipo', tipo: 'badge' },
          { key: 'descricao', label: 'Descrição', tipo: 'texto' },
          { key: 'usuario', label: 'Operador', tipo: 'texto' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: null,
      };
    },
  },

  // ── DRE SIMPLIFICADO (resultado do período) ────────────────────
  dre: {
    titulo: 'Resultado do Período (DRE)',
    descricao: 'Demonstração simplificada: receita − custo dos produtos − despesas pagas.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const v = (await query(`
        SELECT COALESCE(SUM(total),0) AS faturamento, COALESCE(SUM(desconto),0) AS descontos
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0];

      const cmv = Number((await query(`
        SELECT COALESCE(SUM(iv.quantidade * p.preco_custo),0) AS cmv
        FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
        JOIN Vendas v ON v.id=iv.venda_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0].cmv);

      const despesas = Number((await query(`
        SELECT COALESCE(SUM(valor_pago),0) AS v FROM PagamentosContasPagar
        WHERE empresa_id=@emp AND estornado=0 AND data_pagamento BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0].v);

      const receita = Number(v.faturamento);
      const lucroBruto = receita - cmv;
      const resultado = lucroBruto - despesas;
      const margem = receita > 0 ? (resultado / receita) * 100 : 0;
      return {
        kpis: [
          { label: 'Receita', valor: receita, tipo: 'moeda', cor: 'green' },
          { label: 'Lucro Bruto', valor: lucroBruto, tipo: 'moeda' },
          { label: 'Resultado Líquido', valor: resultado, tipo: 'moeda', cor: resultado >= 0 ? 'green' : 'red' },
          { label: 'Margem Líquida', valor: margem, tipo: 'pct' },
        ],
        colunas: [
          { key: 'item', label: 'Conta', tipo: 'texto' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
        ],
        linhas: [
          { item: '(+) Receita de Vendas', valor: receita },
          { item: '(−) Custo dos Produtos Vendidos (CMV)', valor: -cmv },
          { item: '(=) Lucro Bruto', valor: lucroBruto },
          { item: '(−) Despesas Pagas', valor: -despesas },
          { item: '(=) Resultado Líquido', valor: resultado },
        ],
        grafico: null,
      };
    },
  },

  // ── RESULTADO MENSAL (DRE por mês) ─────────────────────────────
  'resultado-mensal': {
    titulo: 'Resultado Mensal',
    descricao: 'Receita, custo, despesas e resultado líquido mês a mês.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const rec = (await query(`
        SELECT FORMAT(criado_em,'yyyy-MM') AS mes, SUM(total) AS receita
        FROM Vendas WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
        GROUP BY FORMAT(criado_em,'yyyy-MM')
      `, { emp, de, ate })).recordset;

      const cmv = (await query(`
        SELECT FORMAT(v.criado_em,'yyyy-MM') AS mes, SUM(iv.quantidade * p.preco_custo) AS cmv
        FROM ItensVenda iv JOIN Produtos p ON p.id=iv.produto_id
        JOIN Vendas v ON v.id=iv.venda_id
        WHERE v.empresa_id=@emp AND v.criado_em BETWEEN @de AND @ate
        GROUP BY FORMAT(v.criado_em,'yyyy-MM')
      `, { emp, de, ate })).recordset;

      const desp = (await query(`
        SELECT FORMAT(data_pagamento,'yyyy-MM') AS mes, SUM(valor_pago) AS despesas
        FROM PagamentosContasPagar
        WHERE empresa_id=@emp AND estornado=0 AND data_pagamento BETWEEN @de AND @ate
        GROUP BY FORMAT(data_pagamento,'yyyy-MM')
      `, { emp, de, ate })).recordset;

      // Mescla as três séries por mês
      const mapa = {};
      const get = m => (mapa[m] || (mapa[m] = { mes: m, receita: 0, cmv: 0, despesas: 0 }));
      rec.forEach(r => { get(r.mes).receita = Number(r.receita || 0); });
      cmv.forEach(r => { get(r.mes).cmv = Number(r.cmv || 0); });
      desp.forEach(r => { get(r.mes).despesas = Number(r.despesas || 0); });

      const rows = Object.values(mapa).sort((a, b) => a.mes.localeCompare(b.mes));
      rows.forEach(r => {
        const [y, m] = r.mes.split('-'); r.mes_label = `${m}/${y}`;
        r.lucro_bruto = r.receita - r.cmv;
        r.resultado = r.lucro_bruto - r.despesas;
      });
      const receita   = rows.reduce((s, r) => s + r.receita, 0);
      const resultado = rows.reduce((s, r) => s + r.resultado, 0);
      const melhor = rows.reduce((a, r) => r.resultado > (a ? a.resultado : -Infinity) ? r : a, null);
      return {
        kpis: [
          { label: 'Receita', valor: receita, tipo: 'moeda', cor: 'green' },
          { label: 'Resultado', valor: resultado, tipo: 'moeda', cor: resultado >= 0 ? 'green' : 'red' },
          { label: 'Melhor Mês', valor: melhor ? melhor.mes_label : '—', tipo: 'texto' },
        ],
        colunas: [
          { key: 'mes_label', label: 'Mês', tipo: 'texto' },
          { key: 'receita', label: 'Receita', tipo: 'moeda' },
          { key: 'cmv', label: 'CMV', tipo: 'moeda' },
          { key: 'lucro_bruto', label: 'Lucro Bruto', tipo: 'moeda' },
          { key: 'despesas', label: 'Despesas', tipo: 'moeda' },
          { key: 'resultado', label: 'Resultado', tipo: 'moeda' },
        ],
        linhas: rows,
        grafico: {
          tipo: 'line', label: 'Resultado por mês',
          labels: rows.map(r => r.mes_label), valores: rows.map(r => r.resultado),
        },
      };
    },
  },

  // ── FLUXO DE CAIXA (entradas x saídas) ─────────────────────────
  'fluxo-caixa': {
    titulo: 'Fluxo de Caixa',
    descricao: 'Entradas (vendas + recebimentos) e saídas (contas pagas) no período.',
    usaPeriodo: true,
    async run(emp, de, ate) {
      const vendas = Number((await query(`
        SELECT COALESCE(SUM(total),0) AS v FROM Vendas
        WHERE empresa_id=@emp AND criado_em BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0].v);

      const receb = Number((await query(`
        SELECT COALESCE(SUM(valor_recebido),0) AS v FROM RecebimentosContas
        WHERE empresa_id=@emp AND estornado=0 AND data_recebimento BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0].v);

      const pagos = Number((await query(`
        SELECT COALESCE(SUM(valor_pago),0) AS v FROM PagamentosContasPagar
        WHERE empresa_id=@emp AND estornado=0 AND data_pagamento BETWEEN @de AND @ate
      `, { emp, de, ate })).recordset[0].v);

      const entradas = vendas + receb;
      const saldo = entradas - pagos;
      return {
        kpis: [
          { label: 'Entradas', valor: entradas, tipo: 'moeda', cor: 'green' },
          { label: 'Saídas', valor: pagos, tipo: 'moeda', cor: 'red' },
          { label: 'Saldo do Período', valor: saldo, tipo: 'moeda', cor: saldo >= 0 ? 'green' : 'red' },
        ],
        colunas: [
          { key: 'item', label: 'Movimento', tipo: 'texto' },
          { key: 'valor', label: 'Valor', tipo: 'moeda' },
        ],
        linhas: [
          { item: 'Vendas no período', valor: vendas },
          { item: 'Recebimentos (contas a receber)', valor: receb },
          { item: 'Pagamentos (contas a pagar)', valor: -pagos },
          { item: 'Saldo', valor: saldo },
        ],
        grafico: {
          tipo: 'doughnut', label: 'Composição',
          labels: ['Vendas', 'Recebimentos', 'Saídas'],
          valores: [vendas, receb, pagos],
        },
      };
    },
  },
};

// ── Lista os relatórios disponíveis (para montar o menu) ──────────
router.get('/tipos', auth, (req, res) => {
  res.json(Object.entries(RELATORIOS).map(([id, r]) => ({
    id, titulo: r.titulo, descricao: r.descricao, usaPeriodo: r.usaPeriodo,
  })));
});

// ── Gera um relatório ─────────────────────────────────────────────
// GET /api/relatorios/gerar?tipo=produtos-mais-vendidos&de=&ate=
router.get('/gerar', auth, async (req, res) => {
  const rel = RELATORIOS[req.query.tipo];
  if (!rel) return res.status(404).json({ error: 'Tipo de relatório inválido.' });
  try {
    const data = await rel.run(req.user.empresa_id, dDe(req.query.de), dAte(req.query.ate));
    res.json({
      tipo: req.query.tipo, titulo: rel.titulo, descricao: rel.descricao,
      usaPeriodo: rel.usaPeriodo,
      periodo: rel.usaPeriodo ? { de: req.query.de, ate: req.query.ate } : null,
      ...data,
    });
  } catch (err) {
    console.error('Erro relatório', req.query.tipo, err);
    res.status(500).json({ error: 'Erro ao gerar relatório.' });
  }
});

module.exports = router;
