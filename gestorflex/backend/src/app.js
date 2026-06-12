// src/app.js — GestorFlex API
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { getPool } = require('./db');

const app = express();

// ── Middlewares ────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check (sem auth) ────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Rotas ──────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/produtos',   require('./routes/produtos'));
app.use('/api/clientes',   require('./routes/clientes'));
app.use('/api/vendas',     require('./routes/vendas'));
app.use('/api/estoque',    require('./routes/estoque'));
app.use('/api/relatorios',      require('./routes/relatorios'));
app.use('/api/contas-receber', require('./routes/contas-receber'));
app.use('/api/contas-pagar',  require('./routes/contas-pagar'));
app.use('/api/admin',          require('./routes/admin'));
app.use('/api/cnpj',           require('./routes/cnpj'));
app.use('/api/grupos',         require('./routes/grupos'));
app.use('/api/caixa',          require('./routes/caixa'));
app.use('/api/fornecedores',   require('./routes/fornecedores'));
app.use('/api/compras',        require('./routes/compras'));
app.use('/api/notificacoes',   require('./routes/notificacoes'));
app.use('/api/comissoes',      require('./routes/comissoes'));
app.use('/api/saas',           require('./routes/saas'));

// ── Frontend estático ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../frontend/index.html')));

// ── Handler de erros ────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  try {
    await getPool(); // abre conexão com o banco na inicialização
    console.log(`🚀 GestorFlex API rodando em http://localhost:${PORT}`);
  } catch (err) {
    console.error('❌ Falha ao conectar ao PostgreSQL:', err.message);
    process.exit(1);
  }
});

module.exports = app;
