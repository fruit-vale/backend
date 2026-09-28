import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.js';
import { IngestaoService } from './ingestao.service.js';

@Module({
  imports: [MqttModule],
  providers: [IngestaoService],
})
export class LeiturasModule {}
