-- 009_permissoes_usuario: permissões granulares por usuário (JSON array de páginas permitidas)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Usuarios') AND name='permissoes')
  ALTER TABLE Usuarios ADD permissoes NVARCHAR(MAX) NULL;
GO
