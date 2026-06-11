-- ================================================================
-- GestorFlex — Schema SQL Server
-- Execute este script UMA vez para criar o banco e todas as tabelas
-- ================================================================

-- 1. Criar banco (execute conectado ao master)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'GestorFlex')
BEGIN
    CREATE DATABASE GestorFlex
    COLLATE Latin1_General_CI_AI;
    PRINT 'Banco GestorFlex criado.';
END
GO

USE GestorFlex;
GO

-- ----------------------------------------------------------------
-- EMPRESAS (multi-tenant: cada empresa é um tenant)
-- ----------------------------------------------------------------
IF OBJECT_ID('Empresas') IS NULL
CREATE TABLE Empresas (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    razao_social  NVARCHAR(150) NOT NULL,
    cnpj          NVARCHAR(20),
    email         NVARCHAR(150),
    telefone      NVARCHAR(20),
    ativo         BIT NOT NULL DEFAULT 1,
    -- Configurações de SaaS
    plano                NVARCHAR(40) NOT NULL DEFAULT 'Gratuito',
    data_contratacao     DATE NULL,
    data_vencimento      DATE NULL,
    status               NVARCHAR(12) NOT NULL DEFAULT 'ativa'
                         CHECK (status IN ('ativa','suspensa','bloqueada','cancelada')),
    limite_usuarios      INT NULL,
    limite_produtos      INT NULL,
    limite_clientes      INT NULL,
    limite_armazenamento INT NULL,            -- em MB
    trial_expira_em      DATE NULL,
    criado_em     DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- ----------------------------------------------------------------
-- USUÁRIOS
-- ----------------------------------------------------------------
IF OBJECT_ID('Usuarios') IS NULL
CREATE TABLE Usuarios (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id   INT NOT NULL REFERENCES Empresas(id),
    nome         NVARCHAR(120) NOT NULL,
    email        NVARCHAR(150) NOT NULL,
    senha_hash   NVARCHAR(255) NOT NULL,
    perfil       NVARCHAR(20) NOT NULL DEFAULT 'operador'
                 CHECK (perfil IN ('admin','gerente','operador','saas')),
    foto         NVARCHAR(MAX) NULL,
    ativo        BIT NOT NULL DEFAULT 1,
    criado_em    DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_usuarios_email UNIQUE (empresa_id, email)
);
GO

-- Adiciona coluna foto se já existir a tabela sem ela
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Usuarios') AND name='foto')
  ALTER TABLE Usuarios ADD foto NVARCHAR(MAX) NULL;
GO

-- ----------------------------------------------------------------
-- CATEGORIAS (por empresa)
-- ----------------------------------------------------------------
IF OBJECT_ID('Categorias') IS NULL
CREATE TABLE Categorias (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id  INT NOT NULL REFERENCES Empresas(id),
    nome        NVARCHAR(80) NOT NULL,
    CONSTRAINT UQ_cat_nome UNIQUE (empresa_id, nome)
);
GO

-- ----------------------------------------------------------------
-- CLIENTES
-- ----------------------------------------------------------------
IF OBJECT_ID('Clientes') IS NULL
CREATE TABLE Clientes (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id    INT NOT NULL REFERENCES Empresas(id),
    nome          NVARCHAR(150) NOT NULL,      -- razão social ou nome
    nome_fantasia NVARCHAR(150),
    documento     NVARCHAR(20),                -- CPF ou CNPJ
    telefone      NVARCHAR(20),
    email         NVARCHAR(150),
    cep           NVARCHAR(10),
    endereco      NVARCHAR(250),               -- logradouro
    numero        NVARCHAR(20),
    bairro        NVARCHAR(100),
    cidade        NVARCHAR(100),
    estado        CHAR(2),
    ativo         BIT NOT NULL DEFAULT 1,
    criado_em     DATETIME2 NOT NULL DEFAULT GETDATE(),
    atualizado_em DATETIME2
);
GO

-- Colunas adicionadas posteriormente (idempotente para bancos já existentes)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Clientes') AND name='nome_fantasia')
  ALTER TABLE Clientes ADD nome_fantasia NVARCHAR(150) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Clientes') AND name='cep')
  ALTER TABLE Clientes ADD cep NVARCHAR(10) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Clientes') AND name='numero')
  ALTER TABLE Clientes ADD numero NVARCHAR(20) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Clientes') AND name='bairro')
  ALTER TABLE Clientes ADD bairro NVARCHAR(100) NULL;
GO

-- ----------------------------------------------------------------
-- PRODUTOS
-- ----------------------------------------------------------------
IF OBJECT_ID('Produtos') IS NULL
CREATE TABLE Produtos (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id    INT NOT NULL REFERENCES Empresas(id),
    codigo        NVARCHAR(30) NOT NULL,
    codigo_barras NVARCHAR(50) NULL,
    descricao     NVARCHAR(200) NOT NULL,
    categoria_id  INT REFERENCES Categorias(id),
    preco_custo   DECIMAL(15,2) NOT NULL DEFAULT 0,
    preco_venda   DECIMAL(15,2) NOT NULL DEFAULT 0,
    estoque       INT NOT NULL DEFAULT 0,
    estoque_min   INT NOT NULL DEFAULT 5,
    status        NVARCHAR(10) NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo','inativo')),
    controla_estoque BIT NOT NULL DEFAULT 1,
    foto          NVARCHAR(MAX) NULL,
    criado_em     DATETIME2 NOT NULL DEFAULT GETDATE(),
    atualizado_em DATETIME2,
    CONSTRAINT UQ_prod_codigo UNIQUE (empresa_id, codigo)
);
GO

-- Colunas adicionadas posteriormente (idempotente para bancos já existentes)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Produtos') AND name='controla_estoque')
  ALTER TABLE Produtos ADD controla_estoque BIT NOT NULL DEFAULT 1;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Produtos') AND name='foto')
  ALTER TABLE Produtos ADD foto NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Produtos') AND name='codigo_barras')
  ALTER TABLE Produtos ADD codigo_barras NVARCHAR(50) NULL;
GO

-- ----------------------------------------------------------------
-- MOVIMENTAÇÕES DE ESTOQUE
-- ----------------------------------------------------------------
IF OBJECT_ID('MovimentacoesEstoque') IS NULL
CREATE TABLE MovimentacoesEstoque (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id    INT NOT NULL REFERENCES Empresas(id),
    produto_id    INT NOT NULL REFERENCES Produtos(id),
    tipo          NVARCHAR(10) NOT NULL CHECK (tipo IN ('entrada','saida')),
    quantidade    INT NOT NULL,
    saldo_anterior INT NOT NULL,
    saldo_atual   INT NOT NULL,
    origem        NVARCHAR(200),         -- ex: "Venda #1042", "Compra fornecedor"
    usuario_id    INT REFERENCES Usuarios(id),
    criado_em     DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- ----------------------------------------------------------------
-- FORMAS DE PAGAMENTO
-- ----------------------------------------------------------------
IF OBJECT_ID('FormasPagamento') IS NULL
CREATE TABLE FormasPagamento (
    id    INT IDENTITY(1,1) PRIMARY KEY,
    nome  NVARCHAR(50) NOT NULL
);
GO
INSERT INTO FormasPagamento (nome)
SELECT v FROM (VALUES
    ('dinheiro'),('pix'),('debito'),('credito'),('transferencia'),('fiado')
) t(v)
WHERE NOT EXISTS (SELECT 1 FROM FormasPagamento);
GO

-- ----------------------------------------------------------------
-- VENDAS
-- ----------------------------------------------------------------
IF OBJECT_ID('Vendas') IS NULL
CREATE TABLE Vendas (
    id                   INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id           INT NOT NULL REFERENCES Empresas(id),
    cliente_id           INT REFERENCES Clientes(id),
    forma_pagamento_id   INT REFERENCES FormasPagamento(id),
    subtotal             DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto             DECIMAL(15,2) NOT NULL DEFAULT 0,
    total                DECIMAL(15,2) NOT NULL DEFAULT 0,
    observacao           NVARCHAR(500),
    usuario_id           INT REFERENCES Usuarios(id),
    status_cobranca      NVARCHAR(20) NOT NULL DEFAULT 'recebido',  -- 'pendente' p/ fiado
    data_vencimento      DATETIME2 NULL,
    data_recebimento     DATETIME2 NULL,
    criado_em            DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- Colunas adicionadas posteriormente (idempotente para bancos já existentes)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Vendas') AND name='status_cobranca')
  ALTER TABLE Vendas ADD status_cobranca NVARCHAR(20) NOT NULL DEFAULT 'recebido';
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Vendas') AND name='data_vencimento')
  ALTER TABLE Vendas ADD data_vencimento DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Vendas') AND name='data_recebimento')
  ALTER TABLE Vendas ADD data_recebimento DATETIME2 NULL;
GO

-- ----------------------------------------------------------------
-- ITENS DE VENDA
-- ----------------------------------------------------------------
IF OBJECT_ID('ItensVenda') IS NULL
CREATE TABLE ItensVenda (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    venda_id    INT NOT NULL REFERENCES Vendas(id) ON DELETE CASCADE,
    produto_id  INT NOT NULL REFERENCES Produtos(id),
    quantidade  INT NOT NULL,
    preco_unit  DECIMAL(15,2) NOT NULL,
    subtotal    DECIMAL(15,2) NOT NULL
);
GO

-- ----------------------------------------------------------------
-- CONTAS A RECEBER (parcelas de vendas a prazo / fiado)
-- ----------------------------------------------------------------
IF OBJECT_ID('ContasReceber') IS NULL
CREATE TABLE ContasReceber (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id        INT NOT NULL REFERENCES Empresas(id),
    venda_id          INT REFERENCES Vendas(id),
    cliente_id        INT REFERENCES Clientes(id),
    numero_documento  NVARCHAR(40) NULL,
    parcela_num       INT NOT NULL DEFAULT 1,
    parcelas_total    INT NOT NULL DEFAULT 1,
    valor             DECIMAL(15,2) NOT NULL,              -- valor original da parcela
    juros             DECIMAL(15,2) NOT NULL DEFAULT 0,    -- acumulado dos recebimentos
    multa             DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto          DECIMAL(15,2) NOT NULL DEFAULT 0,
    acrescimo         DECIMAL(15,2) NOT NULL DEFAULT 0,
    data_emissao      DATETIME2 NULL,
    data_vencimento   DATETIME2 NULL,
    status            NVARCHAR(20) NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','parcial','recebido','cancelado','renegociado')),
    data_recebimento  DATETIME2 NULL,
    valor_recebido    DECIMAL(15,2) NULL,                  -- total recebido acumulado
    lancamento_manual BIT NOT NULL DEFAULT 0,
    observacao        NVARCHAR(500) NULL,
    criado_por        INT NULL,
    alterado_por      INT NULL,
    alterado_em       DATETIME2 NULL,
    criado_em         DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- Recebimentos (baixas individuais) de cada título — total/parcial, com forma de pgto e operador
IF OBJECT_ID('RecebimentosContas') IS NULL
CREATE TABLE RecebimentosContas (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id       INT NOT NULL REFERENCES Empresas(id),
    conta_id         INT NOT NULL REFERENCES ContasReceber(id),
    valor_principal  DECIMAL(15,2) NOT NULL DEFAULT 0,   -- abatido da dívida
    juros            DECIMAL(15,2) NOT NULL DEFAULT 0,
    multa            DECIMAL(15,2) NOT NULL DEFAULT 0,
    desconto         DECIMAL(15,2) NOT NULL DEFAULT 0,
    acrescimo        DECIMAL(15,2) NOT NULL DEFAULT 0,
    valor_recebido   DECIMAL(15,2) NOT NULL DEFAULT 0,   -- dinheiro que entrou
    forma_pagamento  NVARCHAR(20) NOT NULL DEFAULT 'dinheiro',
    data_recebimento DATETIME2 NOT NULL DEFAULT GETDATE(),
    usuario_id       INT REFERENCES Usuarios(id),        -- operador que recebeu
    caixa_id         INT NULL,                           -- turno de caixa vinculado
    observacao       NVARCHAR(500) NULL,
    estornado        BIT NOT NULL DEFAULT 0,
    estornado_por    INT NULL,
    estornado_em     DATETIME2 NULL,
    criado_em        DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RecebimentosContas_conta')
  CREATE INDEX IX_RecebimentosContas_conta ON RecebimentosContas(conta_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RecebimentosContas_caixa')
  CREATE INDEX IX_RecebimentosContas_caixa ON RecebimentosContas(caixa_id, forma_pagamento);
GO

-- ----------------------------------------------------------------
-- CAIXA (turnos de caixa: abertura, sangria/suprimento, fechamento)
-- ----------------------------------------------------------------
IF OBJECT_ID('Caixa') IS NULL
CREATE TABLE Caixa (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    empresa_id      INT NOT NULL REFERENCES Empresas(id),
    usuario_id      INT NOT NULL REFERENCES Usuarios(id),
    valor_abertura  DECIMAL(15,2) NOT NULL DEFAULT 0,  -- troco inicial
    data_abertura   DATETIME2 NOT NULL DEFAULT GETDATE(),
    valor_informado DECIMAL(15,2) NULL,                -- dinheiro contado no fechamento
    valor_esperado  DECIMAL(15,2) NULL,                -- calculado pelo sistema
    diferenca       DECIMAL(15,2) NULL,                -- informado - esperado
    data_fechamento DATETIME2 NULL,
    status          NVARCHAR(10) NOT NULL DEFAULT 'aberto'
                    CHECK (status IN ('aberto','fechado')),
    obs_abertura    NVARCHAR(300) NULL,
    obs_fechamento  NVARCHAR(300) NULL
);
GO

-- Sangrias (retiradas) e suprimentos (entradas de troco)
IF OBJECT_ID('MovimentacoesCaixa') IS NULL
CREATE TABLE MovimentacoesCaixa (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    caixa_id    INT NOT NULL REFERENCES Caixa(id),
    empresa_id  INT NOT NULL REFERENCES Empresas(id),
    tipo        NVARCHAR(12) NOT NULL CHECK (tipo IN ('sangria','suprimento')),
    valor       DECIMAL(15,2) NOT NULL,
    descricao   NVARCHAR(300) NULL,
    usuario_id  INT REFERENCES Usuarios(id),
    criado_em   DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- Vincula a venda ao turno de caixa (idempotente)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Vendas') AND name='caixa_id')
  ALTER TABLE Vendas ADD caixa_id INT NULL;
GO

-- ----------------------------------------------------------------
-- ÍNDICES de performance
-- ----------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Vendas_empresa_data')
    CREATE INDEX IX_Vendas_empresa_data     ON Vendas(empresa_id, criado_em DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Produtos_empresa')
    CREATE INDEX IX_Produtos_empresa        ON Produtos(empresa_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Clientes_empresa')
    CREATE INDEX IX_Clientes_empresa        ON Clientes(empresa_id, ativo);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_MovEstoque_empresa')
    CREATE INDEX IX_MovEstoque_empresa      ON MovimentacoesEstoque(empresa_id, criado_em DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_ItensVenda_venda')
    CREATE INDEX IX_ItensVenda_venda        ON ItensVenda(venda_id);
GO

-- ----------------------------------------------------------------
-- DADOS INICIAIS — Empresa demo + admin
-- ----------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM Empresas WHERE razao_social = 'Empresa Demo Ltda.')
BEGIN
    INSERT INTO Empresas (razao_social, cnpj, email, telefone)
    VALUES ('Empresa Demo Ltda.', '00.000.000/0001-00', 'demo@gestorflex.com', '(00) 0000-0000');

    -- Senha padrão: admin123  (bcrypt hash gerado externamente)
    -- Para gerar outro hash: node -e "const b=require('bcryptjs');console.log(b.hashSync('admin123',10))"
    DECLARE @emp INT = SCOPE_IDENTITY();

    INSERT INTO Usuarios (empresa_id, nome, email, senha_hash, perfil)
    VALUES (
        @emp,
        'Administrador',
        'admin@gestorflex.com',
        '$2b$10$7auEnT5GnMheCt4zTSnPxe09JvgY6lKYlxzYhJMDkfYuvb7nJ9E3K',  -- admin123
        'admin'
    );

    INSERT INTO Categorias (empresa_id, nome) VALUES
        (@emp,'Eletrônicos'), (@emp,'Escritório'), (@emp,'Outros'),
        (@emp,'Higiene'), (@emp,'Limpeza'), (@emp,'Alimentos');

    PRINT 'Dados iniciais inseridos. Login: admin@gestorflex.com / admin123';
END
GO

PRINT 'Schema GestorFlex aplicado com sucesso.';
GO
