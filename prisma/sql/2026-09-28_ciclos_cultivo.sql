-- Histórico de cultivo do lote: cada safra (plantio -> colheita) é um ciclo.
-- data_colheita NULL = safra em andamento (no máximo uma por lote).
-- As colunas cultura_id, data_plantio, previsao_colheita e situacao de lotes
-- continuam espelhando a safra atual.
CREATE TABLE IF NOT EXISTS ciclos_cultivo (
  id                serial PRIMARY KEY,
  lote_id           integer NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  cultura_id        integer NOT NULL REFERENCES culturas(id),
  data_plantio      date,
  previsao_colheita date,
  data_colheita     date,
  producao          numeric(12, 2) CHECK (producao IS NULL OR producao >= 0),
  unidade_producao  varchar(20),
  observacoes       text,
  criado_em         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ciclos_cultivo_datas_check CHECK (
    data_colheita IS NULL OR data_plantio IS NULL OR data_colheita >= data_plantio
  )
);
CREATE INDEX IF NOT EXISTS idx_ciclos_cultivo_lote ON ciclos_cultivo(lote_id);
-- no máximo uma safra em andamento por lote. EXCLUDE em vez de UNIQUE parcial:
-- o prisma db pull leria o índice único como relação 1:1 lote <-> safra.
ALTER TABLE ciclos_cultivo DROP CONSTRAINT IF EXISTS ciclos_cultivo_uma_em_andamento;
ALTER TABLE ciclos_cultivo ADD CONSTRAINT ciclos_cultivo_uma_em_andamento
  EXCLUDE USING btree (lote_id WITH =) WHERE (data_colheita IS NULL);

-- lotes que já existiam viram a primeira safra (colhidos: encerrada hoje)
INSERT INTO ciclos_cultivo (lote_id, cultura_id, data_plantio, previsao_colheita, data_colheita)
SELECT l.id, l.cultura_id, l.data_plantio, l.previsao_colheita,
       CASE WHEN l.situacao = 'COLHIDO' THEN GREATEST(CURRENT_DATE, l.data_plantio) END
FROM lotes l
WHERE NOT EXISTS (SELECT 1 FROM ciclos_cultivo c WHERE c.lote_id = l.id);
