-- 006_contas_pagar: tabelas de contas a pagar e lançamento de despesas
IF OBJECT_ID('ContasPagar') IS NULL
CREATE TABLE ContasPagar (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  empresa_id       INT NOT NULL REFERENCES Empresas(id),
  fornecedor       NVARCHAR(200) NOT NULL,
  categoria        NVARCHAR(100) NULL,
  descricao        NVARCHAR(500) NULL,
  numero_documento NVARCHAR(40)  NULL,
  parcela_num      INT NOT NULL DEFAULT 1,
  parcelas_total   INT NOT NULL DEFAULT 1,
  valor            DECIMAL(15,2) NOT NULL DEFAULT 0,
  data_emissao     DATETIME2 NULL,
  data_vencimento  DATETIME2 NULL,
  status           NVARCHAR(20) NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','parcial','pago','cancelado')),
  data_pagamento   DATETIME2 NULL,
  valor_pago       DECIMAL(15,2) NOT NULL DEFAULT 0,
  observacao       NVARCHAR(500) NULL,
  criado_por       INT NULL,
  criado_em        DATETIME2 NOT NULL DEFAULT GETDATE(),
  atualizado_em    DATETIME2 NULL
);
GO

IF OBJECT_ID('PagamentosContasPagar') IS NULL
CREATE TABLE PagamentosContasPagar (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  empresa_id       INT NOT NULL REFERENCES Empresas(id),
  conta_id         INT NOT NULL REFERENCES ContasPagar(id),
  valor_pago       DECIMAL(15,2) NOT NULL DEFAULT 0,
  forma_pagamento  NVARCHAR(30) NOT NULL DEFAULT 'dinheiro',
  data_pagamento   DATETIME2 NOT NULL DEFAULT GETDATE(),
  usuario_id       INT NULL,
  observacao       NVARCHAR(500) NULL,
  estornado        BIT NOT NULL DEFAULT 0,
  estornado_por    INT NULL,
  estornado_em     DATETIME2 NULL,
  criado_em        DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_PagamentosCP_conta')
  CREATE INDEX IX_PagamentosCP_conta ON PagamentosContasPagar(conta_id);
GO
