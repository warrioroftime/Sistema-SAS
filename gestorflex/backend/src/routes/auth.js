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
             e.razao_social AS empresa_nome, e.logo AS empresa_logo, e.matriz_id
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

    // grupo_id: se for filial usa o id da matriz, senão usa o próprio id
    const grupo_id = user.matriz_id ?? user.empresa_id;

    // Busca filiais se o usuário está na raiz do grupo (empresa sem matriz_id)
    let empresas = null;
    if (!user.matriz_id) {
      const filiaisR = await query(
        'SELECT id, razao_social, logo FROM Empresas WHERE matriz_id=@mid AND ativo=TRUE ORDER BY razao_social',
        { mid: user.empresa_id }
      );
      if (filiaisR.recordset.length > 0) {
        empresas = [
          { id: user.empresa_id, razao_social: user.empresa_nome, logo: user.empresa_logo, tipo: 'matriz' },
          ...filiaisR.recordset.map(f => ({ ...f, tipo: 'filial' })),
        ];
      }
    }

    const payload = {
      id:           user.id,
      empresa_id:   user.empresa_id,
      grupo_id,
      nome:         user.nome,
      email:        user.email,
      perfil:       user.perfil,
      empresa_nome: user.empresa_nome,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    let permissoes = null;
    try { permissoes = user.permissoes ? JSON.parse(user.permissoes) : null; } catch {}
    res.json({
      token,
      user: { ...payload, foto: user.foto || null, tema: user.tema || 'light', permissoes, empresa_logo: user.empresa_logo || null },
      empresas, // null para standalone/filial, array para matriz com filiais
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/auth/selecionar-empresa — troca de empresa dentro do grupo
router.post('/selecionar-empresa', auth, async (req, res) => {
  try {
    const { empresa_id } = req.body;
    if (!empresa_id) return res.status(400).json({ error: 'empresa_id obrigatório.' });

    const grupoId = req.user.grupo_id;

    // Usuário só pode acessar a própria matriz ou filiais dela
    const valid = await query(
      `SELECT id, razao_social, logo, matriz_id FROM Empresas
       WHERE id=@eid AND ativo=TRUE AND (id=@gid OR matriz_id=@gid)`,
      { eid: parseInt(empresa_id), gid: grupoId }
    );
    if (!valid.recordset.length) return res.status(403).json({ error: 'Acesso negado a esta empresa.' });

    const emp = valid.recordset[0];
    const novo_grupo_id = emp.matriz_id ?? emp.id;

    const payload = {
      id:           req.user.id,
      empresa_id:   emp.id,
      grupo_id:     novo_grupo_id,
      nome:         req.user.nome,
      email:        req.user.email,
      perfil:       req.user.perfil,
      empresa_nome: emp.razao_social,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    res.json({ token, user: { ...payload, empresa_logo: emp.logo || null } });
  } catch (err) {
    console.error('Selecionar empresa error:', err);
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
