import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ThingspeakModule } from './thingspeak/thingspeak.module.js';

@Module({
  imports: [PrismaModule, ThingspeakModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
