// src/routes/saas.js — Painel SaaS (gestão de tenants)
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { auth } = require('../middleware/auth');
const { query } = require('../db');

// Apenas usuários SaaS ou admins da empresa 1 (matriz)
function saasGuard(req, res, next) {
  const u = req.user;
  if (Number(u.empresa_id) !== 1 || (u.perfil !== 'saas' && u.perfil !== 'admin')) {
    return res.status(403).json({ error: 'Acesso restrito ao painel SaaS.' });
  }
  next();
}

router.use(auth, saasGuard);

const STATUS_EMP  = ['ativa', 'suspensa', 'bloqueada', 'cancelada'];
const numOrNull   = v => (v === '' || v == null ? null : parseInt(v));
const dateOrNull  = v => (v ? new Date(v) : null);

// ── STATS (dashboard) ────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const r = await query(`
      SELECT
        COUNT(*)                                                                AS total,
        SUM(CASE WHEN status='ativa'     THEN 1 ELSE 0 END)                   AS ativas,
        SUM(CASE WHEN status='suspensa'  THEN 1 ELSE 0 END)                   AS suspensas,
        SUM(CASE WHEN status='bloqueada' THEN 1 ELSE 0 END)                   AS bloqueadas,
        SUM(CASE WHEN status='cancelada' THEN 1 ELSE 0 END)                   AS canceladas,
        SUM(CASE WHEN trial_expira_em IS NOT NULL
                  AND trial_expira_em >= CURRENT_DATE
                  AND status='ativa' THEN 1 ELSE 0 END)                        AS em_trial,
        SUM(CASE WHEN trial_expira_em IS NOT NULL
                  AND trial_expira_em BETWEEN CURRENT_DATE
                  AND CURRENT_DATE + INTERVAL '7 days'
                  AND status='ativa' THEN 1 ELSE 0 END)                        AS trial_expirando_7d,
        SUM(CASE WHEN data_vencimento IS NOT NULL
                  AND data_vencimento BETWEEN CURRENT_DATE
                  AND CURRENT_DATE + INTERVAL '30 days'
                  AND status='ativa' THEN 1 ELSE 0 END)                        AS vencendo_30d,
        SUM(CASE WHEN data_vencimento IS NOT NULL
                  AND data_vencimento < CURRENT_DATE
                  AND status='ativa' THEN 1 ELSE 0 END)                        AS vencidas
      FROM Empresas WHERE id <> 1
    `);
    const s = r.recordset[0];

    // Distribuição por plano
    const planos = await query(`
      SELECT plano, COUNT(*) AS qtd
      FROM Empresas WHERE id <> 1
      GROUP BY plano ORDER BY qtd DESC
    `);

    // Alertas: trials expirando em 7 dias
    const alertas_trial = await query(`
      SELECT id, razao_social, trial_expira_em,
             (trial_expira_em::date - CURRENT_DATE) AS dias_restantes
      FROM Empresas
      WHERE id <> 1 AND trial_expira_em IS NOT NULL
        AND trial_expira_em BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND status = 'ativa'
      ORDER BY trial_expira_em
    `);

    // Alertas: vencimentos próximos em 30 dias
    const alertas_venc = await query(`
      SELECT id, razao_social, data_vencimento, plano,
             (data_vencimento::date - CURRENT_DATE) AS dias_restantes
      FROM Empresas
      WHERE id <> 1 AND data_vencimento IS NOT NULL
        AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND status = 'ativa'
      ORDER BY data_vencimento
    `);

    res.json({
      ...s,
      planos: planos.recordset,
      alertas_trial: alertas_trial.recordset,
      alertas_venc:  alertas_venc.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar estatísticas.' });
  }
});

// ── LISTAR EMPRESAS ──────────────────────────────────────────────
router.get('/empresas', async (req, res) => {
  try {
    const { status, plano, q } = req.query;
    let where = 'WHERE e.id <> 1';
    const params = {};
    if (status) { where += ' AND e.status=@status'; params.status = status; }
    if (plano)  { where += ' AND e.plano=@plano';   params.plano  = plano;  }
    if (q)      { where += ' AND (e.razao_social LIKE @q OR e.cnpj LIKE @q OR e.email LIKE @q)'; params.q = `%${q}%`; }

    const r = await query(`
      SELECT e.id, e.razao_social, e.cnpj, e.email, e.telefone, e.ativo,
             e.plano, e.data_contratacao, e.data_vencimento, e.status, e.criado_em,
             e.limite_usuarios, e.limite_produtos, e.limite_clientes,
             e.limite_armazenamento, e.trial_expira_em,
             COUNT(u.id) AS qtd_usuarios
      FROM Empresas e
      LEFT JOIN Usuarios u ON u.empresa_id = e.id
      ${where}
      GROUP BY e.id
      ORDER BY e.id DESC
    `, params);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar empresas.' });
  }
});

// ── DETALHE EMPRESA ──────────────────────────────────────────────
router.get('/empresas/:id', async (req, res) => {
  try {
    const r = await query(`
      SELECT e.id, e.razao_social, e.cnpj, e.email, e.telefone, e.ativo,
             e.plano, e.data_contratacao, e.data_vencimento, e.status, e.logo, e.criado_em,
             e.limite_usuarios, e.limite_produtos, e.limite_clientes,
             e.limite_armazenamento, e.trial_expira_em,
             COUNT(u.id) AS qtd_usuarios
      FROM Empresas e
      LEFT JOIN Usuarios u ON u.empresa_id = e.id
      WHERE e.id = @id AND e.id <> 1
      GROUP BY e.id
    `, { id: parseInt(req.params.id) });
    if (!r.recordset[0]) return res.status(404).json({ error: 'Empresa não encontrada.' });
    res.json(r.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar empresa.' });
  }
});

// ── CRIAR EMPRESA ────────────────────────────────────────────────
router.post('/empresas', async (req, res) => {
  try {
    const b = req.body;
    if (!b.razao_social) return res.status(400).json({ error: 'Razão social obrigatória.' });
    const status = STATUS_EMP.includes(b.status) ? b.status : 'ativa';

    const r = await query(`
      INSERT INTO Empresas
        (razao_social, cnpj, email, telefone, plano, data_contratacao, data_vencimento,
         status, ativo, limite_usuarios, limite_produtos, limite_clientes,
         limite_armazenamento, trial_expira_em)
      VALUES (@razao_social, @cnpj, @email, @telefone, @plano, @dc, @dv,
              @status, @ativo, @lu, @lp, @lc, @larm, @trial)
      RETURNING id
    `, {
      razao_social: b.razao_social, cnpj: b.cnpj||null, email: b.email||null, telefone: b.telefone||null,
      plano: b.plano||'Gratuito', dc: dateOrNull(b.data_contratacao), dv: dateOrNull(b.data_vencimento),
      status, ativo: status === 'ativa',
      lu: numOrNull(b.limite_usuarios), lp: numOrNull(b.limite_produtos), lc: numOrNull(b.limite_clientes),
      larm: numOrNull(b.limite_armazenamento), trial: dateOrNull(b.trial_expira_em),
    });

    const empresaId = r.recordset[0].id;

    // Cria usuário admin inicial se fornecido
    if (b.admin_nome && b.admin_email && b.admin_senha) {
      if (b.admin_senha.length < 6) return res.status(400).json({ error: 'Senha do admin mínimo 6 caracteres.' });
      const hash = await bcrypt.hash(b.admin_senha, 10);
      await query(`
        INSERT INTO Usuarios (empresa_id, nome, email, senha_hash, perfil)
        VALUES (@emp, @nome, @email, @hash, 'admin')
      `, { emp: empresaId, nome: b.admin_nome, email: b.admin_email, hash });
    }

    res.status(201).json({ id: empresaId });
  } catch (err) {
    if (err.message?.includes('UQ_usuarios_email')) {
      return res.status(400).json({ error: 'E-mail do admin já cadastrado.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar empresa.' });
  }
});

// ── ATUALIZAR EMPRESA ────────────────────────────────────────────
router.put('/empresas/:id', async (req, res) => {
  try {
    const b = req.body;
    if (!b.razao_social) return res.status(400).json({ error: 'Razão social obrigatória.' });
    if (parseInt(req.params.id) === 1) return res.status(403).json({ error: 'Não é possível editar a empresa matriz.' });
    const status = STATUS_EMP.includes(b.status) ? b.status : 'ativa';

    await query(`
      UPDATE Empresas
      SET razao_social=@razao_social, cnpj=@cnpj, email=@email, telefone=@telefone,
          plano=@plano, data_contratacao=@dc, data_vencimento=@dv, status=@status,
          ativo=@ativo, limite_usuarios=@lu, limite_produtos=@lp, limite_clientes=@lc,
          limite_armazenamento=@larm, trial_expira_em=@trial
      WHERE id=@id
    `, {
      razao_social: b.razao_social, cnpj: b.cnpj||null, email: b.email||null, telefone: b.telefone||null,
      plano: b.plano||'Gratuito', dc: dateOrNull(b.data_contratacao), dv: dateOrNull(b.data_vencimento),
      status, ativo: status === 'ativa',
      lu: numOrNull(b.limite_usuarios), lp: numOrNull(b.limite_produtos), lc: numOrNull(b.limite_clientes),
      larm: numOrNull(b.limite_armazenamento), trial: dateOrNull(b.trial_expira_em),
      id: parseInt(req.params.id),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar empresa.' });
  }
});

// ── TOGGLE STATUS ────────────────────────────────────────────────
router.patch('/empresas/:id/toggle', async (req, res) => {
  try {
    if (parseInt(req.params.id) === 1) return res.status(403).json({ error: 'Não é possível alterar a empresa matriz.' });
    await query(`
      UPDATE Empresas
      SET ativo  = NOT ativo,
          status = CASE WHEN ativo THEN 'suspensa' ELSE 'ativa' END
      WHERE id=@id
    `, { id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

// ── ALTERAR STATUS ESPECÍFICO ────────────────────────────────────
router.patch('/empresas/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUS_EMP.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    if (parseInt(req.params.id) === 1) return res.status(403).json({ error: 'Não é possível alterar a empresa matriz.' });
    await query(`
      UPDATE Empresas SET status=@status, ativo=@ativo WHERE id=@id
    `, { status, ativo: status === 'ativa', id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

// ── USUÁRIOS DE UMA EMPRESA ──────────────────────────────────────
router.get('/empresas/:id/usuarios', async (req, res) => {
  try {
    const r = await query(`
      SELECT id, nome, email, perfil, ativo, criado_em
      FROM Usuarios WHERE empresa_id=@id ORDER BY id DESC
    `, { id: parseInt(req.params.id) });
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// ── RESET SENHA DO USUÁRIO ───────────────────────────────────────
router.post('/usuarios/:id/reset-senha', async (req, res) => {
  try {
    const { nova_senha } = req.body;
    if (!nova_senha || nova_senha.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres.' });
    const hash = await bcrypt.hash(nova_senha, 10);
    await query(`UPDATE Usuarios SET senha_hash=@hash WHERE id=@id`, { hash, id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

module.exports = router;
