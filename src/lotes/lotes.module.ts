import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.js';
import { LotesController } from './lotes.controller.js';
import { LotesService } from './lotes.service.js';
import { SafrasService } from './safras.service.js';

@Module({
  imports: [MqttModule],
  controllers: [LotesController],
  providers: [LotesService, SafrasService],
})
export class LotesModule {}
