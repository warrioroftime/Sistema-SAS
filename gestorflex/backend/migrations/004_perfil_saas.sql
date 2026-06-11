-- ================================================================
-- Migração: adiciona perfil 'saas' ao CHECK de Usuarios
-- Idempotente
-- ================================================================
USE GestorFlex;
GO

-- Remove constraint antiga (se existir) e recria incluindo 'saas'
DECLARE @c NVARCHAR(200);
SELECT @c = name FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('Usuarios') AND name LIKE '%perfil%';
IF @c IS NOT NULL
  EXEC('ALTER TABLE Usuarios DROP CONSTRAINT ' + @c);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID('Usuarios') AND name = 'CK_Usuarios_perfil'
)
  ALTER TABLE Usuarios ADD CONSTRAINT CK_Usuarios_perfil
    CHECK (perfil IN ('admin','gerente','operador','saas'));
GO

PRINT 'Migração 004 — perfil saas aplicada com sucesso.';
GO
