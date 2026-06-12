-- 011: Devoluções, Fornecedores, Compras, múltiplos pagamentos por venda
ALTER TABLE Vendas ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'ativa';

CREATE TABLE IF NOT EXISTS Devolucoes (
  id           SERIAL PRIMARY KEY,
  empresa_id   INTEGER NOT NULL REFERENCES Empresas(id),
  venda_id     INTEGER NOT NULL REFERENCES Vendas(id),
  tipo         VARCHAR(10) NOT NULL DEFAULT 'parcial',
  valor        DECIMAL(15,2) NOT NULL DEFAULT 0,
  motivo       VARCHAR(300) NULL,
  usuario_id   INTEGER NULL,
  criado_em    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ItensDevolucao (
  id            SERIAL PRIMARY KEY,
  devolucao_id  INTEGER NOT NULL REFERENCES Devolucoes(id),
  produto_id    INTEGER NOT NULL REFERENCES Produtos(id),
  quantidade    INTEGER NOT NULL,
  preco_unit    DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal      DECIMAL(15,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS IX_Devolucoes_venda ON Devolucoes(venda_id);

CREATE TABLE IF NOT EXISTS Fornecedores (
  id          SERIAL PRIMARY KEY,
  empresa_id  INTEGER NOT NULL REFERENCES Empresas(id),
  nome        VARCHAR(150) NOT NULL,
  documento   VARCHAR(20) NULL,
  telefone    VARCHAR(20) NULL,
  email       VARCHAR(150) NULL,
  endereco    VARCHAR(250) NULL,
  cidade      VARCHAR(100) NULL,
  estado      CHAR(2) NULL,
  observacao  VARCHAR(300) NULL,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS Compras (
  id                SERIAL PRIMARY KEY,
  empresa_id        INTEGER NOT NULL REFERENCES Empresas(id),
  fornecedor_id     INTEGER NULL REFERENCES Fornecedores(id),
  numero_documento  VARCHAR(40) NULL,
  total             DECIMAL(15,2) NOT NULL DEFAULT 0,
  observacao        VARCHAR(300) NULL,
  gerou_conta_pagar BOOLEAN NOT NULL DEFAULT FALSE,
  usuario_id        INTEGER NULL,
  criado_em         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ItensCompra (
  id          SERIAL PRIMARY KEY,
  compra_id   INTEGER NOT NULL REFERENCES Compras(id),
  produto_id  INTEGER NOT NULL REFERENCES Produtos(id),
  quantidade  INTEGER NOT NULL,
  custo_unit  DECIMAL(15,2) NOT NULL DEFAULT 0,
  subtotal    DECIMAL(15,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS VendaPagamentos (
  id                 SERIAL PRIMARY KEY,
  empresa_id         INTEGER NOT NULL REFERENCES Empresas(id),
  venda_id           INTEGER NOT NULL REFERENCES Vendas(id),
  forma_pagamento_id INTEGER NULL REFERENCES FormasPagamento(id),
  forma              VARCHAR(30) NULL,
  valor              DECIMAL(15,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS IX_VendaPagamentos_venda ON VendaPagamentos(venda_id);
