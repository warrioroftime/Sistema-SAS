-- 012: Percentual de comissão por vendedor
ALTER TABLE Usuarios ADD COLUMN IF NOT EXISTS comissao_percentual DECIMAL(5,2) NOT NULL DEFAULT 0;
