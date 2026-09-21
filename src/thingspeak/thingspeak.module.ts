import { Module } from '@nestjs/common';
import { ThingspeakService } from './thingspeak.service.js';

@Module({
  providers: [ThingspeakService],
})
export class ThingspeakModule {}
