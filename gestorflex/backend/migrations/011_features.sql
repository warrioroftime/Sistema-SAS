-- 011_features: devoluções/cancelamento, fornecedores+compras, múltiplos pagamentos
-- Idempotente.

-- ── Status da venda (ativa | cancelada) ───────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Vendas') AND name='status')
  ALTER TABLE Vendas ADD status NVARCHAR(12) NOT NULL DEFAULT 'ativa';
GO

-- ── Devoluções / trocas ───────────────────────────────────────────
IF OBJECT_ID('Devolucoes') IS NULL
CREATE TABLE Devolucoes (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  empresa_id   INT NOT NULL REFERENCES Empresas(id),
  venda_id     INT NOT NULL REFERENCES Vendas(id),
  tipo         NVARCHAR(10) NOT NULL DEFAULT 'parcial',   -- 'parcial' | 'total'
  valor        DECIMAL(15,2) NOT NULL DEFAULT 0,
  motivo       NVARCHAR(300) NULL,
  usuario_id   INT NULL,
  criado_em    DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF OBJECT_ID('ItensDevolucao') IS NULL
CREATE TABLE ItensDevolucao (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  devolucao_id  INT NOT NULL REFERENCES Devolucoes(id),
  produto_id    INT NOT NULL REFERENCES Produtos(id),
  quantidade    INT NOT NULL,
  preco_unit    DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal      DECIMAL(15,2) NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Devolucoes_venda')
  CREATE INDEX IX_Devolucoes_venda ON Devolucoes(venda_id);
GO

-- ── Fornecedores ──────────────────────────────────────────────────
IF OBJECT_ID('Fornecedores') IS NULL
CREATE TABLE Fornecedores (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  empresa_id  INT NOT NULL REFERENCES Empresas(id),
  nome        NVARCHAR(150) NOT NULL,
  documento   NVARCHAR(20) NULL,
  telefone    NVARCHAR(20) NULL,
  email       NVARCHAR(150) NULL,
  endereco    NVARCHAR(250) NULL,
  cidade      NVARCHAR(100) NULL,
  estado      CHAR(2) NULL,
  observacao  NVARCHAR(300) NULL,
  ativo       BIT NOT NULL DEFAULT 1,
  criado_em   DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- ── Compras (entrada de mercadoria) ───────────────────────────────
IF OBJECT_ID('Compras') IS NULL
CREATE TABLE Compras (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  empresa_id        INT NOT NULL REFERENCES Empresas(id),
  fornecedor_id     INT NULL REFERENCES Fornecedores(id),
  numero_documento  NVARCHAR(40) NULL,
  total             DECIMAL(15,2) NOT NULL DEFAULT 0,
  observacao        NVARCHAR(300) NULL,
  gerou_conta_pagar BIT NOT NULL DEFAULT 0,
  usuario_id        INT NULL,
  criado_em         DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF OBJECT_ID('ItensCompra') IS NULL
CREATE TABLE ItensCompra (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  compra_id   INT NOT NULL REFERENCES Compras(id),
  produto_id  INT NOT NULL REFERENCES Produtos(id),
  quantidade  INT NOT NULL,
  custo_unit  DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal    DECIMAL(15,2) NOT NULL DEFAULT 0
);
GO

-- ── Múltiplas formas de pagamento por venda ───────────────────────
IF OBJECT_ID('VendaPagamentos') IS NULL
CREATE TABLE VendaPagamentos (
  id                 INT IDENTITY(1,1) PRIMARY KEY,
  empresa_id         INT NOT NULL REFERENCES Empresas(id),
  venda_id           INT NOT NULL REFERENCES Vendas(id),
  forma_pagamento_id INT NULL REFERENCES FormasPagamento(id),
  forma              NVARCHAR(30) NULL,
  valor              DECIMAL(15,2) NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_VendaPagamentos_venda')
  CREATE INDEX IX_VendaPagamentos_venda ON VendaPagamentos(venda_id);
GO

PRINT 'Migração 011 (features) aplicada com sucesso.';
GO
