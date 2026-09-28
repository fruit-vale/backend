-- Dados que cada sensor envia, definidos pelo produtor no cadastro.
-- chave = nome do campo no JSON publicado pelo sensor no MQTT.
-- tipo liga o dado às grandezas conhecidas (alertas, faixas da cultura).
CREATE TABLE IF NOT EXISTS sensor_medidas (
  id        serial PRIMARY KEY,
  sensor_id integer NOT NULL REFERENCES sensores(id) ON DELETE CASCADE,
  chave     varchar(40) NOT NULL,
  nome      varchar(60) NOT NULL,
  unidade   varchar(20),
  tipo      varchar(20) NOT NULL DEFAULT 'OUTRO'
            CHECK (tipo IN ('TEMPERATURA', 'UMIDADE', 'PH', 'LUMINOSIDADE',
                            'PRECIPITACAO', 'UMIDADE_SOLO', 'OUTRO')),
  CONSTRAINT sensor_medidas_sensor_chave_key UNIQUE (sensor_id, chave)
);

-- Valor de cada dado em cada leitura (uma leitura = uma mensagem recebida).
CREATE TABLE IF NOT EXISTS leituras_valores (
  leitura_id bigint  NOT NULL REFERENCES leituras_sensores(id) ON DELETE CASCADE,
  medida_id  integer NOT NULL REFERENCES sensor_medidas(id) ON DELETE CASCADE,
  valor      numeric(14, 4) NOT NULL,
  PRIMARY KEY (leitura_id, medida_id)
);
CREATE INDEX IF NOT EXISTS idx_leituras_valores_medida ON leituras_valores(medida_id);
