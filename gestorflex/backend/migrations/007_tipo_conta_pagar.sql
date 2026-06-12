-- 007: Tipo de conta a pagar (fornecedor vs despesa operacional)
ALTER TABLE ContasPagar ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'fornecedor';
