-- 005: Código de barras em Produtos
ALTER TABLE Produtos ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(50) NULL;
