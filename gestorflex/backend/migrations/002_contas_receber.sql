-- 002: Contas a Receber — fundação financeira
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(40) NULL;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS data_emissao TIMESTAMP NULL;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS juros DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS multa DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS desconto DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS acrescimo DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS lancamento_manual BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS criado_por INTEGER NULL;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS alterado_por INTEGER NULL;
ALTER TABLE ContasReceber ADD COLUMN IF NOT EXISTS alterado_em TIMESTAMP NULL;

UPDATE ContasReceber SET data_emissao = criado_em WHERE data_emissao IS NULL;

-- Recriar constraint de status (drop se existir, recria)
DO $$
DECLARE cn TEXT;
BEGIN
  SELECT conname INTO cn FROM pg_constraint
  WHERE conrelid = 'contasreceber'::regclass AND contype = 'c' AND conname ILIKE '%status%';
  IF cn IS NOT NULL THEN EXECUTE 'ALTER TABLE ContasReceber DROP CONSTRAINT ' || cn; END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CK_ContasReceber_status') THEN
    ALTER TABLE ContasReceber ADD CONSTRAINT CK_ContasReceber_status
      CHECK (status IN ('pendente','parcial','recebido','cancelado','renegociado'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS RecebimentosContas (
    id               SERIAL PRIMARY KEY,
    empresa_id       INTEGER NOT NULL REFERENCES Empresas(id),
    conta_id         INTEGER NOT NULL REFERENCES ContasReceber(id),
    valor_principal  DECIMAL(15,2) NOT NULL DEFAULT 0,
    juros            DECIMAL(15,2) NOT NULL DEFAULT 0,
    multa            DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto         DECIMAL(15,2) NOT NULL DEFAULT 0,
    acrescimo        DECIMAL(15,2) NOT NULL DEFAULT 0,
    valor_recebido   DECIMAL(15,2) NOT NULL DEFAULT 0,
    forma_pagamento  VARCHAR(20) NOT NULL DEFAULT 'dinheiro',
    data_recebimento TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_id       INTEGER REFERENCES Usuarios(id),
    caixa_id         INTEGER NULL,
    observacao       VARCHAR(500) NULL,
    estornado        BOOLEAN NOT NULL DEFAULT FALSE,
    estornado_por    INTEGER NULL,
    estornado_em     TIMESTAMP NULL,
    criado_em        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS IX_RecebimentosContas_conta ON RecebimentosContas(conta_id);
CREATE INDEX IF NOT EXISTS IX_RecebimentosContas_caixa ON RecebimentosContas(caixa_id, forma_pagamento);
