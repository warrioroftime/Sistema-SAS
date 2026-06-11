-- 005_codigo_barras: adiciona campo de código de barras aos produtos
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Produtos') AND name='codigo_barras')
  ALTER TABLE Produtos ADD codigo_barras NVARCHAR(50) NULL;
GO
