// Simula um sensor FruitVale sem a placa: conecta no broker com as mesmas
// credenciais e o mesmo tópico da biblioteca Arduino e publica leituras no
// formato que a API aceita (as mesmas regras de src/leituras/leituras-mqtt.ts).
//
// Uso:
//   node scripts/testar-sensor.mjs <usuario> <senha> <chave=valor> [chave=valor ...] [opções]
//
// Opções:
//   --horas-atras=N   uma leitura com data_hora N horas no passado
//   --serie=N         N leituras, uma por hora, terminando agora (os valores
//                     variam ±3% para formar uma linha no gráfico)
//
// Exemplos:
//   node scripts/testar-sensor.mjs emp7-idide 'SENHA' temperatura=25.3 umidade=61
//   node scripts/testar-sensor.mjs emp7-idide 'SENHA' temperatura=25,3 --serie=12
//
// As chaves precisam ser as cadastradas no app para o sensor (botão "Dados"):
// chaves desconhecidas são ignoradas pela API, e uma mensagem sem nenhuma
// chave cadastrada é descartada.
//
// Broker: MQTT_TESTE_URL (padrão mqtts://mqtt.fruitvale.com.br:8883).

import { connect } from 'mqtt';

// ---- regras da API ----------------------------------------------------------
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITE_VALOR = 10_000_000_000; // leituras_valores.valor é NUMERIC(14, 4)
const MEDIDAS_MAX = 20;
const SERIE_MAX = 24 * 30;
const HORA_MS = 3_600_000;

function sair(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

// ---- argumentos -------------------------------------------------------------
const args = process.argv.slice(2);
const opcoes = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [nome, valor] = a.slice(2).split('=');
      return [nome, valor];
    }),
);
const [usuario, senha, ...pares] = args.filter((a) => !a.startsWith('--'));

if (!usuario || !senha || !pares.length)
  sair(
    'uso: node scripts/testar-sensor.mjs <usuario> <senha> <chave=valor> [chave=valor ...] [--serie=N | --horas-atras=N]',
  );

const empresa = /^emp(\d+)-/.exec(usuario)?.[1];
if (!empresa) sair(`o usuário "${usuario}" não tem o prefixo empN- (use o código do sensor mostrado no app)`);

for (const nome of Object.keys(opcoes))
  if (!['serie', 'horas-atras'].includes(nome)) sair(`opção desconhecida: --${nome}`);
if (opcoes.serie !== undefined && opcoes['horas-atras'] !== undefined)
  sair('use --serie ou --horas-atras, não os dois');

function inteiro(nome, min, max) {
  const texto = opcoes[nome];
  if (texto === undefined) return null;
  const n = Number(texto);
  if (!Number.isInteger(n) || n < min || n > max) sair(`--${nome} deve ser um inteiro entre ${min} e ${max}`);
  return n;
}
const serie = inteiro('serie', 1, SERIE_MAX);
const horasAtras = inteiro('horas-atras', 0, SERIE_MAX);

// ---- dados (validados como a API valida) -------------------------------------
if (pares.length > MEDIDAS_MAX) sair(`no máximo ${MEDIDAS_MAX} dados por mensagem`);
const dados = {};
for (const par of pares) {
  const igual = par.indexOf('=');
  if (igual < 1) sair(`"${par}" não está no formato chave=valor`);
  const chave = par.slice(0, igual).trim();
  const texto = par.slice(igual + 1).trim().replace(',', '.'); // aceita vírgula decimal
  if (!CHAVE_VALIDA.test(chave))
    sair(`chave "${chave}" inválida: use só letras minúsculas, números e _, começando por letra (como no app)`);
  if (chave === 'data_hora') sair('a chave "data_hora" é reservada: use --horas-atras');
  if (chave in dados) sair(`a chave "${chave}" aparece duas vezes`);
  const valor = Number(texto);
  if (texto === '' || !Number.isFinite(valor)) sair(`o valor de "${chave}" não é um número: "${par.slice(igual + 1)}"`);
  if (Math.abs(valor) >= LIMITE_VALOR) sair(`o valor de "${chave}" está fora do intervalo aceito`);
  dados[chave] = valor;
}

const isoSemMs = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const agora = Date.now();

/** Uma mensagem por instante: a série varia os valores para desenhar uma linha. */
const mensagens = (serie ? Array.from({ length: serie }, (_, i) => serie - 1 - i) : [horasAtras ?? 0]).map(
  (horas) => {
    const corpo = {};
    for (const [chave, valor] of Object.entries(dados)) {
      const variacao = serie && horas > 0 ? 1 + (Math.random() - 0.5) * 0.06 : 1;
      corpo[chave] = Math.round(valor * variacao * 100) / 100;
    }
    corpo.data_hora = isoSemMs(agora - horas * HORA_MS);
    return corpo;
  },
);

// ---- envio -------------------------------------------------------------------
// códigos do CONNACK no MQTT 3.1.1 (os mesmos "estado N" do log da placa)
const MOTIVOS = {
  1: 'versão de protocolo recusada',
  2: 'identificador recusado',
  3: 'broker indisponível',
  4: 'usuário ou senha incorretos',
  5: 'não autorizado: login inexistente no broker, senha errada ou sensor desativado',
};

const url = process.env.MQTT_TESTE_URL ?? 'mqtts://mqtt.fruitvale.com.br:8883';
const topico = `empresas/${empresa}/sensores/${usuario}/leituras`;
console.log(`conectando em ${url} como "${usuario}" (senha com ${senha.length} caracteres)...`);

const cliente = connect(url, {
  // identificador próprio: não derruba uma placa ligada com o mesmo login
  clientId: `${usuario}-teste-${process.pid}`,
  username: usuario,
  password: senha,
  protocolVersion: 4,
  reconnectPeriod: 0,
  connectTimeout: 15_000,
});

cliente.on('connect', async () => {
  console.log(`conectado; publicando ${mensagens.length} leitura(s) em ${topico}`);
  try {
    for (const corpo of mensagens) {
      await cliente.publishAsync(topico, JSON.stringify(corpo), { qos: 1 });
      console.log('  publicado:', JSON.stringify(corpo));
    }
    console.log('ok (QoS 1 confirmado pelo broker).');
    console.log('Se não aparecer no app, confira se as chaves são as cadastradas no sensor (botão "Dados").');
  } catch (erro) {
    console.error('falha ao publicar:', erro.message);
    process.exitCode = 1;
  }
  cliente.end();
});

cliente.on('error', (erro) => {
  const motivo = MOTIVOS[erro.code];
  console.error(motivo ? `recusado (estado ${erro.code}: ${motivo})` : `erro: ${erro.message}`);
  cliente.end(true);
  process.exitCode = 1;
});
