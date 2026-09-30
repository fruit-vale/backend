// =============================================================================
//  FruitVale — firmware do sensor (ESP32-C3 Super Mini)
//
//  Usa a biblioteca FruitVale, que cuida de Wi-Fi, relógio, conexão MQTT com
//  TLS e do formato das mensagens. Este arquivo só lê o sensor.
//
//  Arduino IDE:
//    - Placa: "ESP32C3 Dev Module" (core esp32 da Espressif), com
//      "USB CDC On Boot: Enabled" para ver o Monitor Serial (115200).
//    - Bibliotecas: FruitVale (instala junto PubSubClient e ArduinoJson) e as
//      do seu sensor — aqui, "DHT sensor library" + "Adafruit Unified Sensor".
//
//  Primeiro uso (portal de configuração):
//    1. No app FruitVale, cadastre o sensor com os dados que ele envia; a
//       "chave no JSON" de cada dado é a usada em fv.valor() abaixo. Guarde o
//       usuário (ex.: emp7-idide) e a senha que o app mostra.
//    2. Grave este firmware e ligue a placa: ela cria a rede "FruitVale-XXXX"
//       (senha "fruitvale").
//    3. Conecte o celular nessa rede; a página abre sozinha. Preencha o Wi-Fi
//       do local e o usuário/senha do sensor e salve.
//    4. O LED pisca 2x ao conectar à plataforma e 1x a cada envio.
//  Para reconfigurar: ligue a placa e aperte o BOOT nos primeiros 3 segundos.
// =============================================================================

#include <FruitVale.h>

// ---- SEU SENSOR -------------------------------------------------------------
// Troque este bloco pelo sensor que você usa (BME280, DS18B20, analógico...):
// basta cada função devolver o valor lido, ou NAN se a leitura falhar.
// Exemplo: DHT22 com DATA no GPIO 4 (resistor de 10 kΩ entre DATA e 3V3).
#include <DHT.h>

constexpr uint8_t PINO_DHT = 4;
DHT dht(PINO_DHT, DHT22);  // DHT11 para o modelo azul

void iniciarSensor() { dht.begin(); }
float lerTemperatura() { return dht.readTemperature(); }  // °C, NAN se falhar
float lerUmidade() { return dht.readHumidity(); }         // %, NAN se falhar
// -----------------------------------------------------------------------------

FruitVale fv;

void setup() {
  Serial.begin(115200);
  iniciarSensor();

  fv.intervalo(60);  // uma leitura por minuto
  // Opcional: troque a senha da rede do portal se as placas ficarem em local público.
  // fv.senhaPortal("outra-senha");
  fv.begin();  // abre o portal se ainda não houver configuração salva
}

void loop() {
  fv.loop();  // mantém Wi-Fi, relógio e conexão com a plataforma

  if (fv.horaDeLer()) {
    // as chaves precisam ser iguais às cadastradas no app para este sensor;
    // leitura NAN fica de fora da mensagem e os outros dados seguem
    fv.valor("temperatura", lerTemperatura(), 1);
    fv.valor("umidade", lerUmidade(), 1);
    fv.enviar();
  }
}
