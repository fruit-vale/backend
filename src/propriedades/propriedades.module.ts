import { Module } from '@nestjs/common';
import { PropriedadesController } from './propriedades.controller.js';
import { PropriedadesService } from './propriedades.service.js';

@Module({
  controllers: [PropriedadesController],
  providers: [PropriedadesService],
})
export class PropriedadesModule {}
