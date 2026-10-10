-- Graus-dia da cultura, para a previsão de colheita pela temperatura dos
-- sensores: graus-dia do dia = max(0, (mínima + máxima) / 2 - temperatura base).
-- A colheita é prevista para quando a soma desde o plantio atinge graus_dia_ciclo.
ALTER TABLE culturas
  ADD COLUMN IF NOT EXISTS temp_base_graus_dia NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS graus_dia_ciclo INTEGER;

ALTER TABLE culturas DROP CONSTRAINT IF EXISTS culturas_graus_dia_ciclo_check;
ALTER TABLE culturas
  ADD CONSTRAINT culturas_graus_dia_ciclo_check CHECK (graus_dia_ciclo > 0);
