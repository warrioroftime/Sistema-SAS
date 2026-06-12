-- Migration 013: Suporte a grupos empresariais (matriz + filiais)
ALTER TABLE Empresas ADD COLUMN IF NOT EXISTS matriz_id INTEGER REFERENCES Empresas(id);
