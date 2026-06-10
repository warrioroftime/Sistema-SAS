// src/routes/admin.js — Gerenciamento de Empresas e Usuários (admin global)
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { auth, adminOnly } = require('../middleware/auth');
const { query } = require('../db');

router.use(auth, adminOnly);

// ── EMPRESAS ──────────────────────────────────────────────────────

const STATUS_EMP = ['ativa', 'suspensa', 'bloqueada', 'cancelada'];
const numOrNull = v => (v === '' || v === null || v === undefined ? null : parseInt(v));
const dateOrNull = v => (v ? new Date(v) : null);

// GET /api/admin/empresas
router.get('/empresas', async (req, res) => {
  try {
    const r = await query(`
      SELECT e.id, e.razao_social, e.cnpj, e.email, e.telefone, e.ativo, e.criado_em,
             e.plano, e.data_contratacao, e.data_vencimento, e.status,
             e.limite_usuarios, e.limite_produtos, e.limite_clientes,
             e.limite_armazenamento, e.trial_expira_em,
             COUNT(u.id) AS qtd_usuarios
      FROM Empresas e
      LEFT JOIN Usuarios u ON u.empresa_id = e.id
      GROUP BY e.id, e.razao_social, e.cnpj, e.email, e.telefone, e.ativo, e.criado_em,
               e.plano, e.data_contratacao, e.data_vencimento, e.status,
               e.limite_usuarios, e.limite_produtos, e.limite_clientes,
               e.limite_armazenamento, e.trial_expira_em
      ORDER BY e.id DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar empresas.' });
  }
});

// POST /api/admin/empresas
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
      OUTPUT INSERTED.id
      VALUES (@razao_social, @cnpj, @email, @telefone, @plano, @dc, @dv,
              @status, @ativo, @lu, @lp, @lc, @larm, @trial)
    `, {
      razao_social: b.razao_social, cnpj: b.cnpj||null, email: b.email||null, telefone: b.telefone||null,
      plano: (b.plano||'Gratuito'), dc: dateOrNull(b.data_contratacao), dv: dateOrNull(b.data_vencimento),
      status, ativo: status === 'ativa' ? 1 : 0,
      lu: numOrNull(b.limite_usuarios), lp: numOrNull(b.limite_produtos), lc: numOrNull(b.limite_clientes),
      larm: numOrNull(b.limite_armazenamento), trial: dateOrNull(b.trial_expira_em),
    });

    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar empresa.' });
  }
});

// PUT /api/admin/empresas/:id
router.put('/empresas/:id', async (req, res) => {
  try {
    const b = req.body;
    if (!b.razao_social) return res.status(400).json({ error: 'Razão social obrigatória.' });
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
      plano: (b.plano||'Gratuito'), dc: dateOrNull(b.data_contratacao), dv: dateOrNull(b.data_vencimento),
      status, ativo: status === 'ativa' ? 1 : 0,
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

// PATCH /api/admin/empresas/:id/toggle — alterna ativa/suspensa
router.patch('/empresas/:id/toggle', async (req, res) => {
  try {
    await query(`
      UPDATE Empresas
      SET ativo  = CASE WHEN ativo=1 THEN 0 ELSE 1 END,
          status = CASE WHEN ativo=1 THEN 'suspensa' ELSE 'ativa' END
      WHERE id=@id
    `, { id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

// ── USUÁRIOS ──────────────────────────────────────────────────────

// GET /api/admin/usuarios?empresa_id=
router.get('/usuarios', async (req, res) => {
  try {
    const empresaFilter = req.query.empresa_id ? 'AND u.empresa_id=@emp' : '';
    const params = req.query.empresa_id ? { emp: parseInt(req.query.empresa_id) } : {};
    const r = await query(`
      SELECT u.id, u.nome, u.email, u.perfil, u.foto, u.ativo, u.criado_em,
             e.razao_social AS empresa_nome, e.id AS empresa_id
      FROM Usuarios u
      JOIN Empresas e ON e.id = u.empresa_id
      WHERE 1=1 ${empresaFilter}
      ORDER BY e.id, u.id DESC
    `, params);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// POST /api/admin/usuarios
router.post('/usuarios', async (req, res) => {
  try {
    const { empresa_id, nome, email, senha, perfil, foto } = req.body;
    if (!empresa_id || !nome || !email || !senha) {
      return res.status(400).json({ error: 'Empresa, nome, e-mail e senha são obrigatórios.' });
    }
    if (senha.length < 6) return res.status(400).json({ error: 'Senha mínimo 6 caracteres.' });

    const hash = await bcrypt.hash(senha, 10);
    const r = await query(`
      INSERT INTO Usuarios (empresa_id, nome, email, senha_hash, perfil, foto)
      OUTPUT INSERTED.id
      VALUES (@empresa_id, @nome, @email, @hash, @perfil, @foto)
    `, { empresa_id: parseInt(empresa_id), nome, email, hash, perfil: perfil||'operador', foto: foto||null });

    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    if (err.message && err.message.includes('UQ_usuarios_email')) {
      return res.status(400).json({ error: 'E-mail já cadastrado nesta empresa.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// PUT /api/admin/usuarios/:id
router.put('/usuarios/:id', async (req, res) => {
  try {
    const { nome, email, perfil, foto } = req.body;
    if (!nome || !email) return res.status(400).json({ error: 'Nome e e-mail obrigatórios.' });

    await query(`
      UPDATE Usuarios
      SET nome=@nome, email=@email, perfil=@perfil,
          foto=CASE WHEN @foto IS NOT NULL THEN @foto ELSE foto END
      WHERE id=@id
    `, { nome, email, perfil: perfil||'operador', foto: foto !== undefined ? (foto||null) : null, id: parseInt(req.params.id) });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

// PATCH /api/admin/usuarios/:id/toggle
router.patch('/usuarios/:id/toggle', async (req, res) => {
  try {
    await query(`
      UPDATE Usuarios SET ativo = CASE WHEN ativo=1 THEN 0 ELSE 1 END WHERE id=@id
    `, { id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

// POST /api/admin/usuarios/:id/reset-senha
router.post('/usuarios/:id/reset-senha', async (req, res) => {
  try {
    const { nova_senha } = req.body;
    if (!nova_senha || nova_senha.length < 6) {
      return res.status(400).json({ error: 'Senha mínimo 6 caracteres.' });
    }
    const hash = await bcrypt.hash(nova_senha, 10);
    await query(`UPDATE Usuarios SET senha_hash=@hash WHERE id=@id`, {
      hash, id: parseInt(req.params.id)
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

module.exports = router;
