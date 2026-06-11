-- 008_tema_usuario: preferência de tema (claro/escuro) por usuário
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Usuarios') AND name='tema')
  ALTER TABLE Usuarios ADD tema NVARCHAR(10) NOT NULL DEFAULT 'light';
GO
