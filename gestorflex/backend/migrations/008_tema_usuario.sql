-- 008: Preferência de tema por usuário
ALTER TABLE Usuarios ADD COLUMN IF NOT EXISTS tema VARCHAR(10) NOT NULL DEFAULT 'light';
