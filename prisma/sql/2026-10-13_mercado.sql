-- Dados de mercado importados de fontes públicas, para a tela Mercado e Exportação.
-- Cada importação substitui todas as linhas da sua fonte (é idempotente).

-- Conab PROHORT (ProhortMensal.txt): o que as Ceasas comercializaram por mês,
-- já somado por produto/variedade, Ceasa e origem. Preço = valor / quantidade.
CREATE TABLE IF NOT EXISTS precos_atacado (
  id               bigserial PRIMARY KEY,
  ano              integer       NOT NULL,
  mes              integer       NOT NULL CHECK (mes BETWEEN 1 AND 12),
  produto          varchar(80)   NOT NULL, -- como a Conab escreve: "MANGA PALMER"
  ceasa            varchar(120)  NOT NULL,
  uf_ceasa         varchar(2)    NOT NULL,
  municipio_origem varchar(120)  NOT NULL,
  uf_origem        varchar(2)    NOT NULL,
  quantidade_kg    numeric(16,2) NOT NULL,
  valor_rs         numeric(16,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_precos_atacado_produto ON precos_atacado (produto, ano, mes);

-- Conab Preços Agropecuários (PrecosMensalUF.txt): preço recebido pelo produtor.
CREATE TABLE IF NOT EXISTS precos_produtor (
  id            bigserial PRIMARY KEY,
  ano           integer       NOT NULL,
  mes           integer       NOT NULL CHECK (mes BETWEEN 1 AND 12),
  produto       varchar(80)   NOT NULL,
  classificacao varchar(80)   NOT NULL,
  uf            varchar(2)    NOT NULL,
  valor_kg      numeric(12,4) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_precos_produtor_produto ON precos_produtor (produto, ano, mes);

-- Comex Stat (MDIC): exportações brasileiras por NCM, país e mês.
CREATE TABLE IF NOT EXISTS exportacoes (
  id             bigserial PRIMARY KEY,
  ano            integer       NOT NULL,
  mes            integer       NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ncm            varchar(8)    NOT NULL,
  pais           varchar(120)  NOT NULL,
  valor_fob_usd  numeric(16,2) NOT NULL,
  peso_kg        numeric(16,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exportacoes_ncm ON exportacoes (ncm, ano, mes);

-- Quando cada fonte foi importada pela última vez (e se deu erro).
CREATE TABLE IF NOT EXISTS mercado_importacoes (
  fonte        varchar(20) PRIMARY KEY, -- 'atacado' | 'produtor' | 'exportacao'
  iniciado_em  timestamp   NOT NULL,
  concluido_em timestamp,
  linhas       integer,
  erro         text
);
