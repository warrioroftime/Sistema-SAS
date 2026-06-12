// src/middleware/auth.js
const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido.' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    // backward compat: tokens antigos sem grupo_id usam empresa_id como raiz
    if (!req.user.grupo_id) req.user.grupo_id = req.user.empresa_id;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.perfil !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
}

// Apenas a matriz (empresa 1) pode gerenciar empresas (tenants)
const MATRIZ_ID = 1;
function matrizOnly(req, res, next) {
  if (Number(req.user.empresa_id) !== MATRIZ_ID) {
    return res.status(403).json({ error: 'Acesso restrito à empresa matriz.' });
  }
  next();
}

module.exports = { auth, adminOnly, matrizOnly, MATRIZ_ID };
