-- Culturas por empresa. empresa_id NULL = cultura da plataforma (visível a
-- todas as empresas, cadastrada pelo administrador).
ALTER TABLE culturas
  ADD COLUMN IF NOT EXISTS empresa_id integer
  REFERENCES empresas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_culturas_empresa ON culturas(empresa_id);
