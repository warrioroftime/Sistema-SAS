-- ================================================================
-- Migração: Empresas — configurações de SaaS (plano, limites, status)
-- Idempotente
-- ================================================================
USE GestorFlex;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='plano')
  ALTER TABLE Empresas ADD plano NVARCHAR(40) NOT NULL DEFAULT 'Gratuito';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='data_contratacao')
  ALTER TABLE Empresas ADD data_contratacao DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='data_vencimento')
  ALTER TABLE Empresas ADD data_vencimento DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='status')
  ALTER TABLE Empresas ADD status NVARCHAR(12) NOT NULL DEFAULT 'ativa';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='limite_usuarios')
  ALTER TABLE Empresas ADD limite_usuarios INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='limite_produtos')
  ALTER TABLE Empresas ADD limite_produtos INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='limite_clientes')
  ALTER TABLE Empresas ADD limite_clientes INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='limite_armazenamento')
  ALTER TABLE Empresas ADD limite_armazenamento INT NULL;   -- em MB
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='trial_expira_em')
  ALTER TABLE Empresas ADD trial_expira_em DATE NULL;
GO

-- CHECK de status (ativa/suspensa/bloqueada/cancelada)
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_Empresas_status')
  ALTER TABLE Empresas ADD CONSTRAINT CK_Empresas_status
    CHECK (status IN ('ativa','suspensa','bloqueada','cancelada'));
GO

-- Sincroniza status inicial a partir do campo ativo legado
UPDATE Empresas SET status = CASE WHEN ativo=1 THEN 'ativa' ELSE 'suspensa' END
WHERE status IS NULL OR status = '';
GO

PRINT 'Migração Empresas SaaS aplicada com sucesso.';
GO
