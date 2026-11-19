-- Contrato de adesão da empresa: o acesso só é liberado depois do aceite.
-- Empresas que já existiam ficam como ACEITO (legado), para não perderem acesso;
-- as novas nascem PENDENTE (definido pela API).
ALTER TABLE "empresas"
  ADD COLUMN "contrato_status" VARCHAR(10) NOT NULL DEFAULT 'ACEITO',
  ADD COLUMN "contrato_token_hash" VARCHAR(64),
  ADD COLUMN "contrato_enviado_em" TIMESTAMP(6),
  ADD COLUMN "contrato_expira_em" TIMESTAMP(6),
  ADD COLUMN "contrato_versao" VARCHAR(10),
  ADD COLUMN "contrato_aceito_em" TIMESTAMP(6),
  ADD COLUMN "contrato_aceito_nome" VARCHAR(150),
  ADD COLUMN "contrato_aceito_ip" VARCHAR(45),
  ADD COLUMN "contrato_snapshot" JSONB;

CREATE UNIQUE INDEX "empresas_contrato_token_hash_key" ON "empresas"("contrato_token_hash");
