-- ================================================================
-- GestorFlex — Schema PostgreSQL
-- ================================================================

-- ----------------------------------------------------------------
-- EMPRESAS (multi-tenant: cada empresa é um tenant)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Empresas (
    id            SERIAL PRIMARY KEY,
    razao_social  VARCHAR(150) NOT NULL,
    cnpj          VARCHAR(20),
    email         VARCHAR(150),
    telefone      VARCHAR(20),
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    plano                VARCHAR(40) NOT NULL DEFAULT 'Gratuito',
    data_contratacao     DATE NULL,
    data_vencimento      DATE NULL,
    status               VARCHAR(12) NOT NULL DEFAULT 'ativa'
                         CHECK (status IN ('ativa','suspensa','bloqueada','cancelada')),
    limite_usuarios      INTEGER NULL,
    limite_produtos      INTEGER NULL,
    limite_clientes      INTEGER NULL,
    limite_armazenamento INTEGER NULL,
    trial_expira_em      DATE NULL,
    logo                 TEXT NULL,
    criado_em            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- USUÁRIOS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Usuarios (
    id           SERIAL PRIMARY KEY,
    empresa_id   INTEGER NOT NULL REFERENCES Empresas(id),
    nome         VARCHAR(120) NOT NULL,
    email        VARCHAR(150) NOT NULL,
    senha_hash   VARCHAR(255) NOT NULL,
    perfil       VARCHAR(20) NOT NULL DEFAULT 'operador'
                 CHECK (perfil IN ('admin','gerente','operador','saas')),
    foto         TEXT NULL,
    ativo        BOOLEAN NOT NULL DEFAULT TRUE,
    tema         VARCHAR(10) NOT NULL DEFAULT 'light',
    permissoes   TEXT NULL,
    comissao_percentual DECIMAL(5,2) NOT NULL DEFAULT 0,
    criado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT UQ_usuarios_email UNIQUE (empresa_id, email)
);

-- ----------------------------------------------------------------
-- CATEGORIAS (por empresa)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Categorias (
    id          SERIAL PRIMARY KEY,
    empresa_id  INTEGER NOT NULL REFERENCES Empresas(id),
    nome        VARCHAR(80) NOT NULL,
    CONSTRAINT UQ_cat_nome UNIQUE (empresa_id, nome)
);

-- ----------------------------------------------------------------
-- CLIENTES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Clientes (
    id            SERIAL PRIMARY KEY,
    empresa_id    INTEGER NOT NULL REFERENCES Empresas(id),
    nome          VARCHAR(150) NOT NULL,
    nome_fantasia VARCHAR(150),
    documento     VARCHAR(20),
    telefone      VARCHAR(20),
    email         VARCHAR(150),
    cep           VARCHAR(10),
    endereco      VARCHAR(250),
    numero        VARCHAR(20),
    bairro        VARCHAR(100),
    cidade        VARCHAR(100),
    estado        CHAR(2),
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP
);

-- ----------------------------------------------------------------
-- PRODUTOS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Produtos (
    id            SERIAL PRIMARY KEY,
    empresa_id    INTEGER NOT NULL REFERENCES Empresas(id),
    codigo        VARCHAR(30) NOT NULL,
    codigo_barras VARCHAR(50) NULL,
    descricao     VARCHAR(200) NOT NULL,
    categoria_id  INTEGER REFERENCES Categorias(id),
    preco_custo   DECIMAL(15,2) NOT NULL DEFAULT 0,
    preco_venda   DECIMAL(15,2) NOT NULL DEFAULT 0,
    estoque       INTEGER NOT NULL DEFAULT 0,
    estoque_min   INTEGER NOT NULL DEFAULT 5,
    status        VARCHAR(10) NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo','inativo')),
    controla_estoque BOOLEAN NOT NULL DEFAULT TRUE,
    foto          TEXT NULL,
    criado_em     TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP,
    CONSTRAINT UQ_prod_codigo UNIQUE (empresa_id, codigo)
);

-- ----------------------------------------------------------------
-- MOVIMENTAÇÕES DE ESTOQUE
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS MovimentacoesEstoque (
    id             SERIAL PRIMARY KEY,
    empresa_id     INTEGER NOT NULL REFERENCES Empresas(id),
    produto_id     INTEGER NOT NULL REFERENCES Produtos(id),
    tipo           VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada','saida')),
    quantidade     INTEGER NOT NULL,
    saldo_anterior INTEGER NOT NULL,
    saldo_atual    INTEGER NOT NULL,
    origem         VARCHAR(200),
    usuario_id     INTEGER REFERENCES Usuarios(id),
    criado_em      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- FORMAS DE PAGAMENTO
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS FormasPagamento (
    id    SERIAL PRIMARY KEY,
    nome  VARCHAR(50) NOT NULL
);

INSERT INTO FormasPagamento (nome)
SELECT v FROM (VALUES
    ('dinheiro'),('pix'),('debito'),('credito'),('transferencia'),('fiado')
) t(v)
WHERE NOT EXISTS (SELECT 1 FROM FormasPagamento);

-- ----------------------------------------------------------------
-- VENDAS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Vendas (
    id                   SERIAL PRIMARY KEY,
    empresa_id           INTEGER NOT NULL REFERENCES Empresas(id),
    cliente_id           INTEGER REFERENCES Clientes(id),
    forma_pagamento_id   INTEGER REFERENCES FormasPagamento(id),
    subtotal             DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto             DECIMAL(15,2) NOT NULL DEFAULT 0,
    total                DECIMAL(15,2) NOT NULL DEFAULT 0,
    observacao           VARCHAR(500),
    usuario_id           INTEGER REFERENCES Usuarios(id),
    status_cobranca      VARCHAR(20) NOT NULL DEFAULT 'recebido',
    status               VARCHAR(20) NOT NULL DEFAULT 'concluida',
    data_vencimento      TIMESTAMP NULL,
    data_recebimento     TIMESTAMP NULL,
    caixa_id             INTEGER NULL,
    criado_em            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- ITENS DE VENDA
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ItensVenda (
    id          SERIAL PRIMARY KEY,
    venda_id    INTEGER NOT NULL REFERENCES Vendas(id) ON DELETE CASCADE,
    produto_id  INTEGER NOT NULL REFERENCES Produtos(id),
    quantidade  INTEGER NOT NULL,
    preco_unit  DECIMAL(15,2) NOT NULL,
    subtotal    DECIMAL(15,2) NOT NULL
);

-- ----------------------------------------------------------------
-- CONTAS A RECEBER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ContasReceber (
    id                SERIAL PRIMARY KEY,
    empresa_id        INTEGER NOT NULL REFERENCES Empresas(id),
    venda_id          INTEGER REFERENCES Vendas(id),
    cliente_id        INTEGER REFERENCES Clientes(id),
    numero_documento  VARCHAR(40) NULL,
    parcela_num       INTEGER NOT NULL DEFAULT 1,
    parcelas_total    INTEGER NOT NULL DEFAULT 1,
    valor             DECIMAL(15,2) NOT NULL,
    juros             DECIMAL(15,2) NOT NULL DEFAULT 0,
    multa             DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto          DECIMAL(15,2) NOT NULL DEFAULT 0,
    acrescimo         DECIMAL(15,2) NOT NULL DEFAULT 0,
    data_emissao      TIMESTAMP NULL,
    data_vencimento   TIMESTAMP NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','parcial','recebido','cancelado','renegociado')),
    data_recebimento  TIMESTAMP NULL,
    valor_recebido    DECIMAL(15,2) NULL,
    lancamento_manual BOOLEAN NOT NULL DEFAULT FALSE,
    observacao        VARCHAR(500) NULL,
    criado_por        INTEGER NULL,
    alterado_por      INTEGER NULL,
    alterado_em       TIMESTAMP NULL,
    criado_em         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Recebimentos (baixas individuais) de cada título
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

-- ----------------------------------------------------------------
-- CAIXA
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Caixa (
    id              SERIAL PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES Empresas(id),
    usuario_id      INTEGER NOT NULL REFERENCES Usuarios(id),
    valor_abertura  DECIMAL(15,2) NOT NULL DEFAULT 0,
    data_abertura   TIMESTAMP NOT NULL DEFAULT NOW(),
    valor_informado DECIMAL(15,2) NULL,
    valor_esperado  DECIMAL(15,2) NULL,
    diferenca       DECIMAL(15,2) NULL,
    data_fechamento TIMESTAMP NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'aberto'
                    CHECK (status IN ('aberto','fechado')),
    obs_abertura    VARCHAR(300) NULL,
    obs_fechamento  VARCHAR(300) NULL
);

-- Sangrias e suprimentos
CREATE TABLE IF NOT EXISTS MovimentacoesCaixa (
    id          SERIAL PRIMARY KEY,
    caixa_id    INTEGER NOT NULL REFERENCES Caixa(id),
    empresa_id  INTEGER NOT NULL REFERENCES Empresas(id),
    tipo        VARCHAR(12) NOT NULL CHECK (tipo IN ('sangria','suprimento')),
    valor       DECIMAL(15,2) NOT NULL,
    descricao   VARCHAR(300) NULL,
    usuario_id  INTEGER REFERENCES Usuarios(id),
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- DEVOLUÇÕES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Devolucoes (
    id          SERIAL PRIMARY KEY,
    empresa_id  INTEGER NOT NULL REFERENCES Empresas(id),
    venda_id    INTEGER REFERENCES Vendas(id),
    tipo        VARCHAR(20),
    valor       DECIMAL(15,2),
    motivo      VARCHAR(500),
    usuario_id  INTEGER REFERENCES Usuarios(id),
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ItensDevolucao (
    id            SERIAL PRIMARY KEY,
    devolucao_id  INTEGER NOT NULL REFERENCES Devolucoes(id),
    produto_id    INTEGER REFERENCES Produtos(id),
    quantidade    INTEGER NOT NULL,
    preco_unit    DECIMAL(15,2) NOT NULL,
    subtotal      DECIMAL(15,2) NOT NULL
);

-- ----------------------------------------------------------------
-- VENDA PAGAMENTOS (múltiplas formas por venda)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS VendaPagamentos (
    id                  SERIAL PRIMARY KEY,
    empresa_id          INTEGER NOT NULL REFERENCES Empresas(id),
    venda_id            INTEGER NOT NULL REFERENCES Vendas(id) ON DELETE CASCADE,
    forma_pagamento_id  INTEGER REFERENCES FormasPagamento(id),
    forma               VARCHAR(30),
    valor               DECIMAL(15,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS IX_VendaPagamentos_venda ON VendaPagamentos(venda_id);

-- ----------------------------------------------------------------
-- FORNECEDORES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Fornecedores (
    id          SERIAL PRIMARY KEY,
    empresa_id  INTEGER NOT NULL REFERENCES Empresas(id),
    nome        VARCHAR(150) NOT NULL,
    documento   VARCHAR(20),
    telefone    VARCHAR(20),
    email       VARCHAR(150),
    endereco    VARCHAR(250),
    cidade      VARCHAR(100),
    estado      CHAR(2),
    observacao  VARCHAR(500),
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- COMPRAS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Compras (
    id                 SERIAL PRIMARY KEY,
    empresa_id         INTEGER NOT NULL REFERENCES Empresas(id),
    fornecedor_id      INTEGER REFERENCES Fornecedores(id),
    numero_documento   VARCHAR(40),
    total              DECIMAL(15,2) NOT NULL DEFAULT 0,
    observacao         VARCHAR(500),
    gerou_conta_pagar  BOOLEAN NOT NULL DEFAULT FALSE,
    usuario_id         INTEGER REFERENCES Usuarios(id),
    criado_em          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ItensCompra (
    id          SERIAL PRIMARY KEY,
    compra_id   INTEGER NOT NULL REFERENCES Compras(id) ON DELETE CASCADE,
    produto_id  INTEGER REFERENCES Produtos(id),
    quantidade  INTEGER NOT NULL,
    custo_unit  DECIMAL(15,2) NOT NULL,
    subtotal    DECIMAL(15,2) NOT NULL
);

-- ----------------------------------------------------------------
-- CONTAS A PAGAR
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ContasPagar (
    id               SERIAL PRIMARY KEY,
    empresa_id       INTEGER NOT NULL REFERENCES Empresas(id),
    fornecedor       VARCHAR(150),
    categoria        VARCHAR(80),
    descricao        VARCHAR(300),
    numero_documento VARCHAR(40),
    parcela_num      INTEGER NOT NULL DEFAULT 1,
    parcelas_total   INTEGER NOT NULL DEFAULT 1,
    valor            DECIMAL(15,2) NOT NULL,
    data_emissao     TIMESTAMP NULL,
    data_vencimento  TIMESTAMP NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente','parcial','pago','cancelado')),
    data_pagamento   TIMESTAMP NULL,
    valor_pago       DECIMAL(15,2) NULL,
    observacao       VARCHAR(500) NULL,
    tipo             VARCHAR(30),
    criado_por       INTEGER NULL,
    criado_em        TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em    TIMESTAMP
);

CREATE TABLE IF NOT EXISTS PagamentosContasPagar (
    id               SERIAL PRIMARY KEY,
    empresa_id       INTEGER NOT NULL REFERENCES Empresas(id),
    conta_id         INTEGER NOT NULL REFERENCES ContasPagar(id),
    valor_pago       DECIMAL(15,2) NOT NULL,
    forma_pagamento  VARCHAR(20),
    data_pagamento   TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_id       INTEGER REFERENCES Usuarios(id),
    observacao       VARCHAR(500) NULL,
    estornado        BOOLEAN NOT NULL DEFAULT FALSE,
    estornado_por    INTEGER NULL,
    estornado_em     TIMESTAMP NULL,
    criado_em        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS IX_PagamentosContasPagar_conta ON PagamentosContasPagar(conta_id);

-- ----------------------------------------------------------------
-- ÍNDICES de performance
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS IX_Vendas_empresa_data    ON Vendas(empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS IX_Produtos_empresa       ON Produtos(empresa_id, status);
CREATE INDEX IF NOT EXISTS IX_Clientes_empresa       ON Clientes(empresa_id, ativo);
CREATE INDEX IF NOT EXISTS IX_MovEstoque_empresa     ON MovimentacoesEstoque(empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS IX_ItensVenda_venda       ON ItensVenda(venda_id);
CREATE INDEX IF NOT EXISTS IX_Devolucoes_venda       ON Devolucoes(venda_id);

-- ----------------------------------------------------------------
-- DADOS INICIAIS — Empresa demo + admin
-- ----------------------------------------------------------------
DO $$
DECLARE emp_id INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM Empresas WHERE razao_social = 'Empresa Demo Ltda.') THEN
        INSERT INTO Empresas (razao_social, cnpj, email, telefone)
        VALUES ('Empresa Demo Ltda.', '00.000.000/0001-00', 'demo@gestorflex.com', '(00) 0000-0000')
        RETURNING id INTO emp_id;

        -- Senha padrão: admin123
        INSERT INTO Usuarios (empresa_id, nome, email, senha_hash, perfil)
        VALUES (
            emp_id,
            'Administrador',
            'admin@gestorflex.com',
            '$2b$10$7auEnT5GnMheCt4zTSnPxe09JvgY6lKYlxzYhJMDkfYuvb7nJ9E3K',
            'admin'
        );

        INSERT INTO Categorias (empresa_id, nome) VALUES
            (emp_id,'Eletrônicos'), (emp_id,'Escritório'), (emp_id,'Outros'),
            (emp_id,'Higiene'), (emp_id,'Limpeza'), (emp_id,'Alimentos');

        RAISE NOTICE 'Dados iniciais inseridos. Login: admin@gestorflex.com / admin123';
    END IF;
END $$;
