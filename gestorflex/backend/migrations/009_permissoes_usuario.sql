-- 009: Permissões granulares por usuário (JSON)
ALTER TABLE Usuarios ADD COLUMN IF NOT EXISTS permissoes TEXT NULL;
