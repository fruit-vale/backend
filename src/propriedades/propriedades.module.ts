import { Module } from '@nestjs/common';
import { PropriedadesController } from './propriedades.controller.js';
import { PropriedadesPublicasController } from './propriedades-publicas.controller.js';
import { PropriedadesService } from './propriedades.service.js';

@Module({
  controllers: [PropriedadesController, PropriedadesPublicasController],
  providers: [PropriedadesService],
})
export class PropriedadesModule {}
