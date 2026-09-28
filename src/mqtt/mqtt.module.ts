import { Module } from '@nestjs/common';
import { DispositivosService } from './dispositivos.service.js';
import { DynsecService } from './dynsec.service.js';
import { MqttController } from './mqtt.controller.js';

@Module({
  controllers: [MqttController],
  providers: [DynsecService, DispositivosService],
  exports: [DynsecService],
})
export class MqttModule {}
