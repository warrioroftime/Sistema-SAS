-- 012_comissao: percentual de comissão por vendedor (usuário)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Usuarios') AND name='comissao_percentual')
  ALTER TABLE Usuarios ADD comissao_percentual DECIMAL(5,2) NOT NULL DEFAULT 0;
GO
