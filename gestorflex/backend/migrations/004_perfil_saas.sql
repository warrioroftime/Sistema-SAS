-- 004: Adiciona perfil 'saas' ao CHECK de Usuarios
DO $$
DECLARE cn TEXT;
BEGIN
  SELECT conname INTO cn FROM pg_constraint
  WHERE conrelid = 'usuarios'::regclass AND contype = 'c' AND conname ILIKE '%perfil%';
  IF cn IS NOT NULL THEN EXECUTE 'ALTER TABLE Usuarios DROP CONSTRAINT ' || cn; END IF;
END $$;

ALTER TABLE Usuarios DROP CONSTRAINT IF EXISTS CK_Usuarios_perfil;
ALTER TABLE Usuarios ADD CONSTRAINT CK_Usuarios_perfil
  CHECK (perfil IN ('admin','gerente','operador','saas'));
