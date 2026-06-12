-- 003: Empresas — configurações de SaaS
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS plano VARCHAR(40) NOT NULL DEFAULT 'Gratuito';
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS data_contratacao DATE NULL;
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS data_vencimento DATE NULL;
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'ativa';
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS limite_usuarios INTEGER NULL;
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS limite_produtos INTEGER NULL;
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS limite_clientes INTEGER NULL;
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS limite_armazenamento INTEGER NULL;
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS trial_expira_em DATE NULL;

ALTER TABLE Empresas DROP CONSTRAINT IF EXISTS CK_Empresas_status;
ALTER TABLE Empresas ADD CONSTRAINT CK_Empresas_status
  CHECK (status IN ('ativa','suspensa','bloqueada','cancelada'));

UPDATE Empresas SET status = CASE WHEN ativo = TRUE THEN 'ativa' ELSE 'suspensa' END
WHERE status IS NULL OR status = '';
