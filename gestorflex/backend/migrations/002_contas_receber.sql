-- ================================================================
-- Migração: Contas a Receber — fundação financeira
-- Idempotente: pode rodar várias vezes sem erro
-- ================================================================
USE GestorFlex;
GO

-- ── Novas colunas em ContasReceber ──────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='numero_documento')
  ALTER TABLE ContasReceber ADD numero_documento NVARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='data_emissao')
  ALTER TABLE ContasReceber ADD data_emissao DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='juros')
  ALTER TABLE ContasReceber ADD juros DECIMAL(15,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='multa')
  ALTER TABLE ContasReceber ADD multa DECIMAL(15,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='desconto')
  ALTER TABLE ContasReceber ADD desconto DECIMAL(15,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='acrescimo')
  ALTER TABLE ContasReceber ADD acrescimo DECIMAL(15,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='lancamento_manual')
  ALTER TABLE ContasReceber ADD lancamento_manual BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='criado_por')
  ALTER TABLE ContasReceber ADD criado_por INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='alterado_por')
  ALTER TABLE ContasReceber ADD alterado_por INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasReceber') AND name='alterado_em')
  ALTER TABLE ContasReceber ADD alterado_em DATETIME2 NULL;
GO

-- Preenche data_emissao retroativa para títulos antigos
UPDATE ContasReceber SET data_emissao = criado_em WHERE data_emissao IS NULL;
GO

-- ── Expandir o CHECK de status ──────────────────────────────────
DECLARE @cn NVARCHAR(256);
SELECT @cn = cc.name
  FROM sys.check_constraints cc
 WHERE cc.parent_object_id = OBJECT_ID('ContasReceber')
   AND cc.definition LIKE '%status%';
IF @cn IS NOT NULL EXEC('ALTER TABLE ContasReceber DROP CONSTRAINT ' + @cn);
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_ContasReceber_status')
  ALTER TABLE ContasReceber ADD CONSTRAINT CK_ContasReceber_status
    CHECK (status IN ('pendente','parcial','recebido','cancelado','renegociado'));
GO

-- ── Tabela de RECEBIMENTOS (baixas individuais de um título) ─────
IF OBJECT_ID('RecebimentosContas') IS NULL
CREATE TABLE RecebimentosContas (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id       INT NOT NULL REFERENCES Empresas(id),
    conta_id         INT NOT NULL REFERENCES ContasReceber(id),
    valor_principal  DECIMAL(15,2) NOT NULL DEFAULT 0,   -- abatido da dívida
    juros            DECIMAL(15,2) NOT NULL DEFAULT 0,
    multa            DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto         DECIMAL(15,2) NOT NULL DEFAULT 0,
    acrescimo        DECIMAL(15,2) NOT NULL DEFAULT 0,
    valor_recebido   DECIMAL(15,2) NOT NULL DEFAULT 0,   -- dinheiro que entrou
    forma_pagamento  NVARCHAR(20) NOT NULL DEFAULT 'dinheiro',
    data_recebimento DATETIME2 NOT NULL DEFAULT GETDATE(),
    usuario_id       INT REFERENCES Usuarios(id),        -- operador que recebeu
    caixa_id         INT NULL,                           -- turno de caixa vinculado
    observacao       NVARCHAR(500) NULL,
    estornado        BIT NOT NULL DEFAULT 0,
    estornado_por    INT NULL,
    estornado_em     DATETIME2 NULL,
    criado_em        DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RecebimentosContas_conta')
  CREATE INDEX IX_RecebimentosContas_conta ON RecebimentosContas(conta_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RecebimentosContas_caixa')
  CREATE INDEX IX_RecebimentosContas_caixa ON RecebimentosContas(caixa_id, forma_pagamento);
GO

PRINT 'Migração Contas a Receber aplicada com sucesso.';
GO
