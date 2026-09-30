// Simula um sensor FruitVale sem a placa: conecta no broker com as mesmas
// credenciais e o mesmo tópico da biblioteca Arduino e publica uma leitura.
//
// Uso:
//   node scripts/testar-sensor.mjs <usuario> <senha> [chave=valor ...]
//   node scripts/testar-sensor.mjs emp1-estufa-01 'SENHA' temperatura_chip=25.3
//
// Broker: MQTT_TESTE_URL (padrão mqtts://mqtt.fruitvale.com.br:8883).

import { connect } from 'mqtt';

const [usuario, senha, ...pares] = process.argv.slice(2);
if (!usuario || !senha) {
  console.error('uso: node scripts/testar-sensor.mjs <usuario> <senha> [chave=valor ...]');
  process.exit(1);
}

const url = process.env.MQTT_TESTE_URL ?? 'mqtts://mqtt.fruitvale.com.br:8883';
const empresa = /^emp(\d+)-/.exec(usuario)?.[1];
if (!empresa) {
  console.error(`o usuário "${usuario}" não tem o prefixo empN-`);
  process.exit(1);
}

// códigos do CONNACK no MQTT 3.1.1 (os mesmos "estado N" do log da placa)
const MOTIVOS = {
  1: 'versão de protocolo recusada',
  2: 'identificador recusado',
  3: 'broker indisponível',
  4: 'usuário ou senha incorretos',
  5: 'não autorizado: login inexistente no broker, senha errada ou sensor desativado',
};

const dados = Object.fromEntries(
  pares.map((par) => {
    const [chave, valor] = par.split('=');
    return [chave, Number(valor)];
  }),
);
if (!pares.length) dados.teste = 1;
dados.data_hora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const topico = `empresas/${empresa}/sensores/${usuario}/leituras`;
console.log(`conectando em ${url} como "${usuario}" (senha com ${senha.length} caracteres)...`);

const cliente = connect(url, {
  clientId: usuario, // igual à placa: derruba a sessão de uma placa ligada com o mesmo login
  username: usuario,
  password: senha,
  protocolVersion: 4,
  reconnectPeriod: 0,
  connectTimeout: 15_000,
});

cliente.on('connect', () => {
  console.log('conectado; publicando em', topico);
  console.log(JSON.stringify(dados));
  cliente.publish(topico, JSON.stringify(dados), { qos: 1 }, (erro) => {
    if (erro) console.error('falha ao publicar:', erro.message);
    else console.log('publicado (QoS 1 confirmado pelo broker)');
    cliente.end();
  });
});

cliente.on('error', (erro) => {
  const motivo = MOTIVOS[erro.code];
  console.error(motivo ? `recusado (estado ${erro.code}: ${motivo})` : `erro: ${erro.message}`);
  cliente.end(true);
  process.exitCode = 1;
});
