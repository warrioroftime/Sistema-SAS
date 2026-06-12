-- 006: Contas a Pagar
CREATE TABLE IF NOT EXISTS ContasPagar (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES Empresas(id),
  fornecedor       VARCHAR(200) NOT NULL,
  categoria        VARCHAR(100) NULL,
  descricao        VARCHAR(500) NULL,
  numero_documento VARCHAR(40) NULL,
  parcela_num      INTEGER NOT NULL DEFAULT 1,
  parcelas_total   INTEGER NOT NULL DEFAULT 1,
  valor            DECIMAL(15,2) NOT NULL DEFAULT 0,
  data_emissao     TIMESTAMP NULL,
  data_vencimento  TIMESTAMP NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','parcial','pago','cancelado')),
  data_pagamento   TIMESTAMP NULL,
  valor_pago       DECIMAL(15,2) NOT NULL DEFAULT 0,
  observacao       VARCHAR(500) NULL,
  criado_por       INTEGER NULL,
  criado_em        TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS PagamentosContasPagar (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES Empresas(id),
  conta_id         INTEGER NOT NULL REFERENCES ContasPagar(id),
  valor_pago       DECIMAL(15,2) NOT NULL DEFAULT 0,
  forma_pagamento  VARCHAR(30) NOT NULL DEFAULT 'dinheiro',
  data_pagamento   TIMESTAMP NOT NULL DEFAULT NOW(),
  usuario_id       INTEGER NULL,
  observacao       VARCHAR(500) NULL,
  estornado        BOOLEAN NOT NULL DEFAULT FALSE,
  estornado_por    INTEGER NULL,
  estornado_em     TIMESTAMP NULL,
  criado_em        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS IX_PagamentosCP_conta ON PagamentosContasPagar(conta_id);
