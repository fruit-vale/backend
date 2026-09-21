import { Module } from '@nestjs/common';
import { ThingspeakController } from './thingspeak.controller.js';
import { ThingspeakService } from './thingspeak.service.js';

@Module({
  controllers: [ThingspeakController],
  providers: [ThingspeakService],
})
export class ThingspeakModule {}
