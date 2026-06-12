// src/routes/wizard.js — Importação em massa via planilha
const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { query } = require('../db');

router.use(auth);

// ── Grupos (Categorias) ────────────────────────────────────────────
router.post('/grupos', async (req, res) => {
  const { dados } = req.body;
  if (!Array.isArray(dados) || !dados.length)
    return res.status(400).json({ error: 'Nenhum dado fornecido.' });

  const emp = req.user.grupo_id;
  const erros = [];
  let importados = 0;

  for (let i = 0; i < dados.length; i++) {
    const nome = String(dados[i].nome || '').trim();
    if (!nome) { erros.push({ linha: i + 1, erro: 'Nome obrigatório' }); continue; }
    try {
      await query(
        `INSERT INTO Categorias (empresa_id, nome) VALUES (@emp, @nome)
         ON CONFLICT ON CONSTRAINT UQ_cat_nome DO NOTHING`,
        { emp, nome }
      );
      importados++;
    } catch (err) {
      erros.push({ linha: i + 1, erro: err.message });
    }
  }

  res.json({ total: dados.length, importados, erros });
});

// ── Produtos ───────────────────────────────────────────────────────
router.post('/produtos', async (req, res) => {
  const { dados } = req.body;
  if (!Array.isArray(dados) || !dados.length)
    return res.status(400).json({ error: 'Nenhum dado fornecido.' });

  const emp = req.user.grupo_id;
  const erros = [];
  let importados = 0;

  // Pré-carrega categorias para resolver categoria_nome → id
  const cats = await query('SELECT id, nome FROM Categorias WHERE empresa_id=@emp', { emp });
  const catMap = new Map(cats.recordset.map(c => [c.nome.toLowerCase(), c.id]));

  // Maior código numérico atual para gerar sequencial
  const seqR = await query(
    `SELECT MAX(CASE WHEN codigo ~ '^[0-9]+$' THEN codigo::INTEGER ELSE NULL END) AS maxcod
     FROM Produtos WHERE empresa_id=@emp`,
    { emp }
  );
  let nextCod = (seqR.recordset[0].maxcod || 0) + 1;

  for (let i = 0; i < dados.length; i++) {
    const row = dados[i];
    const descricao    = String(row.descricao   || '').trim();
    const preco_venda  = parseFloat(String(row.preco_venda || '').replace(',', '.'));

    if (!descricao || isNaN(preco_venda) || preco_venda <= 0) {
      erros.push({ linha: i + 1, erro: 'Descrição e preço de venda são obrigatórios' });
      continue;
    }

    let codigo = String(row.codigo || '').trim();
    if (!codigo) codigo = String(nextCod++);

    const catNome    = String(row.categoria_nome || '').trim().toLowerCase();
    const categoria_id = catNome ? (catMap.get(catNome) || null) : null;

    try {
      const r = await query(
        `INSERT INTO Produtos
           (empresa_id, codigo, codigo_barras, descricao, categoria_id, preco_custo, preco_venda,
            estoque, estoque_min, status, controla_estoque)
         VALUES (@emp, @cod, @barras, @desc, @cat, @custo, @preco, @est, @min, @st, @ce)
         ON CONFLICT ON CONSTRAINT UQ_prod_codigo DO NOTHING
         RETURNING id`,
        {
          emp,
          cod:    codigo,
          barras: String(row.codigo_barras || '').trim() || null,
          desc:   descricao,
          cat:    categoria_id,
          custo:  parseFloat(String(row.preco_custo || '0').replace(',', '.')) || 0,
          preco:  preco_venda,
          est:    parseInt(row.estoque)     || 0,
          min:    parseInt(row.estoque_min) || 5,
          st:     ['ativo', 'inativo'].includes(String(row.status)) ? String(row.status) : 'ativo',
          ce:     true,
        }
      );

      const newId = r.recordset[0]?.id;
      if (newId && parseInt(row.estoque) > 0) {
        await query(
          `INSERT INTO MovimentacoesEstoque
             (empresa_id, produto_id, tipo, quantidade, saldo_anterior, saldo_atual, origem, usuario_id)
           VALUES (@emp, @pid, 'entrada', @qtd, 0, @qtd, 'Importação em massa', @uid)`,
          { emp, pid: newId, qtd: parseInt(row.estoque), uid: req.user.id }
        );
      }
      importados++;
    } catch (err) {
      erros.push({ linha: i + 1, erro: err.message });
    }
  }

  res.json({ total: dados.length, importados, erros });
});

