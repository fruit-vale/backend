-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "alertas_climaticos" (
    "id" SERIAL NOT NULL,
    "lote_id" INTEGER NOT NULL,
    "sensor_id" INTEGER,
    "mensagem" TEXT NOT NULL,
    "data_hora" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "lido" BOOLEAN DEFAULT false,

    CONSTRAINT "alertas_climaticos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "culturas" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "variedade" VARCHAR(50),
    "temp_recomendada_min" DECIMAL(5,2),
    "temp_recomendada_max" DECIMAL(5,2),
    "umidade_recomendada_min" DECIMAL(5,2),
    "umidade_recomendada_max" DECIMAL(5,2),
    "ciclo_medio_dias" INTEGER,
    "descricao" TEXT,
    "empresa_id" INTEGER,
    "temp_base_graus_dia" DECIMAL(5,2),
    "graus_dia_ciclo" INTEGER,

    CONSTRAINT "culturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dados_mercado" (
    "id" SERIAL NOT NULL,
    "cultura_id" INTEGER NOT NULL,
    "mercado_destino" VARCHAR(100),
    "preco_medio" DECIMAL(10,2) NOT NULL,
    "moeda" VARCHAR(10) DEFAULT 'BRL',
    "data_referencia" DATE NOT NULL,
    "demanda_estimada" VARCHAR(50),

    CONSTRAINT "dados_mercado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" SERIAL NOT NULL,
    "razao_social" VARCHAR(150) NOT NULL,
    "cpf_cnpj" VARCHAR(20) NOT NULL,
    "telefone" VARCHAR(20),
    "email" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(2),
    "responsavel" VARCHAR(100),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "informacoes_logisticas" (
    "id" SERIAL NOT NULL,
    "origem" VARCHAR(100) NOT NULL,
    "destino" VARCHAR(100) NOT NULL,
    "modal_transporte" VARCHAR(50),
    "tempo_estimado_horas" INTEGER,
    "custo_estimado" DECIMAL(10,2),
    "empresa_transportadora" VARCHAR(100),
    "situacao" VARCHAR(50),

    CONSTRAINT "informacoes_logisticas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leituras_sensores" (
    "id" BIGSERIAL NOT NULL,
    "sensor_id" INTEGER NOT NULL,
    "data_hora" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "temperatura" DECIMAL(5,2),
    "umidade" DECIMAL(5,2),
    "ph" DECIMAL(6,2),
    "luminosidade" DECIMAL(8,2),
    "precipitacao" DECIMAL(5,2),
    "umidade_solo" DECIMAL(5,2),

    CONSTRAINT "leituras_sensores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" SERIAL NOT NULL,
    "propriedade_id" INTEGER NOT NULL,
    "cultura_id" INTEGER NOT NULL,
    "nome_identificacao" VARCHAR(50) NOT NULL,
    "area_ha" DECIMAL(10,2),
    "data_plantio" DATE,
    "previsao_colheita" DATE,
    "situacao" VARCHAR(20) DEFAULT 'EM_CULTIVO',
    "geometria" JSONB,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propriedades" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "produtor_responsavel_id" INTEGER,
    "nome" VARCHAR(100) NOT NULL,
    "municipio" VARCHAR(100) NOT NULL,
    "estado" VARCHAR(2) NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "area_total_ha" DECIMAL(10,2),
    "geometria" JSONB,
    "status" VARCHAR(10) DEFAULT 'ATIVA',

    CONSTRAINT "propriedades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensores" (
    "id" SERIAL NOT NULL,
    "codigo_sensor" VARCHAR(50) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "propriedade_id" INTEGER NOT NULL,
    "lote_id" INTEGER,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "data_instalacao" DATE,
    "status" VARCHAR(15) DEFAULT 'ATIVO',

    CONSTRAINT "sensores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER,
    "nome" VARCHAR(100) NOT NULL,
    "cpf" VARCHAR(14) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "telefone" VARCHAR(20),
    "senha_hash" VARCHAR(255) NOT NULL,
    "tipo_usuario" VARCHAR(20),
    "status" VARCHAR(10) DEFAULT 'ATIVO',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_medidas" (
    "id" SERIAL NOT NULL,
    "sensor_id" INTEGER NOT NULL,
    "chave" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "unidade" VARCHAR(20),
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'OUTRO',

    CONSTRAINT "sensor_medidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leituras_valores" (
    "leitura_id" BIGINT NOT NULL,
    "medida_id" INTEGER NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "leituras_valores_pkey" PRIMARY KEY ("leitura_id","medida_id")
);

-- CreateTable
CREATE TABLE "ciclos_cultivo" (
    "id" SERIAL NOT NULL,
    "lote_id" INTEGER NOT NULL,
    "cultura_id" INTEGER NOT NULL,
    "data_plantio" DATE,
    "previsao_colheita" DATE,
    "data_colheita" DATE,
    "producao" DECIMAL(12,2),
    "unidade_producao" VARCHAR(20),
    "observacoes" TEXT,
    "criado_em" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ciclos_cultivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precos_atacado" (
    "id" BIGSERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "produto" VARCHAR(80) NOT NULL,
    "ceasa" VARCHAR(120) NOT NULL,
    "uf_ceasa" VARCHAR(2) NOT NULL,
    "municipio_origem" VARCHAR(120) NOT NULL,
    "uf_origem" VARCHAR(2) NOT NULL,
    "quantidade_kg" DECIMAL(16,2) NOT NULL,
    "valor_rs" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "precos_atacado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precos_produtor" (
    "id" BIGSERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "produto" VARCHAR(80) NOT NULL,
    "classificacao" VARCHAR(80) NOT NULL,
    "uf" VARCHAR(2) NOT NULL,
    "valor_kg" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "precos_produtor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exportacoes" (
    "id" BIGSERIAL NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "ncm" VARCHAR(8) NOT NULL,
    "pais" VARCHAR(120) NOT NULL,
    "valor_fob_usd" DECIMAL(16,2) NOT NULL,
    "peso_kg" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "exportacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mercado_importacoes" (
    "fonte" VARCHAR(20) NOT NULL,
    "iniciado_em" TIMESTAMP(6) NOT NULL,
    "concluido_em" TIMESTAMP(6),
    "linhas" INTEGER,
    "erro" TEXT,

    CONSTRAINT "mercado_importacoes_pkey" PRIMARY KEY ("fonte")
);

-- CreateIndex
CREATE INDEX "idx_culturas_empresa" ON "culturas"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_cpf_cnpj_key" ON "empresas"("cpf_cnpj");

-- CreateIndex
CREATE INDEX "idx_leituras_sensor_data" ON "leituras_sensores"("sensor_id", "data_hora");

-- CreateIndex
CREATE INDEX "idx_lotes_propriedade" ON "lotes"("propriedade_id");

-- CreateIndex
CREATE UNIQUE INDEX "sensores_codigo_sensor_key" ON "sensores"("codigo_sensor");

-- CreateIndex
CREATE INDEX "idx_sensores_lote" ON "sensores"("lote_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_cpf_key" ON "usuarios"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_medidas_sensor_chave_key" ON "sensor_medidas"("sensor_id", "chave");

-- CreateIndex
CREATE INDEX "idx_leituras_valores_medida" ON "leituras_valores"("medida_id");

-- CreateIndex
CREATE INDEX "idx_ciclos_cultivo_lote" ON "ciclos_cultivo"("lote_id");

-- CreateIndex
CREATE INDEX "idx_precos_atacado_produto" ON "precos_atacado"("produto", "ano", "mes");

-- CreateIndex
CREATE INDEX "idx_precos_produtor_produto" ON "precos_produtor"("produto", "ano", "mes");

-- CreateIndex
CREATE INDEX "idx_exportacoes_ncm" ON "exportacoes"("ncm", "ano", "mes");

-- AddForeignKey
ALTER TABLE "alertas_climaticos" ADD CONSTRAINT "alertas_climaticos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alertas_climaticos" ADD CONSTRAINT "alertas_climaticos_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "culturas" ADD CONSTRAINT "culturas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dados_mercado" ADD CONSTRAINT "dados_mercado_cultura_id_fkey" FOREIGN KEY ("cultura_id") REFERENCES "culturas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "leituras_sensores" ADD CONSTRAINT "leituras_sensores_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_cultura_id_fkey" FOREIGN KEY ("cultura_id") REFERENCES "culturas"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_propriedade_id_fkey" FOREIGN KEY ("propriedade_id") REFERENCES "propriedades"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "propriedades" ADD CONSTRAINT "propriedades_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "propriedades" ADD CONSTRAINT "propriedades_produtor_responsavel_id_fkey" FOREIGN KEY ("produtor_responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensores" ADD CONSTRAINT "sensores_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensores" ADD CONSTRAINT "sensores_propriedade_id_fkey" FOREIGN KEY ("propriedade_id") REFERENCES "propriedades"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sensor_medidas" ADD CONSTRAINT "sensor_medidas_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "leituras_valores" ADD CONSTRAINT "leituras_valores_leitura_id_fkey" FOREIGN KEY ("leitura_id") REFERENCES "leituras_sensores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "leituras_valores" ADD CONSTRAINT "leituras_valores_medida_id_fkey" FOREIGN KEY ("medida_id") REFERENCES "sensor_medidas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ciclos_cultivo" ADD CONSTRAINT "ciclos_cultivo_cultura_id_fkey" FOREIGN KEY ("cultura_id") REFERENCES "culturas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ciclos_cultivo" ADD CONSTRAINT "ciclos_cultivo_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

