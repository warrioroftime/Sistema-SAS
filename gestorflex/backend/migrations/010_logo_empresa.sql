-- 010_logo_empresa: logo da empresa (imagem base64) p/ marca d'água no PDV
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Empresas') AND name='logo')
  ALTER TABLE Empresas ADD logo NVARCHAR(MAX) NULL;
GO
