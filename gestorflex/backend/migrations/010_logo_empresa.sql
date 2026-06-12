-- 010: Logo da empresa (base64)
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS logo TEXT NULL;