// ── Clientes ───────────────────────────────────────────────────────
router.post('/clientes', async (req, res) => {
  const { dados } = req.body;
  if (!Array.isArray(dados) || !dados.length)
    return res.status(400).json({ error: 'Nenhum dado fornecido.' });

  const emp = req.user.grupo_id;
  const erros = [];
  let importados = 0;

  for (let i = 0; i < dados.length; i++) {
    const row  = dados[i];
    const nome = String(row.nome || '').trim();
    if (!nome) { erros.push({ linha: i + 1, erro: 'Nome obrigatório' }); continue; }
    try {
      await query(
        `INSERT INTO Clientes
           (empresa_id, nome, nome_fantasia, documento, telefone, email,
            cep, endereco, numero, bairro, cidade, estado)
         VALUES (@emp, @nome, @fantasia, @doc, @tel, @email, @cep, @end, @num, @bairro, @cid, @uf)`,
        {
          emp,
          nome,
          fantasia: String(row.nome_fantasia || '').trim() || null,
          doc:      String(row.documento     || '').trim() || null,
          tel:      String(row.telefone      || '').trim() || null,
          email:    String(row.email         || '').trim() || null,
          cep:      String(row.cep           || '').trim() || null,
          end:      String(row.endereco      || '').trim() || null,
          num:      String(row.numero        || '').trim() || null,
          bairro:   String(row.bairro        || '').trim() || null,
          cid:      String(row.cidade        || '').trim() || null,
          uf:       String(row.estado        || '').trim().substring(0, 2).toUpperCase() || null,
        }
      );
      importados++;
    } catch (err) {
      erros.push({ linha: i + 1, erro: err.message });
    }
  }

  res.json({ total: dados.length, importados, erros });
});

// ── Fornecedores ───────────────────────────────────────────────────
router.post('/fornecedores', async (req, res) => {
  const { dados } = req.body;
  if (!Array.isArray(dados) || !dados.length)
    return res.status(400).json({ error: 'Nenhum dado fornecido.' });

  const emp = req.user.grupo_id;
  const erros = [];
  let importados = 0;

  for (let i = 0; i < dados.length; i++) {
    const row  = dados[i];
    const nome = String(row.nome || '').trim();
    if (!nome) { erros.push({ linha: i + 1, erro: 'Nome obrigatório' }); continue; }
    try {
      await query(
        `INSERT INTO Fornecedores
           (empresa_id, nome, documento, telefone, email, endereco, cidade, estado, observacao)
         VALUES (@emp, @nome, @doc, @tel, @email, @end, @cid, @uf, @obs)`,
        {
          emp,
          nome,
          doc:   String(row.documento  || '').trim() || null,
          tel:   String(row.telefone   || '').trim() || null,
          email: String(row.email      || '').trim() || null,
          end:   String(row.endereco   || '').trim() || null,
          cid:   String(row.cidade     || '').trim() || null,
          uf:    String(row.estado     || '').trim().substring(0, 2).toUpperCase() || null,
          obs:   String(row.observacao || '').trim() || null,
        }
      );
      importados++;
    } catch (err) {
      erros.push({ linha: i + 1, erro: err.message });
    }
  }

  res.json({ total: dados.length, importados, erros });
});

// ── Contas a Receber ───────────────────────────────────────────────
router.post('/contas-receber', async (req, res) => {
  const { dados } = req.body;
  if (!Array.isArray(dados) || !dados.length)
    return res.status(400).json({ error: 'Nenhum dado fornecido.' });

  const emp = req.user.empresa_id;
  const erros = [];
  let importados = 0;

  // Pré-carrega clientes para resolver cliente_nome → id
  const clis = await query(
    'SELECT id, nome FROM Clientes WHERE empresa_id=@emp AND ativo=true',
    { emp }
  );
  const cliMap = new Map(clis.recordset.map(c => [c.nome.toLowerCase(), c.id]));

  for (let i = 0; i < dados.length; i++) {
    const row   = dados[i];
    const valor = parseFloat(String(row.valor || '').replace(',', '.'));

    if (isNaN(valor) || valor <= 0) {
      erros.push({ linha: i + 1, erro: 'Valor obrigatório e deve ser maior que zero' });
      continue;
    }

    // Aceita DD/MM/AAAA ou AAAA-MM-DD
    let dvenc = null;
    const rawDate = String(row.data_vencimento || '').trim();
    if (rawDate) {
      const parts = rawDate.split('/');
      dvenc = parts.length === 3
        ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
        : rawDate;
    }

    const cliNome  = String(row.cliente_nome || '').trim().toLowerCase();
    const cliente_id = cliNome ? (cliMap.get(cliNome) || null) : null;

    try {
      await query(
        `INSERT INTO ContasReceber
           (empresa_id, cliente_id, numero_documento, parcela_num, parcelas_total,
            valor, data_emissao, data_vencimento, status, lancamento_manual, observacao, criado_por)
         VALUES (@emp, @cid, @ndoc, 1, 1, @val, NOW(),
                 COALESCE(@dvenc::date, CURRENT_DATE + INTERVAL '30 days'),
                 'pendente', true, @obs, @uid)`,
        {
          emp,
          cid:  cliente_id,
          ndoc: String(row.numero_documento || '').trim() || null,
          val:  valor,
          dvenc: dvenc,
          obs:  String(row.observacao || '').trim() || null,
          uid:  req.user.id,
        }
      );
      importados++;
    } catch (err) {
      erros.push({ linha: i + 1, erro: err.message });
    }
  }

  res.json({ total: dados.length, importados, erros });
});

module.exports = router;
