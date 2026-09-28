import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.js';
import { SensoresController } from './sensores.controller.js';
import { SensoresService } from './sensores.service.js';

@Module({
  imports: [MqttModule],
  controllers: [SensoresController],
  providers: [SensoresService],
})
export class SensoresModule {}
