// src/routes/auth.js
const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { query, sql } = require('../db');
const { auth }  = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });

    const result = await query(`
      SELECT u.id, u.empresa_id, u.nome, u.email, u.senha_hash, u.perfil, u.ativo, u.foto, u.tema, u.permissoes,
             e.razao_social AS empresa_nome, e.logo AS empresa_logo
      FROM Usuarios u
      JOIN Empresas e ON e.id = u.empresa_id
      WHERE u.email = @email AND e.ativo = TRUE
    `, { email });

    const user = result.recordset[0];
    if (!user || !user.ativo) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const payload = {
      id:           user.id,
      empresa_id:   user.empresa_id,
      nome:         user.nome,
      email:        user.email,
      perfil:       user.perfil,
      empresa_nome: user.empresa_nome,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    // foto, tema e permissoes fora do JWT (mudam sem re-login)
    let permissoes = null;
    try { permissoes = user.permissoes ? JSON.parse(user.permissoes) : null; } catch {}
    res.json({ token, user: { ...payload, foto: user.foto || null, tema: user.tema || 'light', permissoes, empresa_logo: user.empresa_logo || null } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/auth/me — retorna dados do usuário atual
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/tema — salva preferência de tema do usuário logado
router.put('/tema', auth, async (req, res) => {
  try {
    const tema = req.body.tema === 'dark' ? 'dark' : 'light';
    await query(
      'UPDATE Usuarios SET tema = @tema WHERE id = @id AND empresa_id = @emp',
      { tema, id: req.user.id, emp: req.user.empresa_id }
    );
    res.json({ ok: true, tema });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar tema.' });
  }
});

// POST /api/auth/trocar-senha
router.post('/trocar-senha', auth, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha || nova_senha.length < 6) {
      return res.status(400).json({ error: 'Senhas inválidas. Nova senha mínimo 6 caracteres.' });
    }

    const result = await query(
      'SELECT senha_hash FROM Usuarios WHERE id=@id AND empresa_id=@emp',
      { id: req.user.id, emp: req.user.empresa_id }
    );
    const user = result.recordset[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const ok = await bcrypt.compare(senha_atual, user.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' });

    const hash = await bcrypt.hash(nova_senha, 10);
    await query(
      'UPDATE Usuarios SET senha_hash=@hash WHERE id=@id AND empresa_id=@emp',
      { hash, id: req.user.id, emp: req.user.empresa_id }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
